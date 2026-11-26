begin;

alter table public.trading_fills
  add constraint trading_fills_allocation_identity_unique
  unique (id, owner_id, connection_id, native_fill_id);

alter table public.trading_trade_cycles
  add constraint trading_trade_cycles_allocation_owner_unique
  unique (id, owner_id, connection_id);

create table public.trading_trade_cycle_fills (
  cycle_id uuid not null,
  cycle_revision integer not null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  connection_id uuid not null,
  fill_id bigint not null,
  native_fill_id text not null check (native_fill_id <> ''),
  allocation_quantity numeric(38, 18) not null,
  allocation_role text not null,
  sort_order integer not null,
  generation bigint not null check (generation > 0),
  created_at timestamptz not null default now(),
  constraint trading_trade_cycle_fills_pkey
    primary key (cycle_id, cycle_revision, fill_id, allocation_role),
  constraint trading_trade_cycle_fills_revision_fkey
    foreign key (cycle_id, cycle_revision)
    references public.trading_trade_cycle_revisions(cycle_id, revision) on delete cascade,
  constraint trading_trade_cycle_fills_cycle_owner_fkey
    foreign key (cycle_id, owner_id, connection_id)
    references public.trading_trade_cycles(id, owner_id, connection_id) on delete cascade,
  constraint trading_trade_cycle_fills_fill_owner_fkey
    foreign key (fill_id, owner_id, connection_id, native_fill_id)
    references public.trading_fills(id, owner_id, connection_id, native_fill_id) on delete cascade,
  constraint trading_trade_cycle_fills_quantity_check
    check (allocation_quantity > 0),
  constraint trading_trade_cycle_fills_role_check
    check (allocation_role in ('open', 'add', 'reduce', 'close', 'reverse_open')),
  constraint trading_trade_cycle_fills_sort_order_check
    check (sort_order >= 0),
  constraint trading_trade_cycle_fills_cycle_sort_unique
    unique (cycle_id, cycle_revision, sort_order)
);

create index trading_trade_cycle_fills_owner_cycle_order_idx
on public.trading_trade_cycle_fills(owner_id, cycle_id, cycle_revision, sort_order);

create index trading_trade_cycle_fills_fill_lookup_idx
on public.trading_trade_cycle_fills(fill_id, cycle_id, cycle_revision);

alter table public.trading_trade_cycle_fills enable row level security;
alter table public.trading_trade_cycle_fills force row level security;

revoke all on table public.trading_trade_cycle_fills from public, anon, authenticated;
grant select, insert, update, delete on table public.trading_trade_cycle_fills to service_role;

create policy trading_trade_cycle_fills_service_role_all
on public.trading_trade_cycle_fills
for all
to service_role
using (true)
with check (true);

create or replace function public.publish_exchange_sync_generation(
  p_connection_id uuid,
  p_owner_id uuid,
  p_expected_generation bigint,
  p_snapshot jsonb,
  p_fills jsonb,
  p_cash_events jsonb,
  p_cycles jsonb,
  p_lineage jsonb,
  p_cursor jsonb,
  p_coverage_started_at timestamptz
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  connection public.exchange_connections;
  next_generation bigint;
  item jsonb;
  allocation jsonb;
  persisted_cycle public.trading_trade_cycles;
  persisted_revision public.trading_trade_cycle_revisions;
  persisted_fill public.trading_fills;
  declared_fill_count integer;
  declared_distinct_fill_count integer;
  incoming_allocation_count integer;
  incoming_distinct_fill_count integer;
  incoming_distinct_sort_count integer;
  incoming_minimum_sort integer;
  incoming_maximum_sort integer;
  existing_allocation_count integer;
  path text[];
begin
  select * into connection
  from public.exchange_connections
  where id = p_connection_id and owner_id = p_owner_id and status in ('active', 'error')
  for update;
  if connection.id is null then raise exception 'exchange_connection_not_found'; end if;
  if connection.sync_generation <> p_expected_generation then raise exception 'stale_sync_generation'; end if;
  if jsonb_typeof(p_snapshot) <> 'object'
     or jsonb_typeof(p_fills) <> 'array'
     or jsonb_typeof(p_cash_events) <> 'array'
     or jsonb_typeof(p_cycles) <> 'array'
     or jsonb_typeof(p_lineage) <> 'array'
     or jsonb_typeof(p_cursor) <> 'object' then
    raise exception 'invalid_sync_batch';
  end if;
  next_generation := p_expected_generation + 1;
  select coalesce(array_agg(value), '{}') into path
  from jsonb_array_elements_text(coalesce(p_snapshot->'valuation_path', '[]'::jsonb));

  insert into public.trading_account_snapshots (
    connection_id, owner_id, provider, captured_at, account_currency,
    equity, wallet_balance, unrealized_pnl, usd_equity, usd_wallet_balance,
    usd_unrealized_pnl, valuation_status, valuation_rate, valuation_source,
    valuation_path, valuation_quoted_at, generation
  ) values (
    connection.id, connection.owner_id, connection.provider,
    (p_snapshot->>'captured_at')::timestamptz, p_snapshot->>'account_currency',
    (p_snapshot->>'equity')::numeric, (p_snapshot->>'wallet_balance')::numeric,
    (p_snapshot->>'unrealized_pnl')::numeric, (p_snapshot->>'usd_equity')::numeric,
    (p_snapshot->>'usd_wallet_balance')::numeric, (p_snapshot->>'usd_unrealized_pnl')::numeric,
    p_snapshot->>'valuation_status', (p_snapshot->>'valuation_rate')::numeric,
    p_snapshot->>'valuation_source', path, (p_snapshot->>'valuation_quoted_at')::timestamptz,
    next_generation
  )
  on conflict (connection_id, captured_at) do update
  set equity = excluded.equity,
      wallet_balance = excluded.wallet_balance,
      unrealized_pnl = excluded.unrealized_pnl,
      usd_equity = excluded.usd_equity,
      usd_wallet_balance = excluded.usd_wallet_balance,
      usd_unrealized_pnl = excluded.usd_unrealized_pnl,
      valuation_status = excluded.valuation_status,
      valuation_rate = excluded.valuation_rate,
      valuation_source = excluded.valuation_source,
      valuation_path = excluded.valuation_path,
      valuation_quoted_at = excluded.valuation_quoted_at,
      generation = excluded.generation;

  for item in select value from jsonb_array_elements(p_fills) loop
    insert into public.trading_fills (
      connection_id, owner_id, provider, native_fill_id, native_order_id,
      native_position_id, symbol, native_symbol, product, side, position_side,
      action, price, quantity, contract_multiplier, occurred_at, realized_pnl,
      realized_pnl_asset, realized_pnl_usd, fee, fee_asset, fee_usd,
      liquidity, generation
    ) values (
      connection.id, connection.owner_id, connection.provider,
      item->>'native_fill_id', item->>'native_order_id', item->>'native_position_id',
      item->>'symbol', item->>'native_symbol', item->>'product', item->>'side',
      item->>'position_side', item->>'action', (item->>'price')::numeric,
      (item->>'quantity')::numeric, (item->>'contract_multiplier')::numeric,
      (item->>'occurred_at')::timestamptz, (item->>'realized_pnl')::numeric,
      item->>'realized_pnl_asset', (item->>'realized_pnl_usd')::numeric,
      (item->>'fee')::numeric, item->>'fee_asset', (item->>'fee_usd')::numeric,
      item->>'liquidity', next_generation
    )
    on conflict (connection_id, native_fill_id) do update
    set native_order_id = excluded.native_order_id,
        native_position_id = excluded.native_position_id,
        realized_pnl = excluded.realized_pnl,
        realized_pnl_usd = excluded.realized_pnl_usd,
        fee = excluded.fee,
        fee_usd = excluded.fee_usd,
        generation = excluded.generation;
  end loop;

  for item in select value from jsonb_array_elements(p_cash_events) loop
    insert into public.trading_cash_events (
      connection_id, owner_id, provider, native_event_id, native_type,
      event_type, amount, asset, usd_value, occurred_at, symbol,
      native_position_id, generation
    ) values (
      connection.id, connection.owner_id, connection.provider,
      item->>'native_event_id', item->>'native_type', item->>'type',
      (item->>'amount')::numeric, item->>'asset', (item->>'usd_value')::numeric,
      (item->>'occurred_at')::timestamptz, item->>'symbol',
      item->>'native_position_id', next_generation
    )
    on conflict (connection_id, native_event_id) do update
    set native_type = excluded.native_type,
        event_type = excluded.event_type,
        amount = excluded.amount,
        usd_value = excluded.usd_value,
        generation = excluded.generation;
  end loop;

  for item in select value from jsonb_array_elements(p_cycles) loop
    if item ? 'allocations' and jsonb_typeof(item->'allocations') <> 'array' then
      raise exception 'invalid_trade_cycle_allocations';
    end if;

    insert into public.trading_trade_cycles (
      id, connection_id, owner_id, provider, stable_key, revision, fill_digest,
      product, symbol, direction, native_position_id, opened_at, closed_at,
      entry_price, exit_price, quantity, realized_pnl, fees, funding_or_swap,
      dividends, net_pnl, account_currency, usd_net_pnl, valuation_status,
      completeness, is_current, generation
    ) values (
      (item->>'id')::uuid, connection.id, connection.owner_id, connection.provider,
      item->>'stable_key', (item->>'revision')::integer, item->>'fill_digest',
      item->>'product', item->>'symbol', item->>'direction', item->>'native_position_id',
      (item->>'opened_at')::timestamptz, (item->>'closed_at')::timestamptz,
      (item->>'entry_price')::numeric, (item->>'exit_price')::numeric,
      (item->>'quantity')::numeric, (item->>'realized_pnl')::numeric,
      (item->>'fees')::numeric, (item->>'funding_or_swap')::numeric,
      (item->>'dividends')::numeric, (item->>'net_pnl')::numeric,
      item->>'account_currency', (item->>'usd_net_pnl')::numeric,
      item->>'valuation_status', item->>'completeness',
      coalesce((item->>'is_current')::boolean, true), next_generation
    )
    on conflict (id) do update
    set stable_key = excluded.stable_key,
        revision = excluded.revision,
        fill_digest = excluded.fill_digest,
        closed_at = excluded.closed_at,
        exit_price = excluded.exit_price,
        quantity = excluded.quantity,
        realized_pnl = excluded.realized_pnl,
        fees = excluded.fees,
        funding_or_swap = excluded.funding_or_swap,
        dividends = excluded.dividends,
        net_pnl = excluded.net_pnl,
        usd_net_pnl = excluded.usd_net_pnl,
        valuation_status = excluded.valuation_status,
        completeness = excluded.completeness,
        is_current = excluded.is_current,
        generation = excluded.generation,
        updated_at = now();

    insert into public.trading_trade_cycle_revisions (
      cycle_id, owner_id, revision, fill_digest, facts
    ) values (
      (item->>'id')::uuid, connection.owner_id, (item->>'revision')::integer,
      item->>'fill_digest', item
    ) on conflict (cycle_id, revision) do nothing;

    update public.trading_trade_reviews
    set needs_reconciliation = coalesce((item->>'needs_reconciliation')::boolean, false),
        updated_at = now()
    where cycle_id = (item->>'id')::uuid and owner_id = connection.owner_id;
  end loop;

  for item in select value from jsonb_array_elements(p_cycles) loop
    if item ? 'allocations' then
      if coalesce(jsonb_typeof(item->'fill_ids'), 'null') <> 'array'
         or coalesce(jsonb_typeof(item->'allocations'), 'null') <> 'array'
         or jsonb_array_length(item->'fill_ids') = 0
         or jsonb_array_length(item->'allocations') = 0
         or exists (
           select 1
           from jsonb_array_elements(item->'allocations') proposed
           where jsonb_typeof(proposed) <> 'object'
         ) then
        raise exception 'invalid_trade_cycle_allocations';
      end if;

      select count(*), count(distinct declared)
      into declared_fill_count, declared_distinct_fill_count
      from jsonb_array_elements_text(item->'fill_ids') declared;

      select count(*),
             count(distinct proposed->>'native_fill_id'),
             count(distinct (proposed->>'sort_order')::integer),
             min((proposed->>'sort_order')::integer),
             max((proposed->>'sort_order')::integer)
      into incoming_allocation_count, incoming_distinct_fill_count,
           incoming_distinct_sort_count, incoming_minimum_sort,
           incoming_maximum_sort
      from jsonb_array_elements(item->'allocations') proposed;

      if declared_fill_count <> incoming_allocation_count
         or declared_distinct_fill_count <> declared_fill_count
         or incoming_distinct_fill_count <> incoming_allocation_count
         or incoming_distinct_sort_count <> incoming_allocation_count
         or incoming_minimum_sort <> 0
         or incoming_maximum_sort <> incoming_allocation_count - 1
         or exists (
           select 1
           from jsonb_array_elements_text(item->'fill_ids') declared(native_fill_id)
           where not exists (
             select 1
             from jsonb_array_elements(item->'allocations') proposed
             where proposed->>'native_fill_id' = declared.native_fill_id
           )
         ) then
        raise exception 'invalid_trade_cycle_allocations';
      end if;

      select * into persisted_cycle
      from public.trading_trade_cycles
      where id = (item->>'id')::uuid
        and revision = (item->>'revision')::integer
        and owner_id = connection.owner_id
        and connection_id = connection.id;
      if persisted_cycle.id is null then
        raise exception 'trade_cycle_allocation_cycle_not_found';
      end if;

      select * into persisted_revision
      from public.trading_trade_cycle_revisions
      where cycle_id = persisted_cycle.id
        and revision = persisted_cycle.revision;
      if persisted_revision.cycle_id is null then
        raise exception 'trade_cycle_allocation_revision_not_found';
      end if;
      if persisted_revision.fill_digest is distinct from item->>'fill_digest'
         or persisted_revision.facts->>'anchor_fill_id' is distinct from item->>'anchor_fill_id'
         or persisted_revision.facts->'fill_ids' is distinct from item->'fill_ids'
         or (
           persisted_revision.facts ? 'stable_key'
           and persisted_revision.facts->>'stable_key' is distinct from item->>'stable_key'
         )
         or (
           persisted_revision.facts ? 'allocation_digest'
           and persisted_revision.facts->>'allocation_digest' is distinct from item->>'allocation_digest'
         ) then
        raise exception 'immutable_trade_cycle_revision';
      end if;

      select count(*) into existing_allocation_count
      from public.trading_trade_cycle_fills
      where cycle_id = persisted_cycle.id
        and cycle_revision = persisted_cycle.revision;

      if existing_allocation_count > 0 then
        if existing_allocation_count <> incoming_allocation_count
           or exists (
             select 1
             from jsonb_array_elements(item->'allocations') proposed
             where not exists (
               select 1
               from public.trading_trade_cycle_fills stored
               where stored.cycle_id = persisted_cycle.id
                 and stored.cycle_revision = persisted_cycle.revision
                 and stored.native_fill_id = proposed->>'native_fill_id'
                 and stored.allocation_quantity = (proposed->>'quantity')::numeric
                 and stored.allocation_role = proposed->>'role'
                 and stored.sort_order = (proposed->>'sort_order')::integer
             )
           ) then
          raise exception 'immutable_trade_cycle_allocations';
        end if;
      else
        for allocation in select value from jsonb_array_elements(item->'allocations') loop
          select * into persisted_fill
          from public.trading_fills
          where connection_id = connection.id
            and owner_id = connection.owner_id
            and native_fill_id = allocation->>'native_fill_id';
          if persisted_fill.id is null then
            raise exception 'trade_cycle_allocation_fill_not_found';
          end if;

          insert into public.trading_trade_cycle_fills (
            cycle_id, cycle_revision, owner_id, connection_id, fill_id,
            native_fill_id, allocation_quantity, allocation_role, sort_order,
            generation
          ) values (
            persisted_cycle.id, persisted_cycle.revision, connection.owner_id,
            connection.id, persisted_fill.id, persisted_fill.native_fill_id,
            (allocation->>'quantity')::numeric, allocation->>'role',
            (allocation->>'sort_order')::integer, next_generation
          );
        end loop;
      end if;

      if not (persisted_revision.facts ? 'allocation_digest') then
        update public.trading_trade_cycle_revisions
        set facts = facts || jsonb_build_object(
          'allocations', item->'allocations',
          'allocation_digest', item->'allocation_digest'
        )
        where cycle_id = persisted_cycle.id
          and revision = persisted_cycle.revision;
      end if;
    end if;
  end loop;

  update public.trading_trade_cycles current_cycle
  set is_current = false, generation = next_generation, updated_at = now()
  where current_cycle.connection_id = connection.id
    and current_cycle.is_current
    and not exists (
      select 1 from jsonb_array_elements(p_cycles) candidate
      where (candidate->>'id')::uuid = current_cycle.id
    );

  for item in select value from jsonb_array_elements(p_lineage) loop
    insert into public.trading_trade_cycle_lineage (
      alias_cycle_id, canonical_cycle_id, owner_id, relation, source_revision
    ) values (
      (item->>'alias_cycle_id')::uuid, (item->>'canonical_cycle_id')::uuid,
      connection.owner_id, item->>'relation', (item->>'source_revision')::integer
    ) on conflict (alias_cycle_id) do update
      set canonical_cycle_id = excluded.canonical_cycle_id,
          relation = excluded.relation,
          source_revision = excluded.source_revision;
  end loop;

  insert into public.trading_sync_cursors (connection_id, owner_id, cursor, generation)
  values (connection.id, connection.owner_id, p_cursor, next_generation)
  on conflict (connection_id) do update
  set cursor = excluded.cursor, generation = excluded.generation, updated_at = now();

  update public.exchange_connections
  set sync_generation = next_generation,
      history_coverage_started_at = coalesce(
        least(history_coverage_started_at, p_coverage_started_at),
        history_coverage_started_at,
        p_coverage_started_at
      ),
      last_synced_at = (p_snapshot->>'captured_at')::timestamptz,
      sync_status = 'idle', status = 'active', lease_owner = null, lease_until = null,
      last_error_code = '', consecutive_failures = 0
  where id = connection.id;

  insert into public.trading_sync_batches (
    connection_id, owner_id, expected_generation, published_generation,
    status, started_at, finished_at
  ) values (
    connection.id, connection.owner_id, p_expected_generation, next_generation,
    'published', now(), now()
  );
  return next_generation;
end;
$$;

revoke all on function public.publish_exchange_sync_generation(
  uuid, uuid, bigint, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.publish_exchange_sync_generation(
  uuid, uuid, bigint, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, timestamptz
) to service_role;

alter table public.trading_fills
  add constraint trading_fills_annotation_owner_unique
  unique (id, owner_id, native_fill_id);

create or replace function public.trade_chart_tags_valid(p_tags text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(cardinality(p_tags), 0) <= 10
    and not exists (
      select 1 from unnest(coalesce(p_tags, '{}'::text[])) tag
      where tag is null
         or char_length(tag) not between 1 and 40
         or tag <> lower(btrim(tag))
    )
    and coalesce(cardinality(p_tags), 0) = (
      select count(distinct tag)::integer
      from unnest(coalesce(p_tags, '{}'::text[])) tag
    )
$$;

create or replace function public.trade_chart_viewport_valid(p_viewport jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_typeof(p_viewport) = 'object'
    and octet_length(p_viewport::text) <= 512
    and jsonb_typeof(p_viewport->'from') = 'number'
    and jsonb_typeof(p_viewport->'to') = 'number'
    and (p_viewport->>'from')::numeric < (p_viewport->>'to')::numeric
    and abs((p_viewport->>'from')::numeric) <= 10000000000000
    and abs((p_viewport->>'to')::numeric) <= 10000000000000
    and not exists (
      select 1 from jsonb_object_keys(p_viewport) key
      where key not in ('from', 'to')
    ), false)
$$;

create or replace function public.trade_chart_plain_text_valid(
  p_value text,
  p_maximum_length integer
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_value is not null
    and char_length(p_value) <= p_maximum_length
    and position('<' in p_value) = 0
    and position('>' in p_value) = 0
    and position('javascript:' in lower(p_value)) = 0
    and position('data:text/html' in lower(p_value)) = 0
    and position('expression(' in replace(lower(p_value), ' ', '')) = 0
    and position('url(' in replace(lower(p_value), ' ', '')) = 0, false)
$$;

create or replace function public.trade_chart_color_valid(p_value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_value ~ '^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$', false)
$$;

create or replace function public.trade_chart_indicator_settings_valid(
  p_indicator_id text,
  p_settings jsonb,
  p_timeframe text
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  allowed_keys text[];
  setting_key text;
  setting_value jsonb;
  numeric_value numeric;
begin
  if jsonb_typeof(p_settings) <> 'object' or octet_length(p_settings::text) > 16384 then
    return false;
  end if;

  allowed_keys := case p_indicator_id
    when 'sma' then array['length','source','color','timeframe']
    when 'ema' then array['length','source','color','timeframe']
    when 'wma' then array['length','source','color','timeframe']
    when 'hma' then array['length','source','color','timeframe']
    when 'vwap' then array['anchor','source','offset','calcMode','showBand1','bandMult1','showBand2','bandMult2','showBand3','bandMult3','color','band1Color','band2Color','band3Color']
    when 'bollinger' then array['length','stdDev','source','basisColor','bandColor','timeframe']
    when 'rsi' then array['length','source','color','overbought','oversold','bandColor','timeframe']
    when 'macd' then array['fastPeriod','slowPeriod','signalPeriod','source','macdColor','histUpColor','histUpFadeColor','histDownColor','histDownFadeColor','signalColor','timeframe']
    when 'stochastic' then array['kPeriod','kSmoothing','dPeriod','kColor','dColor','bandColor','timeframe']
    when 'adx' then array['period','adxPeriod','adxColor','plusColor','minusColor','timeframe']
    when 'atr' then array['period','color','timeframe']
    when 'supertrend' then array['period','multiplier','upColor','downColor','timeframe']
    when 'ichimoku' then array['conversionPeriod','basePeriod','laggingSpanPeriod','displacement','conversionColor','baseColor','spanAColor','spanBColor','laggingColor','cloudUpColor','cloudDownColor']
    when 'donchian' then array['length','offset','basisColor','bandColor','fillColor','timeframe']
    when 'keltner-channel' then array['length','mult','source','exp','bandsStyle','atrlength','basisColor','bandColor','fillColor','timeframe']
    when 'chandelier-exit' then array['length','atrLength','atrMultiplier','longColor','shortColor']
    when 'zigzag' then array['deviation','color']
    when 'williams-fractals' then array['periods','showUp','showDown','upColor','downColor']
    when 'pivot-points' then array['kind','frame','showP','show1','show2','show3','show4','show5','pivotColor','supportColor','resistanceColor']
    when 'cpr' then array['pivotMode','showDaily','showWeekly','showMonthly','displaypivots','displaysupport','displayresistance','displaycpr','displayS1R1','dPivotColor','dSupportColor','dResistanceColor','dCprColor','dFillColor','wPivotColor','wSupportColor','wResistanceColor','wCprColor','wFillColor','mPivotColor','mSupportColor','mResistanceColor','mCprColor','mFillColor']
    when 'obv' then array['color','maType','maLength','bbMult','maColor','bbUpperColor','bbLowerColor']
    when 'mfi' then array['period','color','bandColor']
    when 'chaikin-money-flow' then array['length','color']
    else null
  end;
  if allowed_keys is null then
    return false;
  end if;

  for setting_key, setting_value in select key, value from jsonb_each(p_settings)
  loop
    if not (setting_key = any(allowed_keys)) then
      return false;
    end if;
    if setting_key = 'source' then
      if jsonb_typeof(setting_value) <> 'string'
         or setting_value #>> '{}' not in ('open','high','low','close','hl2','hlc3','ohlc4') then
        return false;
      end if;
    elsif setting_key = 'timeframe' then
      if jsonb_typeof(setting_value) <> 'string'
         or setting_value #>> '{}' not in ('', p_timeframe) then
        return false;
      end if;
    elsif setting_key = any(array[
      'showBand1','showBand2','showBand3','exp','showUp','showDown','showP','show1','show2','show3','show4','show5',
      'showDaily','showWeekly','showMonthly','displaypivots','displaysupport','displayresistance','displaycpr','displayS1R1'
    ]) then
      if jsonb_typeof(setting_value) <> 'boolean' then return false; end if;
    elsif setting_key = any(array[
      'color','band1Color','band2Color','band3Color','basisColor','bandColor','macdColor','histUpColor','histUpFadeColor',
      'histDownColor','histDownFadeColor','signalColor','kColor','dColor','adxColor','plusColor','minusColor','upColor','downColor',
      'conversionColor','baseColor','spanAColor','spanBColor','laggingColor','cloudUpColor','cloudDownColor','fillColor','longColor',
      'shortColor','pivotColor','supportColor','resistanceColor','dPivotColor','dSupportColor','dResistanceColor','dCprColor','dFillColor',
      'wPivotColor','wSupportColor','wResistanceColor','wCprColor','wFillColor','mPivotColor','mSupportColor','mResistanceColor',
      'mCprColor','mFillColor','maColor','bbUpperColor','bbLowerColor'
    ]) then
      if jsonb_typeof(setting_value) <> 'string'
         or not public.trade_chart_color_valid(setting_value #>> '{}') then return false; end if;
    elsif setting_key = 'anchor' then
      if jsonb_typeof(setting_value) <> 'string' or setting_value #>> '{}' not in ('session','week','month','quarter','year','continuous') then return false; end if;
    elsif setting_key = 'calcMode' then
      if jsonb_typeof(setting_value) <> 'string' or setting_value #>> '{}' not in ('stdev','percent') then return false; end if;
    elsif setting_key = 'bandsStyle' then
      if jsonb_typeof(setting_value) <> 'string' or setting_value #>> '{}' not in ('Average True Range','True Range','Range') then return false; end if;
    elsif setting_key = 'kind' then
      if jsonb_typeof(setting_value) <> 'string' or setting_value #>> '{}' not in ('traditional','fibonacci','woodie','classic','demark','camarilla') then return false; end if;
    elsif setting_key = 'frame' then
      if jsonb_typeof(setting_value) <> 'string' or setting_value #>> '{}' not in ('auto','daily','weekly','monthly','quarterly','yearly') then return false; end if;
    elsif setting_key = 'pivotMode' then
      if jsonb_typeof(setting_value) <> 'string' or setting_value #>> '{}' not in ('auto','manual') then return false; end if;
    elsif setting_key = 'maType' then
      if jsonb_typeof(setting_value) <> 'string' or setting_value #>> '{}' not in ('None','SMA','SMA + Bollinger Bands','EMA','SMMA (RMA)','WMA','VWMA') then return false; end if;
    else
      if jsonb_typeof(setting_value) <> 'number' then return false; end if;
      numeric_value := (setting_value #>> '{}')::numeric;
      if setting_key = 'offset' then
        if numeric_value not between -500 and 500 or numeric_value <> trunc(numeric_value) then return false; end if;
      elsif setting_key in ('stdDev','multiplier','mult','deviation','bbMult') then
        if numeric_value <= 0 or numeric_value > 100 then return false; end if;
      elsif setting_key in ('bandMult1','bandMult2','bandMult3','atrMultiplier') then
        if numeric_value < 0 or numeric_value > 100 then return false; end if;
      elsif setting_key in ('overbought','oversold') then
        if numeric_value not between 0 and 100 then return false; end if;
      elsif setting_key = 'displacement' then
        if numeric_value not between 0 and 200 or numeric_value <> trunc(numeric_value) then return false; end if;
      elsif numeric_value not between 1 and 1000 or numeric_value <> trunc(numeric_value) then
        return false;
      end if;
    end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

create or replace function public.trade_chart_indicators_valid(
  p_indicators jsonb,
  p_timeframe text
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  indicator jsonb;
  pane_index numeric;
begin
  if jsonb_typeof(p_indicators) <> 'array'
     or jsonb_array_length(p_indicators) > 32
     or octet_length(p_indicators::text) > 65536 then
    return false;
  end if;
  if (select count(*) from jsonb_array_elements(p_indicators)) <>
     (select count(distinct item->>'instanceId') from jsonb_array_elements(p_indicators) item) then
    return false;
  end if;
  for indicator in select value from jsonb_array_elements(p_indicators)
  loop
    if jsonb_typeof(indicator) <> 'object'
       or not (indicator ?& array['instanceId','indicatorId'])
       or exists (select 1 from jsonb_object_keys(indicator) key where key not in ('instanceId','indicatorId','settings','paneIndex'))
       or jsonb_typeof(indicator->'instanceId') <> 'string'
       or (indicator->>'instanceId') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
       or jsonb_typeof(indicator->'indicatorId') <> 'string'
       or (indicator->>'indicatorId') not in (
         'sma','ema','wma','hma','vwap','bollinger','rsi','macd','stochastic','adx','atr','supertrend','ichimoku',
         'donchian','keltner-channel','chandelier-exit','zigzag','williams-fractals','pivot-points','cpr','obv','mfi','chaikin-money-flow'
       )
       or not public.trade_chart_indicator_settings_valid(
         indicator->>'indicatorId', case when indicator ? 'settings' then indicator->'settings' else '{}'::jsonb end, p_timeframe
       ) then
      return false;
    end if;
    if indicator ? 'paneIndex' then
      if jsonb_typeof(indicator->'paneIndex') <> 'number' then return false; end if;
      pane_index := (indicator->>'paneIndex')::numeric;
      if pane_index not between 0 and 15 or pane_index <> trunc(pane_index) then return false; end if;
    end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

create or replace function public.trade_chart_drawing_style_valid(p_style jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  level jsonb;
  numeric_value numeric;
begin
  if jsonb_typeof(p_style) <> 'object'
     or exists (select 1 from jsonb_object_keys(p_style) key where key not in ('color','lineWidth','lineStyle','fill','fillColor','fillOpacity','extendLeft','extendRight','showLabels','levels')) then
    return false;
  end if;
  if p_style ? 'color' and (jsonb_typeof(p_style->'color') <> 'string' or not public.trade_chart_color_valid(p_style->>'color')) then return false; end if;
  if p_style ? 'fillColor' and (jsonb_typeof(p_style->'fillColor') <> 'string' or not public.trade_chart_color_valid(p_style->>'fillColor')) then return false; end if;
  if p_style ? 'lineWidth' then
    if jsonb_typeof(p_style->'lineWidth') <> 'number' then return false; end if;
    numeric_value := (p_style->>'lineWidth')::numeric;
    if numeric_value not between 0.5 and 20 then return false; end if;
  end if;
  if p_style ? 'fillOpacity' then
    if jsonb_typeof(p_style->'fillOpacity') <> 'number' then return false; end if;
    numeric_value := (p_style->>'fillOpacity')::numeric;
    if numeric_value not between 0 and 1 then return false; end if;
  end if;
  if p_style ? 'lineStyle' and (jsonb_typeof(p_style->'lineStyle') <> 'string' or p_style->>'lineStyle' not in ('solid','dashed','dotted')) then return false; end if;
  if exists (
    select 1 from unnest(array['fill','extendLeft','extendRight','showLabels']) key
    where p_style ? key and jsonb_typeof(p_style->key) <> 'boolean'
  ) then return false; end if;
  if p_style ? 'levels' then
    if jsonb_typeof(p_style->'levels') <> 'array' or jsonb_array_length(p_style->'levels') > 32 then return false; end if;
    for level in select value from jsonb_array_elements(p_style->'levels')
    loop
      if jsonb_typeof(level) <> 'object'
         or not (level ? 'ratio')
         or exists (select 1 from jsonb_object_keys(level) key where key not in ('ratio','color','enabled','label'))
         or jsonb_typeof(level->'ratio') <> 'number'
         or abs((level->>'ratio')::numeric) > 1000000 then return false; end if;
      if level ? 'color' and (jsonb_typeof(level->'color') <> 'string' or not public.trade_chart_color_valid(level->>'color')) then return false; end if;
      if level ? 'enabled' and jsonb_typeof(level->'enabled') <> 'boolean' then return false; end if;
      if level ? 'label' and (jsonb_typeof(level->'label') <> 'string' or not public.trade_chart_plain_text_valid(level->>'label', 128)) then return false; end if;
    end loop;
  end if;
  return true;
exception when others then
  return false;
end;
$$;

create or replace function public.trade_chart_drawing_text_valid(p_text jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_typeof(p_text) = 'object'
    and not exists (select 1 from jsonb_object_keys(p_text) key where key not in ('value','color','fontSize','fontFamily','bold','italic','align','valign'))
    and (not (p_text ? 'value') or (jsonb_typeof(p_text->'value') = 'string' and public.trade_chart_plain_text_valid(p_text->>'value', 2000)))
    and (not (p_text ? 'color') or (jsonb_typeof(p_text->'color') = 'string' and public.trade_chart_color_valid(p_text->>'color')))
    and (not (p_text ? 'fontSize') or (jsonb_typeof(p_text->'fontSize') = 'number' and (p_text->>'fontSize')::numeric between 6 and 96))
    and (not (p_text ? 'fontFamily') or (jsonb_typeof(p_text->'fontFamily') = 'string' and p_text->>'fontFamily' ~ '^[A-Za-z0-9 _,-]{0,128}$'))
    and (not (p_text ? 'bold') or jsonb_typeof(p_text->'bold') = 'boolean')
    and (not (p_text ? 'italic') or jsonb_typeof(p_text->'italic') = 'boolean')
    and (not (p_text ? 'align') or (jsonb_typeof(p_text->'align') = 'string' and p_text->>'align' in ('left','center','right')))
    and (not (p_text ? 'valign') or (jsonb_typeof(p_text->'valign') = 'string' and p_text->>'valign' in ('top','middle','bottom'))), false)
$$;

create or replace function public.trade_chart_drawing_tool_shape_valid(p_drawing jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  tool text := p_drawing->>'tool';
  expected_points integer;
  allowed_style text[];
  allowed_text text[] := array['color','fontSize','fontFamily','bold','italic','align','valign'];
  allowed_properties text[] := array[]::text[];
begin
  case tool
    when 'trend-line' then expected_points := 2; allowed_style := array['color','lineWidth','lineStyle','extendLeft','extendRight']; allowed_text := array[]::text[];
    when 'ray' then expected_points := 2; allowed_style := array['color','lineWidth','lineStyle','extendLeft','extendRight']; allowed_text := array[]::text[];
    when 'horizontal-line' then expected_points := 1; allowed_style := array['color','lineWidth','lineStyle','showLabels'];
    when 'vertical-line' then expected_points := 1; allowed_style := array['color','lineWidth','lineStyle']; allowed_text := array[]::text[];
    when 'rectangle' then expected_points := 2; allowed_style := array['color','lineWidth','lineStyle','fill','fillColor','fillOpacity']; allowed_text := array_prepend('value', allowed_text);
    when 'text' then expected_points := 1; allowed_style := array[]::text[]; allowed_text := array_prepend('value', allowed_text);
    when 'long-position' then expected_points := 3; allowed_style := array['color','lineWidth','lineStyle','fillOpacity','showLabels']; allowed_properties := array['showHeader','showLossSize','showTargetLabel','showStopLabel','showPrices','profitColor','lossColor'];
    when 'short-position' then expected_points := 3; allowed_style := array['color','lineWidth','lineStyle','fillOpacity','showLabels']; allowed_properties := array['showHeader','showLossSize','showTargetLabel','showStopLabel','showPrices','profitColor','lossColor'];
    when 'fib-retracement' then expected_points := 2; allowed_style := array['color','lineWidth','lineStyle','levels','showLabels','fill','fillColor','fillOpacity','extendLeft','extendRight'];
    when 'fib-extension' then expected_points := 3; allowed_style := array['color','lineWidth','lineStyle','levels','showLabels','fill','fillColor','fillOpacity','extendLeft','extendRight'];
    when 'fib-time-zone' then expected_points := 2; allowed_style := array['color','lineWidth','lineStyle','levels','showLabels'];
    when 'fib-fan' then expected_points := 2; allowed_style := array['lineWidth','lineStyle','levels','showLabels'];
    when 'fib-channel' then expected_points := 3; allowed_style := array['lineWidth','lineStyle','levels','showLabels','extendLeft','extendRight'];
    when 'elliott-impulse' then expected_points := 6; allowed_style := array['color','lineWidth','lineStyle','showLabels']; allowed_properties := array['degree','labelStyle'];
    when 'elliott-correction' then expected_points := 4; allowed_style := array['color','lineWidth','lineStyle','showLabels']; allowed_properties := array['degree','labelStyle'];
    when 'elliott-triangle' then expected_points := 6; allowed_style := array['color','lineWidth','lineStyle','showLabels']; allowed_properties := array['degree','labelStyle'];
    when 'elliott-double-combo' then expected_points := 4; allowed_style := array['color','lineWidth','lineStyle','showLabels']; allowed_properties := array['degree','labelStyle'];
    when 'elliott-triple-combo' then expected_points := 6; allowed_style := array['color','lineWidth','lineStyle','showLabels']; allowed_properties := array['degree','labelStyle'];
    else return false;
  end case;

  if jsonb_array_length(p_drawing->'points') <> expected_points
     or exists (select 1 from jsonb_object_keys(p_drawing->'style') key where not (key = any(allowed_style))) then
    return false;
  end if;
  if tool = 'text' and (not (p_drawing ? 'text') or not (p_drawing->'text' ? 'value')) then return false; end if;
  if p_drawing ? 'text' then
    if cardinality(allowed_text) = 0
       or exists (select 1 from jsonb_object_keys(p_drawing->'text') key where not (key = any(allowed_text))) then return false; end if;
  end if;
  if p_drawing ? 'properties' then
    if cardinality(allowed_properties) = 0
       or exists (select 1 from jsonb_object_keys(p_drawing->'properties') key where not (key = any(allowed_properties))) then return false; end if;
  end if;
  return true;
exception when others then
  return false;
end;
$$;

create or replace function public.trade_chart_drawing_properties_valid(p_properties jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_typeof(p_properties) = 'object'
    and not exists (select 1 from jsonb_object_keys(p_properties) key where key not in ('degree','labelStyle','showHeader','showLossSize','showTargetLabel','showStopLabel','showPrices','profitColor','lossColor'))
    and (not (p_properties ? 'degree') or (jsonb_typeof(p_properties->'degree') = 'string' and p_properties->>'degree' in ('grand-supercycle','supercycle','cycle','primary','intermediate','minor','minute','minuette','subminuette')))
    and (not (p_properties ? 'labelStyle') or (jsonb_typeof(p_properties->'labelStyle') = 'string' and p_properties->>'labelStyle' in ('degree','plain','parentheses','circled')))
    and not exists (
      select 1 from unnest(array['showHeader','showLossSize','showTargetLabel','showStopLabel','showPrices']) key
      where p_properties ? key and jsonb_typeof(p_properties->key) <> 'boolean'
    )
    and (not (p_properties ? 'profitColor') or (jsonb_typeof(p_properties->'profitColor') = 'string' and public.trade_chart_color_valid(p_properties->>'profitColor')))
    and (not (p_properties ? 'lossColor') or (jsonb_typeof(p_properties->'lossColor') = 'string' and public.trade_chart_color_valid(p_properties->>'lossColor'))), false)
$$;

create or replace function public.trade_chart_drawings_valid(p_drawings jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  drawing jsonb;
  point jsonb;
  numeric_value numeric;
begin
  if jsonb_typeof(p_drawings) <> 'array'
     or jsonb_array_length(p_drawings) > 200
     or octet_length(p_drawings::text) > 262144 then return false; end if;
  if (select count(*) from jsonb_array_elements(p_drawings)) <>
     (select count(distinct item->>'id') from jsonb_array_elements(p_drawings) item) then return false; end if;
  for drawing in select value from jsonb_array_elements(p_drawings)
  loop
    if jsonb_typeof(drawing) <> 'object'
       or not (drawing ?& array['id','tool','points','style','paneIndex','zIndex'])
       or exists (select 1 from jsonb_object_keys(drawing) key where key not in ('id','tool','points','style','text','properties','paneIndex','locked','visible','zIndex'))
       or jsonb_typeof(drawing->'id') <> 'string'
       or (drawing->>'id') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
       or jsonb_typeof(drawing->'tool') <> 'string'
       or (drawing->>'tool') not in (
         'trend-line','ray','horizontal-line','vertical-line','rectangle','text','long-position','short-position',
         'fib-retracement','fib-extension','fib-time-zone','fib-fan','fib-channel',
         'elliott-impulse','elliott-correction','elliott-triangle','elliott-double-combo','elliott-triple-combo'
       )
       or jsonb_typeof(drawing->'points') <> 'array'
       or jsonb_array_length(drawing->'points') > 32
       or not public.trade_chart_drawing_style_valid(drawing->'style')
       or not public.trade_chart_drawing_tool_shape_valid(drawing) then return false; end if;
    for point in select value from jsonb_array_elements(drawing->'points')
    loop
      if jsonb_typeof(point) <> 'object'
         or not (point ?& array['time','price'])
         or exists (select 1 from jsonb_object_keys(point) key where key not in ('time','price'))
         or jsonb_typeof(point->'time') <> 'number'
         or jsonb_typeof(point->'price') <> 'number'
         or abs((point->>'time')::numeric) > 10000000000000
         or abs((point->>'price')::numeric) > 1000000000000000000 then return false; end if;
    end loop;
    if drawing ? 'text' and not public.trade_chart_drawing_text_valid(drawing->'text') then return false; end if;
    if drawing ? 'properties' and not public.trade_chart_drawing_properties_valid(drawing->'properties') then return false; end if;
    if drawing ? 'locked' and jsonb_typeof(drawing->'locked') <> 'boolean' then return false; end if;
    if drawing ? 'visible' and jsonb_typeof(drawing->'visible') <> 'boolean' then return false; end if;
    if jsonb_typeof(drawing->'paneIndex') <> 'number' or jsonb_typeof(drawing->'zIndex') <> 'number' then return false; end if;
    numeric_value := (drawing->>'paneIndex')::numeric;
    if numeric_value not between 0 and 15 or numeric_value <> trunc(numeric_value) then return false; end if;
    numeric_value := (drawing->>'zIndex')::numeric;
    if numeric_value not between -10000 and 10000 then return false; end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

create or replace function public.trade_chart_annotation_image_path_valid(
  p_owner_id uuid,
  p_annotation_id uuid,
  p_image_id uuid,
  p_storage_path text,
  p_mime_type text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_storage_path = p_owner_id::text || '/' || p_annotation_id::text || '/' || p_image_id::text ||
    case p_mime_type
      when 'image/jpeg' then '.jpg'
      when 'image/png' then '.png'
      when 'image/webp' then '.webp'
      else '.invalid'
    end
$$;

create table public.trading_fill_annotations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  cycle_id uuid not null,
  fill_id bigint not null,
  native_fill_id text not null,
  cycle_revision integer not null check (cycle_revision > 0),
  body text not null default '' check (char_length(body) <= 5000),
  tags text[] not null default '{}'::text[] check (public.trade_chart_tags_valid(tags)),
  remap_status text not null default 'current'
    check (remap_status in ('current', 'remapped', 'needs_confirmation')),
  remapped_from_revision integer,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint trading_fill_annotations_owner_cycle_fill_unique
    unique (owner_id, cycle_id, fill_id),
  constraint trading_fill_annotations_id_owner_unique
    unique (id, owner_id),
  constraint trading_fill_annotations_cycle_owner_fkey
    foreign key (cycle_id, owner_id)
    references public.trading_trade_cycles(id, owner_id) on delete cascade,
  constraint trading_fill_annotations_cycle_revision_fkey
    foreign key (cycle_id, cycle_revision)
    references public.trading_trade_cycle_revisions(cycle_id, revision),
  constraint trading_fill_annotations_fill_owner_fkey
    foreign key (fill_id, owner_id, native_fill_id)
    references public.trading_fills(id, owner_id, native_fill_id) on delete cascade,
  constraint trading_fill_annotations_remap_state_check check (
    (remap_status = 'current' and remapped_from_revision is null)
    or (
      remap_status in ('remapped', 'needs_confirmation')
      and remapped_from_revision is not null
      and remapped_from_revision > 0
      and remapped_from_revision < cycle_revision
    )
  )
);

create index trading_fill_annotations_owner_cycle_idx
on public.trading_fill_annotations(owner_id, cycle_id, deleted_at, updated_at desc);

create table public.trading_fill_annotation_images (
  id uuid primary key,
  annotation_id uuid not null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size integer not null check (byte_size between 1 and 2097152),
  sort_order smallint not null check (sort_order between 0 and 4),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint trading_fill_annotation_images_annotation_owner_fkey
    foreign key (annotation_id, owner_id)
    references public.trading_fill_annotations(id, owner_id) on delete cascade,
  constraint trading_fill_annotation_images_path_check check (
    public.trade_chart_annotation_image_path_valid(
      owner_id, annotation_id, id, storage_path, mime_type
    )
  )
);

create unique index trading_fill_annotation_images_active_order_unique
on public.trading_fill_annotation_images(annotation_id, sort_order)
where deleted_at is null;

create index trading_fill_annotation_images_owner_annotation_idx
on public.trading_fill_annotation_images(owner_id, annotation_id, sort_order)
where deleted_at is null;

create table public.trading_chart_states (
  cycle_id uuid not null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  cycle_revision integer not null check (cycle_revision > 0),
  schema_version text not null default 'wavekb-trade-chart-v1'
    check (schema_version = 'wavekb-trade-chart-v1'),
  timeframe text not null check (timeframe in (
    '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h',
    '6h', '8h', '12h', '1d', '1w', '1M'
  )),
  price_type text not null check (price_type in ('trade', 'mark', 'bid', 'ask', 'both')),
  viewport jsonb not null check (public.trade_chart_viewport_valid(viewport)),
  indicators jsonb not null default '[]'::jsonb
    check (public.trade_chart_indicators_valid(indicators, timeframe)),
  drawings jsonb not null default '[]'::jsonb
    check (public.trade_chart_drawings_valid(drawings)),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trading_chart_states_pkey primary key (cycle_id, owner_id),
  constraint trading_chart_states_cycle_owner_fkey
    foreign key (cycle_id, owner_id)
    references public.trading_trade_cycles(id, owner_id) on delete cascade,
  constraint trading_chart_states_cycle_revision_fkey
    foreign key (cycle_id, cycle_revision)
    references public.trading_trade_cycle_revisions(cycle_id, revision)
);

create index trading_chart_states_owner_updated_idx
on public.trading_chart_states(owner_id, updated_at desc);

create table public.trading_candle_cache (
  provider text not null check (provider in ('binance', 'okx', 'bybit', 'bitget', 'exness')),
  product text not null check (product in ('usdt_perpetual', 'usdt_delivery', 'cfd')),
  native_symbol text not null check (
    char_length(native_symbol) between 1 and 100
    and native_symbol ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$'
  ),
  timeframe text not null check (timeframe in (
    '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h',
    '6h', '8h', '12h', '1d', '1w', '1M'
  )),
  scope_kind text not null check (scope_kind in ('public_market', 'private_account')),
  scope_hash text not null check (
    (scope_kind = 'public_market' and scope_hash = 'public-market-v1')
    or (
      scope_kind = 'private_account'
      and scope_hash ~ '^hmac-sha256-v1:[0-9a-f]{64}$'
    )
  ),
  price_type text not null check (price_type in ('trade', 'mark', 'bid', 'ask')),
  open_time timestamptz not null,
  close_time timestamptz not null,
  open_price numeric(38, 18) not null check (open_price > 0),
  high_price numeric(38, 18) not null check (high_price > 0),
  low_price numeric(38, 18) not null check (low_price > 0),
  close_price numeric(38, 18) not null check (close_price > 0),
  volume numeric(38, 18) check (volume is null or volume >= 0),
  is_final boolean not null,
  source_host_kind text not null check (source_host_kind in ('public_api', 'signed_account')),
  source_timestamp timestamptz not null,
  coverage_status text not null check (coverage_status in ('complete', 'partial', 'gapped', 'stale')),
  gap_before boolean not null default false,
  gap_after boolean not null default false,
  fetched_at timestamptz not null,
  expires_at timestamptz not null,
  constraint trading_candle_cache_pkey primary key (
    provider, product, native_symbol, timeframe, scope_hash, price_type, open_time
  ),
  constraint trading_candle_cache_time_check check (
    close_time > open_time
    and source_timestamp <= fetched_at
    and expires_at > fetched_at
  ),
  constraint trading_candle_cache_ohlc_check check (
    high_price >= greatest(open_price, close_price, low_price)
    and low_price <= least(open_price, close_price, high_price)
  ),
  constraint trading_candle_cache_source_check check (
    (
      provider = 'exness'
      and product = 'cfd'
      and scope_kind = 'private_account'
      and price_type in ('bid', 'ask')
      and source_host_kind = 'signed_account'
    )
    or (
      provider in ('binance', 'okx', 'bybit', 'bitget')
      and product in ('usdt_perpetual', 'usdt_delivery')
      and scope_kind = 'public_market'
      and price_type in ('trade', 'mark')
      and source_host_kind = 'public_api'
    )
  )
);

create index trading_candle_cache_lookup_idx
on public.trading_candle_cache(
  provider, product, native_symbol, timeframe, scope_hash, price_type, open_time desc
);

create index trading_candle_cache_expiry_idx
on public.trading_candle_cache(expires_at);

alter table public.trading_fill_annotations enable row level security;
alter table public.trading_fill_annotations force row level security;
alter table public.trading_fill_annotation_images enable row level security;
alter table public.trading_fill_annotation_images force row level security;
alter table public.trading_chart_states enable row level security;
alter table public.trading_chart_states force row level security;
alter table public.trading_candle_cache enable row level security;
alter table public.trading_candle_cache force row level security;

revoke all on table
  public.trading_fill_annotations,
  public.trading_fill_annotation_images,
  public.trading_chart_states,
  public.trading_candle_cache
from public, anon, authenticated, service_role;

grant select on table
  public.trading_fill_annotations,
  public.trading_fill_annotation_images,
  public.trading_chart_states
to authenticated;

grant select, insert, update, delete on table
  public.trading_fill_annotations,
  public.trading_fill_annotation_images,
  public.trading_chart_states,
  public.trading_candle_cache
to service_role;

create policy trading_fill_annotations_select_own
on public.trading_fill_annotations
for select to authenticated
using (owner_id = (select auth.uid()));

create policy trading_fill_annotations_service_all
on public.trading_fill_annotations
for all to service_role
using (true) with check (true);

create policy trading_fill_annotation_images_select_own
on public.trading_fill_annotation_images
for select to authenticated
using (owner_id = (select auth.uid()));

create policy trading_fill_annotation_images_service_all
on public.trading_fill_annotation_images
for all to service_role
using (true) with check (true);

create policy trading_chart_states_select_own
on public.trading_chart_states
for select to authenticated
using (owner_id = (select auth.uid()));

create policy trading_chart_states_service_all
on public.trading_chart_states
for all to service_role
using (true) with check (true);

create policy trading_candle_cache_service_all
on public.trading_candle_cache
for all to service_role
using (true) with check (true);

create or replace function public.upsert_trading_fill_annotation(
  p_annotation_id uuid,
  p_cycle_id uuid,
  p_fill_id bigint,
  p_cycle_revision integer,
  p_body text,
  p_tags text[],
  p_images jsonb,
  p_expected_version integer,
  p_deleted boolean
)
returns public.trading_fill_annotations
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_annotation public.trading_fill_annotations;
  saved_annotation public.trading_fill_annotations;
  native_fill text;
  normalized_tags text[];
  image jsonb;
  image_count integer;
  active_image_count integer;
  distinct_image_count integer;
  distinct_path_count integer;
  image_ordinality bigint;
  locked_cycle_revision integer;
begin
  if auth.uid() is null or not public.account_is_active() then
    raise exception 'trade_chart_account_restricted';
  end if;
  if p_annotation_id is null
     or p_cycle_id is null
     or p_fill_id is null
     or p_cycle_revision is null
     or p_cycle_revision <= 0
     or p_body is null
     or char_length(p_body) > 5000
     or p_tags is null
     or p_images is null
     or p_expected_version is null
     or p_expected_version < 0
     or p_deleted is null
     or cardinality(p_tags) > 10
     or exists (
       select 1 from unnest(p_tags) tag
       where tag is null or char_length(btrim(tag)) not between 1 and 40
     ) then
    raise exception 'invalid_trade_chart_annotation';
  end if;

  select coalesce(array_agg(normalized.tag order by normalized.first_position), '{}'::text[])
  into normalized_tags
  from (
    select lower(btrim(tag)) as tag, min(position) as first_position
    from unnest(p_tags) with ordinality input(tag, position)
    group by lower(btrim(tag))
  ) normalized;

  if jsonb_typeof(p_images) <> 'array' then
    raise exception 'invalid_trade_chart_annotation_images';
  end if;
  image_count := jsonb_array_length(p_images);
  if image_count > 5
     or exists (
       select 1 from jsonb_array_elements(p_images) candidate
       where jsonb_typeof(candidate) <> 'object'
          or not (candidate ?& array['id', 'storage_path', 'mime_type', 'byte_size'])
          or exists (
            select 1 from jsonb_object_keys(candidate) key
            where key not in ('id', 'storage_path', 'mime_type', 'byte_size')
          )
          or jsonb_typeof(candidate->'id') <> 'string'
          or jsonb_typeof(candidate->'storage_path') <> 'string'
          or jsonb_typeof(candidate->'mime_type') <> 'string'
          or jsonb_typeof(candidate->'byte_size') <> 'number'
          or candidate->>'id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          or (candidate->>'mime_type') not in ('image/jpeg', 'image/png', 'image/webp')
          or candidate->>'byte_size' !~ '^[0-9]+$'
     ) then
    raise exception 'invalid_trade_chart_annotation_images';
  end if;
  select count(distinct candidate->>'id'), count(distinct candidate->>'storage_path')
  into distinct_image_count, distinct_path_count
  from jsonb_array_elements(p_images) candidate;
  if distinct_image_count <> image_count or distinct_path_count <> image_count then
    raise exception 'invalid_trade_chart_annotation_images';
  end if;

  for image, image_ordinality in
    select candidate, ordinality
    from jsonb_array_elements(p_images) with ordinality payload(candidate, ordinality)
  loop
    if (image->>'byte_size')::numeric not between 1 and 2097152
       or not public.trade_chart_annotation_image_path_valid(
      auth.uid(), p_annotation_id, (image->>'id')::uuid,
      image->>'storage_path', image->>'mime_type'
    ) then
      raise exception 'invalid_trade_chart_annotation_images';
    end if;
  end loop;

  select cycle.revision into locked_cycle_revision
  from public.trading_trade_cycles cycle
  where cycle.id = p_cycle_id
    and cycle.owner_id = auth.uid()
  for update of cycle;
  if locked_cycle_revision is null or locked_cycle_revision <> p_cycle_revision then
    raise exception 'trade_chart_fill_not_owned';
  end if;

  select fill.native_fill_id into native_fill
  from public.trading_trade_cycle_fills allocation
  join public.trading_fills fill
    on fill.id = allocation.fill_id
   and fill.owner_id = allocation.owner_id
   and fill.native_fill_id = allocation.native_fill_id
  where allocation.cycle_id = p_cycle_id
    and allocation.cycle_revision = p_cycle_revision
    and allocation.fill_id = p_fill_id
    and allocation.owner_id = auth.uid()
  limit 1;
  if native_fill is null then
    raise exception 'trade_chart_fill_not_owned';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_images) candidate
    join public.trading_fill_annotation_images stored_image
      on stored_image.id = (candidate->>'id')::uuid
    where stored_image.annotation_id is distinct from p_annotation_id
       or stored_image.owner_id is distinct from auth.uid()
       or stored_image.storage_path is distinct from candidate->>'storage_path'
       or stored_image.mime_type is distinct from candidate->>'mime_type'
       or stored_image.byte_size is distinct from (candidate->>'byte_size')::integer
  ) then
    raise exception 'invalid_trade_chart_annotation_images';
  end if;

  select * into current_annotation
  from public.trading_fill_annotations annotation
  where annotation.owner_id = auth.uid()
    and annotation.cycle_id = p_cycle_id
    and annotation.fill_id = p_fill_id
  for update;

  if current_annotation.id is null then
    if coalesce(p_expected_version, -1) <> 0
       or exists (
         select 1 from public.trading_fill_annotations annotation
         where annotation.id = p_annotation_id
       ) then
      raise exception 'stale_trade_chart_annotation';
    end if;
    insert into public.trading_fill_annotations (
      id, owner_id, cycle_id, fill_id, native_fill_id, cycle_revision,
      body, tags, remap_status, remapped_from_revision, version, deleted_at
    ) values (
      p_annotation_id, auth.uid(), p_cycle_id, p_fill_id, native_fill,
      p_cycle_revision, p_body, normalized_tags, 'current', null, 1,
      case when p_deleted then clock_timestamp() else null end
    ) returning * into saved_annotation;
  else
    if current_annotation.id <> p_annotation_id
       or current_annotation.version <> p_expected_version then
      raise exception 'stale_trade_chart_annotation';
    end if;
    update public.trading_fill_annotations annotation
    set native_fill_id = native_fill,
        cycle_revision = p_cycle_revision,
        body = p_body,
        tags = normalized_tags,
        remap_status = case
          when current_annotation.cycle_revision <> p_cycle_revision then 'remapped'
          else current_annotation.remap_status
        end,
        remapped_from_revision = case
          when current_annotation.cycle_revision <> p_cycle_revision
            then current_annotation.cycle_revision
          else current_annotation.remapped_from_revision
        end,
        version = current_annotation.version + 1,
        updated_at = clock_timestamp(),
        deleted_at = case when p_deleted then clock_timestamp() else null end
    where annotation.id = current_annotation.id
      and annotation.owner_id = auth.uid()
    returning * into saved_annotation;
  end if;

  update public.trading_fill_annotation_images existing_image
  set deleted_at = clock_timestamp()
  where existing_image.annotation_id = saved_annotation.id
    and existing_image.owner_id = auth.uid()
    and existing_image.deleted_at is null;

  if not p_deleted then
    for image, image_ordinality in
      select candidate, ordinality
      from jsonb_array_elements(p_images) with ordinality payload(candidate, ordinality)
    loop
      insert into public.trading_fill_annotation_images (
        id, annotation_id, owner_id, storage_path, mime_type, byte_size,
        sort_order, deleted_at
      ) values (
        (image->>'id')::uuid, saved_annotation.id, auth.uid(),
        image->>'storage_path', image->>'mime_type',
        (image->>'byte_size')::integer, (image_ordinality - 1)::smallint, null
      )
      on conflict (id) do update
      set sort_order = excluded.sort_order,
          deleted_at = null
      where public.trading_fill_annotation_images.annotation_id = saved_annotation.id
        and public.trading_fill_annotation_images.owner_id = auth.uid()
        and public.trading_fill_annotation_images.storage_path = excluded.storage_path
        and public.trading_fill_annotation_images.mime_type = excluded.mime_type
        and public.trading_fill_annotation_images.byte_size = excluded.byte_size;
    end loop;
  end if;

  select count(*)::integer into active_image_count
  from public.trading_fill_annotation_images stored_image
  where stored_image.annotation_id = saved_annotation.id
    and stored_image.owner_id = auth.uid()
    and stored_image.deleted_at is null;
  if active_image_count <> (case when p_deleted then 0 else image_count end) then
    raise exception 'invalid_trade_chart_annotation_images';
  end if;

  return saved_annotation;
end;
$$;

revoke all on function public.upsert_trading_fill_annotation(
  uuid, uuid, bigint, integer, text, text[], jsonb, integer, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.upsert_trading_fill_annotation(
  uuid, uuid, bigint, integer, text, text[], jsonb, integer, boolean
) to authenticated;

create or replace function public.upsert_trading_chart_state(
  p_cycle_id uuid,
  p_cycle_revision integer,
  p_schema_version text,
  p_timeframe text,
  p_price_type text,
  p_viewport jsonb,
  p_indicators jsonb,
  p_drawings jsonb,
  p_expected_version integer,
  p_expected_updated_at timestamptz
)
returns public.trading_chart_states
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_state public.trading_chart_states;
  saved_state public.trading_chart_states;
  cycle_provider text;
  locked_cycle_revision integer;
begin
  if auth.uid() is null or not public.account_is_active() then
    raise exception 'trade_chart_account_restricted';
  end if;
  if p_cycle_id is null
     or p_cycle_revision is null
     or p_cycle_revision <= 0
     or p_expected_version is null
     or p_expected_version < 0
     or p_schema_version is distinct from 'wavekb-trade-chart-v1'
     or p_timeframe is null
     or p_timeframe not in (
       '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h',
       '6h', '8h', '12h', '1d', '1w', '1M'
     )
     or p_price_type is null
     or p_price_type not in ('trade', 'mark', 'bid', 'ask', 'both')
     or not public.trade_chart_viewport_valid(p_viewport)
     or not public.trade_chart_indicators_valid(p_indicators, p_timeframe)
     or not public.trade_chart_drawings_valid(p_drawings) then
    raise exception 'invalid_trade_chart_state';
  end if;
  select cycle.provider, cycle.revision into cycle_provider, locked_cycle_revision
  from public.trading_trade_cycles cycle
  where cycle.id = p_cycle_id
    and cycle.owner_id = auth.uid()
  for update of cycle;
  if locked_cycle_revision is null
     or locked_cycle_revision <> p_cycle_revision
     or not exists (
       select 1 from public.trading_trade_cycle_revisions revision
       where revision.cycle_id = p_cycle_id
         and revision.owner_id = auth.uid()
         and revision.revision = p_cycle_revision
     ) then
    raise exception 'trade_chart_cycle_not_owned';
  end if;
  if (cycle_provider = 'exness' and p_price_type not in ('bid','ask','both'))
     or (cycle_provider in ('binance','okx','bybit','bitget') and p_price_type not in ('trade','mark')) then
    raise exception 'invalid_trade_chart_state';
  end if;

  select * into current_state
  from public.trading_chart_states state
  where state.cycle_id = p_cycle_id and state.owner_id = auth.uid()
  for update;

  if current_state.cycle_id is null then
    if coalesce(p_expected_version, -1) <> 0 or p_expected_updated_at is not null then
      raise exception 'stale_trade_chart_state';
    end if;
    insert into public.trading_chart_states (
      cycle_id, owner_id, cycle_revision, schema_version, timeframe, price_type,
      viewport, indicators, drawings, version, created_at, updated_at
    ) values (
      p_cycle_id, auth.uid(), p_cycle_revision, p_schema_version, p_timeframe,
      p_price_type, p_viewport, p_indicators, p_drawings, 1,
      clock_timestamp(), clock_timestamp()
    ) returning * into saved_state;
  else
    if current_state.version <> p_expected_version
       or p_expected_updated_at is null
       or current_state.updated_at is distinct from p_expected_updated_at then
      raise exception 'stale_trade_chart_state';
    end if;
    update public.trading_chart_states state
    set cycle_revision = p_cycle_revision,
        schema_version = p_schema_version,
        timeframe = p_timeframe,
        price_type = p_price_type,
        viewport = p_viewport,
        indicators = p_indicators,
        drawings = p_drawings,
        version = current_state.version + 1,
        updated_at = clock_timestamp()
    where state.cycle_id = p_cycle_id and state.owner_id = auth.uid()
    returning * into saved_state;
  end if;
  return saved_state;
end;
$$;

revoke all on function public.upsert_trading_chart_state(
  uuid, integer, text, text, text, jsonb, jsonb, jsonb, integer, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.upsert_trading_chart_state(
  uuid, integer, text, text, text, jsonb, jsonb, jsonb, integer, timestamptz
) to authenticated;

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
) values (
  'trade-chart-annotation-images',
  'trade-chart-annotation-images',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy trade_chart_annotation_images_select_own
on storage.objects
for select to authenticated
using (
  bucket_id = 'trade-chart-annotation-images'
  and exists (
    select 1 from public.trading_fill_annotation_images image
    join public.trading_fill_annotations annotation
      on annotation.id = image.annotation_id and annotation.owner_id = image.owner_id
    where image.storage_path = name
      and image.owner_id = (select auth.uid())
      and image.deleted_at is null
      and annotation.deleted_at is null
  )
);

create policy trade_chart_annotation_images_insert_own
on storage.objects
for insert to authenticated
with check (
  bucket_id = 'trade-chart-annotation-images'
  and (select public.account_is_active())
  and exists (
    select 1 from public.trading_fill_annotation_images image
    join public.trading_fill_annotations annotation
      on annotation.id = image.annotation_id and annotation.owner_id = image.owner_id
    where image.storage_path = name
      and image.owner_id = (select auth.uid())
      and image.deleted_at is null
      and annotation.deleted_at is null
      and metadata->>'mimetype' = image.mime_type
      and metadata->>'size' ~ '^[0-9]+$'
      and (metadata->>'size')::numeric = image.byte_size
  )
);

create policy trade_chart_annotation_images_delete_own
on storage.objects
for delete to authenticated
using (
  bucket_id = 'trade-chart-annotation-images'
  and exists (
    select 1 from public.trading_fill_annotation_images image
    where image.storage_path = name
      and image.owner_id = (select auth.uid())
  )
);

-- Restrictive policies ensure an older permissive storage policy for another
-- bucket cannot widen this bucket's owner, metadata, MIME, size, or lifecycle
-- boundaries.
create policy trade_chart_annotation_images_select_bound
on storage.objects as restrictive
for select to authenticated
using (
  bucket_id <> 'trade-chart-annotation-images'
  or exists (
    select 1 from public.trading_fill_annotation_images image
    join public.trading_fill_annotations annotation
      on annotation.id = image.annotation_id and annotation.owner_id = image.owner_id
    where image.storage_path = name
      and image.owner_id = (select auth.uid())
      and image.deleted_at is null
      and annotation.deleted_at is null
  )
);

create policy trade_chart_annotation_images_insert_bound
on storage.objects as restrictive
for insert to authenticated
with check (
  bucket_id <> 'trade-chart-annotation-images'
  or (
    (select public.account_is_active())
    and exists (
      select 1 from public.trading_fill_annotation_images image
      join public.trading_fill_annotations annotation
        on annotation.id = image.annotation_id and annotation.owner_id = image.owner_id
      where image.storage_path = name
        and image.owner_id = (select auth.uid())
        and image.deleted_at is null
        and annotation.deleted_at is null
        and metadata->>'mimetype' = image.mime_type
        and metadata->>'size' ~ '^[0-9]+$'
        and (metadata->>'size')::numeric = image.byte_size
    )
  )
);

create policy trade_chart_annotation_images_delete_bound
on storage.objects as restrictive
for delete to authenticated
using (
  bucket_id <> 'trade-chart-annotation-images'
  or exists (
    select 1 from public.trading_fill_annotation_images image
    where image.storage_path = name
      and image.owner_id = (select auth.uid())
  )
);

create policy trade_chart_annotation_images_anon_no_select
on storage.objects as restrictive
for select to anon
using (bucket_id <> 'trade-chart-annotation-images');

create policy trade_chart_annotation_images_anon_no_insert
on storage.objects as restrictive
for insert to anon
with check (bucket_id <> 'trade-chart-annotation-images');

create policy trade_chart_annotation_images_anon_no_delete
on storage.objects as restrictive
for delete to anon
using (bucket_id <> 'trade-chart-annotation-images');

create policy trade_chart_annotation_images_no_update
on storage.objects as restrictive
for update to anon, authenticated
using (bucket_id <> 'trade-chart-annotation-images')
with check (bucket_id <> 'trade-chart-annotation-images');

create or replace function public.wavekb_schema_version()
returns text
language sql
stable
security definer
set search_path = ''
as $$ select '202611260001'::text $$;

notify pgrst, 'reload schema';

commit;
