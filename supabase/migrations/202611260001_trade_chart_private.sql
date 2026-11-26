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
    check (sort_order >= 0)
);

create index trading_trade_cycle_fills_owner_cycle_order_idx
on public.trading_trade_cycle_fills(owner_id, cycle_id, cycle_revision, sort_order);

create index trading_trade_cycle_fills_fill_lookup_idx
on public.trading_trade_cycle_fills(fill_id, cycle_id, cycle_revision);

alter table public.trading_trade_cycle_fills enable row level security;

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
  persisted_fill public.trading_fills;
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
      select * into persisted_cycle
      from public.trading_trade_cycles
      where id = (item->>'id')::uuid
        and revision = (item->>'revision')::integer
        and owner_id = connection.owner_id
        and connection_id = connection.id;
      if persisted_cycle.id is null then
        raise exception 'trade_cycle_allocation_cycle_not_found';
      end if;

      delete from public.trading_trade_cycle_fills
      where cycle_id = persisted_cycle.id
        and cycle_revision = persisted_cycle.revision;

      for allocation in select value from jsonb_array_elements(item->'allocations') loop
        if jsonb_typeof(allocation) <> 'object' then
          raise exception 'invalid_trade_cycle_allocation';
        end if;
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

create or replace function public.wavekb_schema_version()
returns text
language sql
stable
security definer
set search_path = ''
as $$ select '202611260001'::text $$;

notify pgrst, 'reload schema';

commit;
