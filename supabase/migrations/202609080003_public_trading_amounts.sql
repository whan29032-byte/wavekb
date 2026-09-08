begin;

-- Keep historical backfill and the replacement trigger atomic with snapshot
-- writers. This prevents a sync from being counted by neither path.
lock table public.trading_equity_snapshots in share row exclusive mode;

-- The previous public opt-in explicitly promised that account amounts would
-- stay private. Preserve connections and history, but require a fresh,
-- versioned consent before any financial total is published.
alter table public.exchange_connections
  add column if not exists public_amounts_consented_at timestamptz;

update public.exchange_connections
set public_enabled = false
where public_enabled and public_amounts_consented_at is null;

alter table public.trading_return_summaries
  add column if not exists current_equity_usdt numeric(30, 8),
  add column if not exists cumulative_profit_usdt numeric(38, 8);

-- Absolute profit is intentionally independent from the time-weighted return:
-- latest equity - binding equity - net external flow after the baseline.
with ordered_snapshots as (
  select
    snapshot.connection_id,
    snapshot.equity_usdt,
    snapshot.net_external_flow_usdt,
    row_number() over (
      partition by snapshot.connection_id
      order by snapshot.captured_at, snapshot.id
    ) as first_row,
    row_number() over (
      partition by snapshot.connection_id
      order by snapshot.captured_at desc, snapshot.id desc
    ) as last_row
  from public.trading_equity_snapshots snapshot
), amounts as (
  select
    ordered.connection_id,
    max(ordered.equity_usdt) filter (where ordered.first_row = 1) as initial_equity_usdt,
    max(ordered.equity_usdt) filter (where ordered.last_row = 1) as current_equity_usdt,
    coalesce(
      sum(ordered.net_external_flow_usdt) filter (where ordered.first_row > 1),
      0
    ) as net_external_flow_usdt
  from ordered_snapshots ordered
  group by ordered.connection_id
)
update public.trading_return_summaries summary
set current_equity_usdt = amounts.current_equity_usdt,
    cumulative_profit_usdt = amounts.current_equity_usdt
      - amounts.initial_equity_usdt
      - amounts.net_external_flow_usdt
from amounts
where amounts.connection_id = summary.connection_id;

-- A connection without a baseline snapshot cannot produce a meaningful public
-- amount. Its first future snapshot recreates the aggregate through the trigger.
delete from public.trading_return_summaries
where current_equity_usdt is null;

alter table public.trading_return_summaries
  alter column current_equity_usdt set not null,
  alter column cumulative_profit_usdt set not null;

alter table public.trading_return_summaries
  drop constraint if exists trading_return_summaries_current_equity_check;
alter table public.trading_return_summaries
  add constraint trading_return_summaries_current_equity_check
  check (current_equity_usdt >= 0);

create or replace function public.accumulate_trading_return_summary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  snapshot_factor numeric;
  affected_rows integer;
begin
  snapshot_factor := case
    when new.period_return is null then 1
    else greatest(1 + new.period_return, 0.000001)
  end;

  insert into public.trading_return_summaries as summary (
    connection_id,
    owner_id,
    return_factor,
    sample_count,
    updated_at,
    current_equity_usdt,
    cumulative_profit_usdt
  ) values (
    new.connection_id,
    new.owner_id,
    snapshot_factor,
    1,
    new.captured_at,
    new.equity_usdt,
    0
  )
  on conflict (connection_id) do update
  set owner_id = excluded.owner_id,
      return_factor = summary.return_factor * excluded.return_factor,
      sample_count = summary.sample_count + 1,
      updated_at = excluded.updated_at,
      cumulative_profit_usdt = summary.cumulative_profit_usdt
        + excluded.current_equity_usdt
        - summary.current_equity_usdt
        - new.net_external_flow_usdt,
      current_equity_usdt = excluded.current_equity_usdt
  where excluded.updated_at > summary.updated_at;

  get diagnostics affected_rows = row_count;
  if affected_rows = 0 then
    raise exception 'stale exchange snapshot';
  end if;

  return new;
end;
$$;

revoke all on function public.accumulate_trading_return_summary() from public, anon, authenticated;

drop trigger if exists trading_equity_snapshots_summarize on public.trading_equity_snapshots;
create trigger trading_equity_snapshots_summarize
after insert on public.trading_equity_snapshots
for each row execute function public.accumulate_trading_return_summary();

-- Version the create boundary so requests from the pre-amount Gateway can
-- never be interpreted as consent during a rolling database/code deployment.
create or replace function public.create_binance_exchange_connection_v2(
  p_owner_id uuid,
  p_label text,
  p_public_enabled boolean,
  p_public_amounts_consent boolean,
  p_api_key_last_four text,
  p_ciphertext text,
  p_iv text,
  p_auth_tag text,
  p_key_version integer,
  p_captured_at timestamptz,
  p_equity_usdt numeric,
  p_wallet_balance_usdt numeric,
  p_unrealized_pnl_usdt numeric
)
returns public.exchange_connections
language plpgsql
security definer
set search_path = ''
as $$
declare
  connection public.exchange_connections;
begin
  if coalesce(p_public_enabled, false) and p_public_amounts_consent is not true then
    raise exception 'public amounts consent required';
  end if;

  select * into connection
  from public.create_binance_exchange_connection(
    p_owner_id,
    p_label,
    false,
    p_api_key_last_four,
    p_ciphertext,
    p_iv,
    p_auth_tag,
    p_key_version,
    p_captured_at,
    p_equity_usdt,
    p_wallet_balance_usdt,
    p_unrealized_pnl_usdt
  );

  update public.exchange_connections
  set public_enabled = coalesce(p_public_enabled, false),
      public_amounts_consented_at = case
        when coalesce(p_public_enabled, false) then now()
        else null
      end
  where id = connection.id and owner_id = p_owner_id
  returning * into connection;

  return connection;
end;
$$;

revoke all on function public.create_binance_exchange_connection_v2(uuid, text, boolean, boolean, text, text, text, text, integer, timestamptz, numeric, numeric, numeric) from public, anon, authenticated;
grant execute on function public.create_binance_exchange_connection_v2(uuid, text, boolean, boolean, text, text, text, text, integer, timestamptz, numeric, numeric, numeric) to service_role;

create or replace function public.set_exchange_connection_public_amounts(
  p_owner_id uuid,
  p_connection_id uuid,
  p_public_enabled boolean,
  p_public_amounts_consent boolean
)
returns public.exchange_connections
language plpgsql
security definer
set search_path = ''
as $$
declare
  connection public.exchange_connections;
begin
  if coalesce(p_public_enabled, false) and p_public_amounts_consent is not true then
    raise exception 'public amounts consent required';
  end if;

  update public.exchange_connections
  set public_enabled = coalesce(p_public_enabled, false),
      public_amounts_consented_at = case
        when coalesce(p_public_enabled, false) then now()
        else null
      end
  where id = p_connection_id and owner_id = p_owner_id and status <> 'disabled'
  returning * into connection;

  if connection.id is null then
    raise exception 'exchange connection not found';
  end if;
  return connection;
end;
$$;

revoke all on function public.set_exchange_connection_public_amounts(uuid, uuid, boolean, boolean) from public, anon, authenticated;
grant execute on function public.set_exchange_connection_public_amounts(uuid, uuid, boolean, boolean) to service_role;

-- Preserve a fatal accounting state using the value at UPDATE time, rather
-- than a stale value read by a concurrent synchronization worker.
create or replace function public.record_exchange_sync_failure(
  p_connection_id uuid,
  p_owner_id uuid,
  p_error_code text
)
returns public.exchange_connections
language plpgsql
security definer
set search_path = ''
as $$
declare
  connection public.exchange_connections;
begin
  if p_error_code !~ '^[a-z0-9_-]{3,80}$' then
    raise exception 'invalid exchange error code';
  end if;

  update public.exchange_connections as current_connection
  set status = 'error',
      last_error_code = case
        when current_connection.last_error_code in (
          'binance_multi_asset_not_supported',
          'binance_transfer_asset_not_supported',
          'binance_income_window_too_large',
          'exchange_sync_gap_too_large'
        ) and p_error_code not in (
          'binance_multi_asset_not_supported',
          'binance_transfer_asset_not_supported',
          'binance_income_window_too_large',
          'exchange_sync_gap_too_large'
        ) then current_connection.last_error_code
        else p_error_code
      end,
      consecutive_failures = current_connection.consecutive_failures + 1
  where current_connection.id = p_connection_id
    and current_connection.owner_id = p_owner_id
    and current_connection.status <> 'disabled'
  returning * into connection;

  if connection.id is null then
    raise exception 'exchange connection not found';
  end if;
  return connection;
end;
$$;

revoke all on function public.record_exchange_sync_failure(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.record_exchange_sync_failure(uuid, uuid, text) to service_role;

-- PostgreSQL cannot replace a RETURNS TABLE function when its output columns
-- change, so drop and recreate the stable public signature in this transaction.
drop function public.list_trading_leaderboard(text, integer);

create function public.list_trading_leaderboard(
  p_period text default 'realtime',
  p_limit integer default 50
)
returns table (
  rank_no bigint,
  user_id uuid,
  public_uid integer,
  display_name text,
  avatar_url text,
  display_title text,
  nameplate_style text,
  return_rate numeric,
  current_equity_usdt text,
  cumulative_profit_usdt text,
  tracking_started_at timestamptz,
  last_synced_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with ranked as (
    select
      profile.id as user_id,
      profile.public_uid,
      profile.display_name,
      profile.avatar_url,
      profile.display_title,
      profile.nameplate_style,
      summary.return_factor - 1 as return_rate,
      summary.current_equity_usdt,
      summary.cumulative_profit_usdt,
      connection.started_at,
      connection.last_synced_at
    from public.exchange_connections connection
    join public.trading_return_summaries summary
      on summary.connection_id = connection.id
    join public.profiles profile on profile.id = connection.owner_id
    where profile.public_uid is not null
      and profile.account_status = 'active'
      and connection.status in ('active', 'error')
      and connection.public_enabled
      and connection.public_amounts_consented_at is not null
      and connection.last_synced_at >= now() - interval '6 hours'
      and not (
        connection.status = 'error'
        and connection.last_error_code in (
          'binance_multi_asset_not_supported',
          'binance_transfer_asset_not_supported',
          'binance_income_window_too_large',
          'exchange_sync_gap_too_large'
        )
      )
  )
  select
    row_number() over (order by ranked.return_rate desc, ranked.started_at asc),
    ranked.user_id,
    ranked.public_uid,
    ranked.display_name,
    ranked.avatar_url,
    ranked.display_title,
    ranked.nameplate_style,
    ranked.return_rate,
    ranked.current_equity_usdt::text,
    ranked.cumulative_profit_usdt::text,
    ranked.started_at,
    ranked.last_synced_at
  from ranked
  order by ranked.return_rate desc, ranked.started_at asc
  limit least(greatest(coalesce(p_limit, 50), 3), 100);
$$;

revoke all on function public.list_trading_leaderboard(text, integer) from public;
grant execute on function public.list_trading_leaderboard(text, integer) to anon, authenticated;

create or replace function public.wavekb_schema_version()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select '202609080003'::text;
$$;

revoke all on function public.wavekb_schema_version() from public;
grant execute on function public.wavekb_schema_version() to anon, authenticated;

notify pgrst, 'reload schema';

commit;
