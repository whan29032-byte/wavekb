begin;

create table public.exchange_connections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  exchange text not null default 'binance' check (exchange = 'binance'),
  market text not null default 'usdm_futures' check (market = 'usdm_futures'),
  label text not null default '币安 U 本位合约' check (char_length(label) between 2 and 60),
  public_enabled boolean not null default true,
  status text not null default 'active' check (status in ('active', 'error', 'disabled')),
  api_key_last_four text not null check (char_length(api_key_last_four) <= 4),
  read_only_ack_at timestamptz not null,
  started_at timestamptz not null default now(),
  last_synced_at timestamptz,
  last_error_code text not null default '',
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index exchange_connections_one_live_idx
on public.exchange_connections(owner_id, exchange, market)
where status <> 'disabled';

create index exchange_connections_sync_idx
on public.exchange_connections(status, last_synced_at)
where status <> 'disabled';

create trigger exchange_connections_touch_updated_at
before update on public.exchange_connections
for each row execute function public.touch_updated_at();

create table public.exchange_connection_secrets (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.exchange_connections(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  ciphertext text not null,
  iv text not null,
  auth_tag text not null,
  key_version integer not null default 1 check (key_version > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

create unique index exchange_connection_secrets_one_active_idx
on public.exchange_connection_secrets(connection_id)
where active;

create table public.trading_equity_snapshots (
  id bigint generated always as identity primary key,
  connection_id uuid not null references public.exchange_connections(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  captured_at timestamptz not null,
  equity_usdt numeric(30, 8) not null check (equity_usdt >= 0),
  wallet_balance_usdt numeric(30, 8) not null,
  unrealized_pnl_usdt numeric(30, 8) not null,
  net_external_flow_usdt numeric(30, 8) not null default 0,
  period_return numeric(20, 12) check (period_return is null or period_return >= -1),
  created_at timestamptz not null default now(),
  unique (connection_id, captured_at)
);

create index trading_equity_snapshots_connection_time_idx
on public.trading_equity_snapshots(connection_id, captured_at desc);

alter table public.exchange_connections enable row level security;
alter table public.exchange_connection_secrets enable row level security;
alter table public.trading_equity_snapshots enable row level security;

create policy "owners read exchange connection metadata"
on public.exchange_connections for select to authenticated
using (owner_id = auth.uid());

create policy "owners read their equity history"
on public.trading_equity_snapshots for select to authenticated
using (owner_id = auth.uid());

-- Secrets intentionally have no browser policy. Only the gateway service role
-- can create, decrypt, rotate or disable them.

alter table public.user_moderation_audit
  drop constraint if exists user_moderation_audit_action_check;
alter table public.user_moderation_audit
  add constraint user_moderation_audit_action_check check (
    action in ('ban', 'unban', 'mute', 'unmute', 'grant_admin', 'revoke_admin', 'set_uid', 'disable_exchange')
  );

create or replace function public.create_binance_exchange_connection(
  p_owner_id uuid,
  p_label text,
  p_public_enabled boolean,
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
  if char_length(trim(p_label)) not between 2 and 60
     or char_length(p_api_key_last_four) > 4
     or p_equity_usdt < 0 then
    raise exception 'invalid exchange connection';
  end if;

  update public.exchange_connections
  set status = 'disabled', public_enabled = false
  where owner_id = p_owner_id and exchange = 'binance' and market = 'usdm_futures'
    and status <> 'disabled';

  update public.exchange_connection_secrets
  set active = false, rotated_at = now()
  where owner_id = p_owner_id and active;

  insert into public.exchange_connections (
    owner_id, label, public_enabled, status, api_key_last_four,
    read_only_ack_at, started_at, last_synced_at
  ) values (
    p_owner_id, trim(p_label), coalesce(p_public_enabled, true), 'active',
    p_api_key_last_four, now(), p_captured_at, p_captured_at
  ) returning * into connection;

  insert into public.exchange_connection_secrets (
    connection_id, owner_id, ciphertext, iv, auth_tag, key_version
  ) values (
    connection.id, p_owner_id, p_ciphertext, p_iv, p_auth_tag, p_key_version
  );

  insert into public.trading_equity_snapshots (
    connection_id, owner_id, captured_at, equity_usdt,
    wallet_balance_usdt, unrealized_pnl_usdt, net_external_flow_usdt,
    period_return
  ) values (
    connection.id, p_owner_id, p_captured_at, p_equity_usdt,
    p_wallet_balance_usdt, p_unrealized_pnl_usdt, 0, null
  );

  return connection;
end;
$$;

create or replace function public.record_binance_equity_snapshot(
  p_connection_id uuid,
  p_owner_id uuid,
  p_captured_at timestamptz,
  p_equity_usdt numeric,
  p_wallet_balance_usdt numeric,
  p_unrealized_pnl_usdt numeric,
  p_net_external_flow_usdt numeric
)
returns public.trading_equity_snapshots
language plpgsql
security definer
set search_path = ''
as $$
declare
  connection public.exchange_connections;
  previous public.trading_equity_snapshots;
  snapshot public.trading_equity_snapshots;
  calculated_return numeric;
begin
  select * into connection
  from public.exchange_connections
  where id = p_connection_id and owner_id = p_owner_id and status <> 'disabled'
  for update;

  if connection.id is null then raise exception 'exchange connection not found'; end if;
  if p_equity_usdt < 0 then raise exception 'invalid equity'; end if;

  select * into previous
  from public.trading_equity_snapshots
  where connection_id = p_connection_id
  order by captured_at desc
  limit 1;

  if previous.id is not null and p_captured_at <= previous.captured_at then
    raise exception 'stale exchange snapshot';
  end if;

  calculated_return := case
    when previous.id is null or previous.equity_usdt <= 0 then null
    else greatest(-1, (p_equity_usdt - coalesce(p_net_external_flow_usdt, 0) - previous.equity_usdt) / previous.equity_usdt)
  end;

  insert into public.trading_equity_snapshots (
    connection_id, owner_id, captured_at, equity_usdt,
    wallet_balance_usdt, unrealized_pnl_usdt, net_external_flow_usdt,
    period_return
  ) values (
    p_connection_id, p_owner_id, p_captured_at, p_equity_usdt,
    p_wallet_balance_usdt, p_unrealized_pnl_usdt,
    coalesce(p_net_external_flow_usdt, 0), calculated_return
  ) returning * into snapshot;

  update public.exchange_connections
  set status = 'active', last_synced_at = p_captured_at,
      last_error_code = '', consecutive_failures = 0
  where id = p_connection_id;

  return snapshot;
end;
$$;

create or replace function public.disconnect_exchange_connection(
  p_owner_id uuid,
  p_connection_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.exchange_connections
  set status = 'disabled', public_enabled = false
  where id = p_connection_id and owner_id = p_owner_id;
  if not found then raise exception 'exchange connection not found'; end if;

  update public.exchange_connection_secrets
  set active = false, rotated_at = now()
  where connection_id = p_connection_id and owner_id = p_owner_id and active;
end;
$$;

create or replace function public.admin_disable_exchange_connection(
  p_actor uuid,
  p_connection_id uuid,
  p_reason text
)
returns public.exchange_connections
language plpgsql
security definer
set search_path = ''
as $$
declare
  connection public.exchange_connections;
  previous jsonb;
begin
  if not exists (
    select 1 from public.profiles
    where id = p_actor and role = 'admin' and account_status = 'active'
  ) then raise exception 'admin_required'; end if;
  if char_length(trim(coalesce(p_reason, ''))) not between 2 and 500 then
    raise exception 'reason_required';
  end if;

  select * into connection from public.exchange_connections where id = p_connection_id for update;
  if connection.id is null then raise exception 'exchange_connection_not_found'; end if;
  previous := to_jsonb(connection);

  update public.exchange_connections
  set status = 'disabled', public_enabled = false,
      last_error_code = 'disabled_by_admin'
  where id = p_connection_id
  returning * into connection;

  update public.exchange_connection_secrets
  set active = false, rotated_at = now()
  where connection_id = p_connection_id and active;

  insert into public.user_moderation_audit (
    actor_id, target_id, action, reason, before_state, after_state
  ) values (
    p_actor, connection.owner_id, 'disable_exchange', trim(p_reason),
    previous, to_jsonb(connection)
  );
  return connection;
end;
$$;

create or replace function public.list_trading_leaderboard(
  p_period text default '30d',
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
  sample_count bigint,
  tracking_started_at timestamptz,
  last_synced_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with returns as (
    select
      connection.id as connection_id,
      connection.owner_id,
      connection.started_at,
      connection.last_synced_at,
      exp(sum(ln(greatest(1 + snapshot.period_return, 0.000001)))) - 1 as return_rate,
      count(*) + 1 as sample_count
    from public.exchange_connections connection
    join public.trading_equity_snapshots snapshot on snapshot.connection_id = connection.id
    where connection.status = 'active'
      and connection.public_enabled
      and connection.started_at <= now() - interval '24 hours'
      and connection.last_synced_at >= now() - interval '6 hours'
      and snapshot.period_return is not null
      and snapshot.captured_at >= case coalesce(p_period, '30d')
        when '7d' then now() - interval '7 days'
        when '30d' then now() - interval '30 days'
        when '90d' then now() - interval '90 days'
        when 'all' then connection.started_at
        else now() - interval '30 days'
      end
    group by connection.id
    having count(*) >= 4
  ), ranked as (
    select
      profile.id as user_id,
      profile.public_uid,
      profile.display_name,
      profile.avatar_url,
      profile.display_title,
      profile.nameplate_style,
      returns.return_rate,
      returns.sample_count,
      returns.started_at,
      returns.last_synced_at
    from returns
    join public.profiles profile on profile.id = returns.owner_id
    where profile.public_uid is not null
      and profile.account_status = 'active'
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
    ranked.sample_count,
    ranked.started_at,
    ranked.last_synced_at
  from ranked
  order by ranked.return_rate desc, ranked.started_at asc
  limit least(greatest(coalesce(p_limit, 50), 3), 100);
$$;

revoke all on function public.create_binance_exchange_connection(uuid, text, boolean, text, text, text, text, integer, timestamptz, numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function public.record_binance_equity_snapshot(uuid, uuid, timestamptz, numeric, numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function public.disconnect_exchange_connection(uuid, uuid) from public, anon, authenticated;
revoke all on function public.admin_disable_exchange_connection(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.create_binance_exchange_connection(uuid, text, boolean, text, text, text, text, integer, timestamptz, numeric, numeric, numeric) to service_role;
grant execute on function public.record_binance_equity_snapshot(uuid, uuid, timestamptz, numeric, numeric, numeric, numeric) to service_role;
grant execute on function public.disconnect_exchange_connection(uuid, uuid) to service_role;
grant execute on function public.admin_disable_exchange_connection(uuid, uuid, text) to service_role;
revoke all on function public.list_trading_leaderboard(text, integer) from public;
grant execute on function public.list_trading_leaderboard(text, integer) to anon, authenticated;

create or replace function public.wavekb_schema_version()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select '202609080001'::text;
$$;

revoke all on function public.wavekb_schema_version() from public;
grant execute on function public.wavekb_schema_version() to anon, authenticated;

commit;
