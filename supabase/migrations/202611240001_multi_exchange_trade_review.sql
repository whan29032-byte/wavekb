begin;

create table public.exchange_credential_sets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('binance', 'okx', 'bybit', 'bitget', 'exness')),
  label text not null check (char_length(label) between 1 and 80),
  secret_mask text not null default '' check (char_length(secret_mask) <= 32),
  status text not null default 'active' check (status in ('active', 'pending_verification', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table public.exchange_credential_secrets (
  id uuid primary key default gen_random_uuid(),
  credential_set_id uuid not null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  ciphertext text not null,
  iv text not null,
  auth_tag text not null,
  key_version integer not null default 1 check (key_version > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  constraint exchange_credential_secrets_owner_fkey
    foreign key (credential_set_id, owner_id)
    references public.exchange_credential_sets(id, owner_id) on delete cascade
);

create unique index exchange_credential_secrets_one_active_idx
on public.exchange_credential_secrets(credential_set_id) where active;

alter table public.exchange_credential_sets enable row level security;
alter table public.exchange_credential_secrets enable row level security;
revoke all on table public.exchange_credential_sets, public.exchange_credential_secrets
  from public, anon, authenticated;
grant select, insert, update, delete on table
  public.exchange_credential_sets, public.exchange_credential_secrets to service_role;

drop index if exists public.exchange_connections_one_live_idx;
alter table public.exchange_connections drop constraint if exists exchange_connections_exchange_check;
alter table public.exchange_connections drop constraint if exists exchange_connections_market_check;
alter table public.exchange_connections drop constraint if exists exchange_connections_status_check;

alter table public.exchange_connections
  add column provider text,
  add column credential_set_id uuid,
  add column external_account_id_hash text,
  add column account_label text,
  add column account_identifier_mask text,
  add column account_currency text,
  add column capabilities jsonb not null default '{}'::jsonb,
  add column history_coverage_started_at timestamptz,
  add column equity_tracking_started_at timestamptz,
  add column sync_status text not null default 'idle',
  add column lease_owner uuid,
  add column lease_until timestamptz,
  add column sync_generation bigint not null default 0,
  add column data_hidden_at timestamptz;

update public.exchange_connections
set provider = coalesce(nullif(exchange, ''), 'binance'),
    account_label = coalesce(nullif(label, ''), 'Binance USD-M'),
    account_identifier_mask = case
      when coalesce(api_key_last_four, '') = '' then '••••'
      else '••••' || api_key_last_four
    end,
    account_currency = 'USDT',
    equity_tracking_started_at = started_at,
    sync_status = case when status = 'disabled' then 'disabled' when status = 'error' then 'error' else 'idle' end;

create temporary table legacy_exchange_credential_mapping (
  connection_id uuid primary key,
  credential_set_id uuid not null unique
) on commit drop;

insert into legacy_exchange_credential_mapping (connection_id, credential_set_id)
select id, gen_random_uuid()
from public.exchange_connections
where credential_set_id is null;

insert into public.exchange_credential_sets (
  id, owner_id, provider, label, secret_mask, status, created_at, updated_at
)
select
  mapping.credential_set_id,
  connection.owner_id,
  connection.provider,
  connection.account_label,
  connection.account_identifier_mask,
  case when connection.status = 'disabled' then 'disabled' else 'active' end,
  connection.created_at,
  connection.updated_at
from legacy_exchange_credential_mapping mapping
join public.exchange_connections connection on connection.id = mapping.connection_id;

update public.exchange_connections connection
set credential_set_id = mapping.credential_set_id
from legacy_exchange_credential_mapping mapping
where connection.id = mapping.connection_id;

insert into public.exchange_credential_secrets (
  credential_set_id, owner_id, ciphertext, iv, auth_tag, key_version,
  active, created_at, rotated_at
)
select
  mapping.credential_set_id,
  secret.owner_id,
  secret.ciphertext,
  secret.iv,
  secret.auth_tag,
  secret.key_version,
  secret.active,
  secret.created_at,
  secret.rotated_at
from public.exchange_connection_secrets secret
join legacy_exchange_credential_mapping mapping on mapping.connection_id = secret.connection_id;

alter table public.exchange_connections
  alter column provider set not null,
  alter column account_label set not null,
  alter column account_identifier_mask set not null,
  alter column account_currency set not null,
  alter column equity_tracking_started_at set not null,
  alter column credential_set_id set not null,
  add constraint exchange_connections_provider_check
    check (provider in ('binance', 'okx', 'bybit', 'bitget', 'exness')),
  add constraint exchange_connections_status_check
    check (status in ('pending_verification', 'active', 'error', 'disabled', 'deleting')),
  add constraint exchange_connections_sync_status_check
    check (sync_status in ('idle', 'syncing', 'error', 'disabled', 'deleting')),
  add constraint exchange_connections_credential_owner_fkey
    foreign key (credential_set_id, owner_id)
    references public.exchange_credential_sets(id, owner_id),
  add constraint exchange_connections_id_owner_unique unique (id, owner_id);

create unique index exchange_connections_provider_account_unique
on public.exchange_connections(provider, external_account_id_hash)
where external_account_id_hash is not null and status <> 'deleting';

create index exchange_connections_owner_provider_idx
on public.exchange_connections(owner_id, provider, status);

create index exchange_connections_lease_idx
on public.exchange_connections(sync_status, lease_until)
where status in ('active', 'error');

create table public.trading_account_snapshots (
  id bigint generated always as identity primary key,
  connection_id uuid not null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('binance', 'okx', 'bybit', 'bitget', 'exness')),
  captured_at timestamptz not null,
  account_currency text not null,
  equity numeric(38, 18) not null,
  wallet_balance numeric(38, 18) not null,
  unrealized_pnl numeric(38, 18) not null,
  usd_equity numeric(38, 18),
  usd_wallet_balance numeric(38, 18),
  usd_unrealized_pnl numeric(38, 18),
  valuation_status text not null check (valuation_status in ('direct', 'approximate', 'triangulated', 'unavailable')),
  valuation_rate numeric(38, 18),
  valuation_source text,
  valuation_path text[] not null default '{}',
  valuation_quoted_at timestamptz,
  generation bigint not null check (generation > 0),
  created_at timestamptz not null default now(),
  constraint trading_account_snapshots_connection_owner_fkey
    foreign key (connection_id, owner_id)
    references public.exchange_connections(id, owner_id) on delete cascade,
  unique (connection_id, captured_at)
);

create table public.trading_fills (
  id bigint generated always as identity primary key,
  connection_id uuid not null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('binance', 'okx', 'bybit', 'bitget', 'exness')),
  native_fill_id text not null,
  native_order_id text not null,
  native_position_id text,
  symbol text not null,
  native_symbol text not null,
  product text not null check (product in ('usdt_perpetual', 'usdt_delivery', 'cfd')),
  side text not null check (side in ('buy', 'sell')),
  position_side text not null check (position_side in ('both', 'long', 'short')),
  action text not null check (action in ('open', 'close')),
  price numeric(38, 18) not null,
  quantity numeric(38, 18) not null,
  contract_multiplier numeric(38, 18) not null,
  occurred_at timestamptz not null,
  realized_pnl numeric(38, 18) not null,
  realized_pnl_asset text not null,
  realized_pnl_usd numeric(38, 18),
  fee numeric(38, 18) not null,
  fee_asset text not null,
  fee_usd numeric(38, 18),
  liquidity text not null check (liquidity in ('maker', 'taker', 'unknown')),
  generation bigint not null check (generation > 0),
  created_at timestamptz not null default now(),
  constraint trading_fills_connection_owner_fkey
    foreign key (connection_id, owner_id)
    references public.exchange_connections(id, owner_id) on delete cascade,
  unique (connection_id, native_fill_id)
);

create index trading_fills_connection_time_idx
on public.trading_fills(connection_id, occurred_at, id);

create table public.trading_cash_events (
  id bigint generated always as identity primary key,
  connection_id uuid not null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('binance', 'okx', 'bybit', 'bitget', 'exness')),
  native_event_id text not null,
  native_type text not null,
  event_type text not null check (event_type in (
    'deposit', 'withdrawal', 'internal_transfer', 'funding', 'swap_fee',
    'commission_adjustment', 'dividend', 'admin_adjustment', 'bonus', 'unknown'
  )),
  amount numeric(38, 18) not null,
  asset text not null,
  usd_value numeric(38, 18),
  occurred_at timestamptz not null,
  symbol text,
  native_position_id text,
  generation bigint not null check (generation > 0),
  created_at timestamptz not null default now(),
  constraint trading_cash_events_connection_owner_fkey
    foreign key (connection_id, owner_id)
    references public.exchange_connections(id, owner_id) on delete cascade,
  unique (connection_id, native_event_id)
);

create index trading_cash_events_connection_time_idx
on public.trading_cash_events(connection_id, occurred_at, id);

create table public.trading_trade_cycles (
  id uuid primary key,
  connection_id uuid not null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('binance', 'okx', 'bybit', 'bitget', 'exness')),
  stable_key text not null,
  revision integer not null check (revision > 0),
  fill_digest text not null,
  product text not null check (product in ('usdt_perpetual', 'usdt_delivery', 'cfd')),
  symbol text not null,
  direction text not null check (direction in ('long', 'short')),
  native_position_id text,
  opened_at timestamptz not null,
  closed_at timestamptz,
  entry_price numeric(38, 18) not null,
  exit_price numeric(38, 18),
  quantity numeric(38, 18) not null,
  realized_pnl numeric(38, 18) not null,
  fees numeric(38, 18) not null,
  funding_or_swap numeric(38, 18) not null,
  dividends numeric(38, 18) not null,
  net_pnl numeric(38, 18) not null,
  account_currency text not null,
  usd_net_pnl numeric(38, 18),
  valuation_status text not null check (valuation_status in ('direct', 'approximate', 'triangulated', 'unavailable')),
  completeness text not null check (completeness in ('complete', 'open', 'incomplete_opening_history', 'incomplete_valuation')),
  is_current boolean not null default true,
  generation bigint not null check (generation > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trading_trade_cycles_connection_owner_fkey
    foreign key (connection_id, owner_id)
    references public.exchange_connections(id, owner_id) on delete cascade,
  constraint trading_trade_cycles_id_owner_unique unique (id, owner_id),
  unique (connection_id, stable_key)
);

create index trading_trade_cycles_owner_time_idx
on public.trading_trade_cycles(owner_id, opened_at desc) where is_current;

create table public.trading_trade_cycle_revisions (
  cycle_id uuid not null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  revision integer not null check (revision > 0),
  fill_digest text not null,
  facts jsonb not null,
  created_at timestamptz not null default now(),
  primary key (cycle_id, revision),
  constraint trading_trade_cycle_revisions_owner_fkey
    foreign key (cycle_id, owner_id)
    references public.trading_trade_cycles(id, owner_id) on delete cascade
);

create table public.trading_trade_cycle_lineage (
  alias_cycle_id uuid primary key,
  canonical_cycle_id uuid not null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  relation text not null check (relation in ('split', 'merged', 'replaced')),
  source_revision integer not null check (source_revision > 0),
  created_at timestamptz not null default now(),
  constraint trading_trade_cycle_lineage_alias_owner_fkey
    foreign key (alias_cycle_id, owner_id)
    references public.trading_trade_cycles(id, owner_id) on delete cascade,
  constraint trading_trade_cycle_lineage_canonical_owner_fkey
    foreign key (canonical_cycle_id, owner_id)
    references public.trading_trade_cycles(id, owner_id) on delete cascade
);

create table public.trading_trade_reviews (
  cycle_id uuid primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  cycle_revision integer not null check (cycle_revision > 0),
  reason text not null default '' check (char_length(reason) <= 5000),
  plan_compliance text not null default 'unset' check (plan_compliance in ('unset', 'yes', 'partial', 'no')),
  next_improvement text not null default '' check (char_length(next_improvement) <= 5000),
  tags text[] not null default '{}',
  planned_stop_price numeric(38, 18),
  planned_risk_amount numeric(38, 18),
  needs_reconciliation boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trading_trade_reviews_cycle_owner_fkey
    foreign key (cycle_id, owner_id)
    references public.trading_trade_cycles(id, owner_id) on delete cascade
);

create table public.trading_sync_cursors (
  connection_id uuid primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  cursor jsonb not null,
  generation bigint not null check (generation >= 0),
  updated_at timestamptz not null default now(),
  constraint trading_sync_cursors_connection_owner_fkey
    foreign key (connection_id, owner_id)
    references public.exchange_connections(id, owner_id) on delete cascade
);

create table public.trading_sync_batches (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  expected_generation bigint not null,
  published_generation bigint,
  status text not null check (status in ('published', 'failed')),
  safe_error_code text not null default '',
  started_at timestamptz not null,
  finished_at timestamptz not null,
  constraint trading_sync_batches_connection_owner_fkey
    foreign key (connection_id, owner_id)
    references public.exchange_connections(id, owner_id) on delete cascade
);

create table public.trading_delete_queue (
  connection_id uuid primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('binance', 'okx', 'bybit', 'bitget', 'exness')),
  requested_at timestamptz not null,
  hard_delete_after timestamptz not null,
  constraint trading_delete_queue_connection_owner_fkey
    foreign key (connection_id, owner_id)
    references public.exchange_connections(id, owner_id) on delete cascade,
  check (hard_delete_after <= requested_at + interval '30 days')
);

create table public.trading_deletion_audit (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  provider text not null check (provider in ('binance', 'okx', 'bybit', 'bitget', 'exness')),
  deleted_at timestamptz not null,
  expires_at timestamptz not null,
  check (expires_at <= deleted_at + interval '90 days')
);

alter table public.trading_account_snapshots enable row level security;
alter table public.trading_fills enable row level security;
alter table public.trading_cash_events enable row level security;
alter table public.trading_trade_cycles enable row level security;
alter table public.trading_trade_cycle_revisions enable row level security;
alter table public.trading_trade_cycle_lineage enable row level security;
alter table public.trading_trade_reviews enable row level security;
alter table public.trading_sync_cursors enable row level security;
alter table public.trading_sync_batches enable row level security;
alter table public.trading_delete_queue enable row level security;
alter table public.trading_deletion_audit enable row level security;

revoke all on table
  public.trading_account_snapshots,
  public.trading_fills,
  public.trading_cash_events,
  public.trading_trade_cycles,
  public.trading_trade_cycle_revisions,
  public.trading_trade_cycle_lineage,
  public.trading_trade_reviews,
  public.trading_sync_cursors,
  public.trading_sync_batches,
  public.trading_delete_queue,
  public.trading_deletion_audit
from public, anon, authenticated;

grant select, insert, update, delete on table
  public.trading_account_snapshots,
  public.trading_fills,
  public.trading_cash_events,
  public.trading_trade_cycles,
  public.trading_trade_cycle_revisions,
  public.trading_trade_cycle_lineage,
  public.trading_trade_reviews,
  public.trading_sync_cursors,
  public.trading_sync_batches,
  public.trading_delete_queue,
  public.trading_deletion_audit
to service_role;

grant usage, select on all sequences in schema public to service_role;

create or replace function public.upsert_exchange_credential_set(
  p_owner_id uuid,
  p_provider text,
  p_label text,
  p_secret_mask text,
  p_ciphertext text,
  p_iv text,
  p_auth_tag text,
  p_key_version integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  credential_id uuid;
begin
  if p_provider not in ('binance', 'okx', 'bybit', 'bitget', 'exness')
     or char_length(trim(coalesce(p_label, ''))) not between 1 and 80
     or char_length(coalesce(p_secret_mask, '')) > 32 then
    raise exception 'invalid_exchange_credentials';
  end if;

  insert into public.exchange_credential_sets (
    owner_id, provider, label, secret_mask, status
  ) values (
    p_owner_id, p_provider, trim(p_label), p_secret_mask, 'active'
  ) returning id into credential_id;

  insert into public.exchange_credential_secrets (
    credential_set_id, owner_id, ciphertext, iv, auth_tag, key_version
  ) values (
    credential_id, p_owner_id, p_ciphertext, p_iv, p_auth_tag, p_key_version
  );
  return credential_id;
end;
$$;

create or replace function public.rotate_exchange_credential_set(
  p_owner_id uuid,
  p_credential_set_id uuid,
  p_secret_mask text,
  p_ciphertext text,
  p_iv text,
  p_auth_tag text,
  p_key_version integer
)
returns public.exchange_credential_sets
language plpgsql
security definer
set search_path = ''
as $$
declare
  credentials public.exchange_credential_sets;
begin
  select * into credentials
  from public.exchange_credential_sets
  where id = p_credential_set_id and owner_id = p_owner_id
  for update;
  if credentials.id is null then raise exception 'exchange_connection_not_found'; end if;
  if char_length(coalesce(p_secret_mask, '')) > 32 then raise exception 'invalid_exchange_credentials'; end if;

  update public.exchange_credential_secrets
  set active = false, rotated_at = now()
  where credential_set_id = credentials.id and owner_id = credentials.owner_id and active;

  insert into public.exchange_credential_secrets (
    credential_set_id, owner_id, ciphertext, iv, auth_tag, key_version, active
  ) values (
    credentials.id, credentials.owner_id, p_ciphertext, p_iv, p_auth_tag,
    p_key_version, true
  );

  update public.exchange_credential_sets
  set secret_mask = p_secret_mask, status = 'active', updated_at = now()
  where id = credentials.id
  returning * into credentials;
  return credentials;
end;
$$;

-- Keep the currently deployed Gateway compatible during the rolling release.
-- The legacy v2 boundary now writes both the legacy snapshot/secret tables and
-- the new credential-set model without changing its public signature.
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
  credential_id uuid;
begin
  if coalesce(p_public_enabled, false) and p_public_amounts_consent is not true then
    raise exception 'public amounts consent required';
  end if;
  if char_length(trim(coalesce(p_label, ''))) not between 2 and 60
     or char_length(coalesce(p_api_key_last_four, '')) > 4
     or p_equity_usdt < 0 then
    raise exception 'invalid exchange connection';
  end if;

  update public.exchange_connections
  set status = 'disabled', sync_status = 'disabled', public_enabled = false
  where owner_id = p_owner_id and provider = 'binance' and status <> 'disabled';

  update public.exchange_connection_secrets legacy_secret
  set active = false, rotated_at = now()
  where legacy_secret.owner_id = p_owner_id
    and legacy_secret.active
    and exists (
      select 1 from public.exchange_connections linked_connection
      where linked_connection.id = legacy_secret.connection_id
        and linked_connection.provider = 'binance'
        and linked_connection.status = 'disabled'
    );

  update public.exchange_credential_secrets secret
  set active = false, rotated_at = now()
  where secret.owner_id = p_owner_id
    and secret.active
    and not exists (
      select 1 from public.exchange_connections linked_connection
      where linked_connection.credential_set_id = secret.credential_set_id
        and linked_connection.status in ('pending_verification', 'active', 'error')
    );

  update public.exchange_credential_sets credentials
  set status = 'disabled', updated_at = now()
  where credentials.owner_id = p_owner_id
    and credentials.provider = 'binance'
    and not exists (
      select 1 from public.exchange_connections linked_connection
      where linked_connection.credential_set_id = credentials.id
        and linked_connection.status in ('pending_verification', 'active', 'error')
    );

  insert into public.exchange_credential_sets (
    owner_id, provider, label, secret_mask, status
  ) values (
    p_owner_id, 'binance', trim(p_label), '••••' || p_api_key_last_four, 'active'
  ) returning id into credential_id;

  insert into public.exchange_credential_secrets (
    credential_set_id, owner_id, ciphertext, iv, auth_tag, key_version
  ) values (
    credential_id, p_owner_id, p_ciphertext, p_iv, p_auth_tag, p_key_version
  );

  insert into public.exchange_connections (
    owner_id, exchange, market, label, public_enabled, status,
    api_key_last_four, read_only_ack_at, started_at, last_synced_at,
    public_amounts_consented_at, provider, credential_set_id,
    account_label, account_identifier_mask, account_currency,
    capabilities, equity_tracking_started_at, sync_status
  ) values (
    p_owner_id, 'binance', 'usdm_futures', trim(p_label),
    coalesce(p_public_enabled, false), 'active', p_api_key_last_four,
    now(), p_captured_at, p_captured_at,
    case when coalesce(p_public_enabled, false) then now() else null end,
    'binance', credential_id, trim(p_label), '••••' || p_api_key_last_four,
    'USDT', '{}'::jsonb, p_captured_at, 'idle'
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

create or replace function public.upsert_exchange_connection_v3(
  p_owner_id uuid,
  p_provider text,
  p_credential_set_id uuid,
  p_external_account_id_hash text,
  p_account_label text,
  p_account_identifier_mask text,
  p_account_currency text,
  p_capabilities jsonb,
  p_history_coverage_started_at timestamptz,
  p_equity_tracking_started_at timestamptz
)
returns public.exchange_connections
language plpgsql
security definer
set search_path = ''
as $$
declare
  connection public.exchange_connections;
  existing_owner uuid;
begin
  if p_provider not in ('binance', 'okx', 'bybit', 'bitget', 'exness')
     or p_external_account_id_hash is null
     or char_length(trim(coalesce(p_account_label, ''))) not between 1 and 80
     or not exists (
       select 1 from public.exchange_credential_sets
       where id = p_credential_set_id and owner_id = p_owner_id and provider = p_provider
     ) then
    raise exception 'invalid_exchange_connection';
  end if;

  select owner_id into existing_owner
  from public.exchange_connections
  where provider = p_provider and external_account_id_hash = p_external_account_id_hash
  order by created_at limit 1;
  if existing_owner is not null and existing_owner <> p_owner_id then
    raise exception 'account_unavailable';
  end if;

  select * into connection
  from public.exchange_connections
  where owner_id = p_owner_id
    and provider = p_provider
    and external_account_id_hash = p_external_account_id_hash
  for update;

  if connection.id is null then
    insert into public.exchange_connections (
      owner_id, exchange, market, label, public_enabled, status,
      api_key_last_four, read_only_ack_at, started_at, provider,
      credential_set_id, external_account_id_hash, account_label,
      account_identifier_mask, account_currency, capabilities,
      history_coverage_started_at, equity_tracking_started_at, sync_status
    ) values (
      p_owner_id, p_provider,
      case when p_provider = 'binance' then 'usdm_futures' else 'derivatives' end,
      trim(p_account_label), false, 'active', right(p_account_identifier_mask, 4),
      now(), coalesce(p_equity_tracking_started_at, now()), p_provider,
      p_credential_set_id, p_external_account_id_hash, trim(p_account_label),
      p_account_identifier_mask, upper(p_account_currency), coalesce(p_capabilities, '{}'::jsonb),
      p_history_coverage_started_at, coalesce(p_equity_tracking_started_at, now()), 'idle'
    ) returning * into connection;
  else
    update public.exchange_connections
    set credential_set_id = p_credential_set_id,
        account_label = trim(p_account_label),
        label = trim(p_account_label),
        account_identifier_mask = p_account_identifier_mask,
        api_key_last_four = right(p_account_identifier_mask, 4),
        account_currency = upper(p_account_currency),
        capabilities = coalesce(p_capabilities, '{}'::jsonb),
        history_coverage_started_at = coalesce(
          least(history_coverage_started_at, p_history_coverage_started_at),
          history_coverage_started_at,
          p_history_coverage_started_at
        ),
        status = 'active', sync_status = 'idle', data_hidden_at = null,
        last_error_code = '', consecutive_failures = 0
    where id = connection.id
    returning * into connection;
  end if;
  return connection;
exception
  when unique_violation then
    raise exception 'account_unavailable';
end;
$$;

create or replace function public.claim_exchange_sync_connection(
  p_connection_id uuid,
  p_worker_id uuid,
  p_now timestamptz,
  p_lease_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_lease_seconds not between 30 and 900 then raise exception 'invalid_sync_lease'; end if;
  update public.exchange_connections
  set lease_owner = p_worker_id,
      lease_until = p_now + make_interval(secs => p_lease_seconds),
      sync_status = 'syncing'
  where id = p_connection_id
    and status in ('active', 'error')
    and (lease_until is null or lease_until <= p_now or lease_owner = p_worker_id);
  return found;
end;
$$;

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

create or replace function public.record_exchange_sync_failure_v3(
  p_connection_id uuid,
  p_owner_id uuid,
  p_worker_id uuid,
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  connection public.exchange_connections;
begin
  if p_error_code !~ '^[a-z0-9_-]{3,80}$' then raise exception 'invalid_sync_error'; end if;
  update public.exchange_connections
  set status = 'error', sync_status = 'idle', last_error_code = p_error_code,
      consecutive_failures = consecutive_failures + 1,
      lease_owner = null, lease_until = null
  where id = p_connection_id and owner_id = p_owner_id and lease_owner = p_worker_id
  returning * into connection;
  if connection.id is null then return false; end if;

  insert into public.trading_sync_batches (
    connection_id, owner_id, expected_generation, published_generation,
    status, safe_error_code, started_at, finished_at
  ) values (
    connection.id, connection.owner_id, connection.sync_generation, null,
    'failed', p_error_code, now(), now()
  );
  return true;
end;
$$;

create or replace function public.save_trading_trade_review(
  p_owner_id uuid,
  p_cycle_id uuid,
  p_expected_revision integer,
  p_reason text,
  p_plan_compliance text,
  p_next_improvement text,
  p_tags text[],
  p_planned_stop_price numeric,
  p_planned_risk_amount numeric
)
returns public.trading_trade_reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  cycle public.trading_trade_cycles;
  review public.trading_trade_reviews;
begin
  select * into cycle from public.trading_trade_cycles
  where id = p_cycle_id and owner_id = p_owner_id and is_current;
  if cycle.id is null then raise exception 'trade_cycle_not_found'; end if;
  if cycle.revision <> p_expected_revision then raise exception 'stale_trade_cycle_revision'; end if;
  if p_plan_compliance not in ('unset', 'yes', 'partial', 'no')
     or char_length(coalesce(p_reason, '')) > 5000
     or char_length(coalesce(p_next_improvement, '')) > 5000
     or coalesce(array_length(p_tags, 1), 0) > 20 then
    raise exception 'invalid_trade_review';
  end if;

  insert into public.trading_trade_reviews (
    cycle_id, owner_id, cycle_revision, reason, plan_compliance,
    next_improvement, tags, planned_stop_price, planned_risk_amount
  ) values (
    cycle.id, cycle.owner_id, cycle.revision, coalesce(p_reason, ''),
    p_plan_compliance, coalesce(p_next_improvement, ''), coalesce(p_tags, '{}'),
    p_planned_stop_price, p_planned_risk_amount
  ) on conflict (cycle_id) do update
  set cycle_revision = excluded.cycle_revision,
      reason = excluded.reason,
      plan_compliance = excluded.plan_compliance,
      next_improvement = excluded.next_improvement,
      tags = excluded.tags,
      planned_stop_price = excluded.planned_stop_price,
      planned_risk_amount = excluded.planned_risk_amount,
      updated_at = now()
  returning * into review;
  return review;
end;
$$;

create or replace function public.disconnect_exchange_connection_v3(
  p_owner_id uuid,
  p_connection_id uuid
)
returns public.exchange_connections
language plpgsql
security definer
set search_path = ''
as $$
declare
  connection public.exchange_connections;
begin
  update public.exchange_connections
  set status = 'disabled', sync_status = 'disabled', public_enabled = false,
      lease_owner = null, lease_until = null
  where id = p_connection_id and owner_id = p_owner_id and status <> 'deleting'
  returning * into connection;
  if connection.id is null then raise exception 'exchange_connection_not_found'; end if;

  update public.exchange_connection_secrets
  set active = false, rotated_at = now()
  where connection_id = connection.id and owner_id = connection.owner_id and active;

  if not exists (
    select 1 from public.exchange_connections
    where credential_set_id = connection.credential_set_id
      and id <> connection.id
      and status in ('pending_verification', 'active', 'error')
  ) then
    update public.exchange_credential_secrets
    set active = false, rotated_at = now()
    where credential_set_id = connection.credential_set_id and active;
    update public.exchange_credential_sets
    set status = 'disabled', updated_at = now()
    where id = connection.credential_set_id;
  end if;
  return connection;
end;
$$;

create or replace function public.request_trading_data_deletion(
  p_owner_id uuid,
  p_connection_id uuid
)
returns public.trading_delete_queue
language plpgsql
security definer
set search_path = ''
as $$
declare
  connection public.exchange_connections;
  queued public.trading_delete_queue;
begin
  update public.exchange_connections
  set status = 'deleting', sync_status = 'deleting', public_enabled = false,
      data_hidden_at = now(), lease_owner = null, lease_until = null
  where id = p_connection_id and owner_id = p_owner_id
  returning * into connection;
  if connection.id is null then raise exception 'exchange_connection_not_found'; end if;

  update public.exchange_connection_secrets
  set active = false, rotated_at = now()
  where connection_id = connection.id and owner_id = connection.owner_id and active;
  if not exists (
    select 1 from public.exchange_connections
    where credential_set_id = connection.credential_set_id
      and id <> connection.id
      and status in ('pending_verification', 'active', 'error')
  ) then
    update public.exchange_credential_secrets
    set active = false, rotated_at = now()
    where credential_set_id = connection.credential_set_id and active;
  end if;

  insert into public.trading_delete_queue (
    connection_id, owner_id, provider, requested_at, hard_delete_after
  ) values (
    connection.id, connection.owner_id, connection.provider, now(), now() + interval '30 days'
  ) on conflict (connection_id) do update
  set requested_at = least(public.trading_delete_queue.requested_at, excluded.requested_at),
      hard_delete_after = least(public.trading_delete_queue.hard_delete_after, excluded.hard_delete_after)
  returning * into queued;
  return queued;
end;
$$;

create or replace function public.purge_due_trading_data(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  queued public.trading_delete_queue;
  credential_id uuid;
  purged integer := 0;
begin
  delete from public.trading_deletion_audit where expires_at <= p_now;
  for queued in
    select * from public.trading_delete_queue
    where hard_delete_after <= p_now
    order by hard_delete_after
    for update skip locked
  loop
    select credential_set_id into credential_id
    from public.exchange_connections where id = queued.connection_id;

    insert into public.trading_deletion_audit (
      owner_id, provider, deleted_at, expires_at
    ) values (
      queued.owner_id, queued.provider, p_now, p_now + interval '90 days'
    );
    delete from public.exchange_connections
    where id = queued.connection_id and owner_id = queued.owner_id;
    if credential_id is not null and not exists (
      select 1 from public.exchange_connections where credential_set_id = credential_id
    ) then
      delete from public.exchange_credential_sets where id = credential_id;
    end if;
    purged := purged + 1;
  end loop;
  return purged;
end;
$$;

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
  with eligible as (
    select
      connection.owner_id,
      connection.started_at,
      connection.last_synced_at,
      summary.return_factor - 1 as connection_return,
      summary.current_equity_usdt,
      summary.cumulative_profit_usdt,
      greatest(summary.current_equity_usdt - summary.cumulative_profit_usdt, 0) as baseline_equity
    from public.exchange_connections connection
    join public.trading_return_summaries summary on summary.connection_id = connection.id
    where connection.status in ('active', 'error')
      and connection.data_hidden_at is null
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
  ), rolled as (
    select
      eligible.owner_id,
      sum(eligible.current_equity_usdt) as current_equity_usdt,
      sum(eligible.cumulative_profit_usdt) as cumulative_profit_usdt,
      case
        when sum(eligible.baseline_equity) > 0 then
          sum(eligible.connection_return * eligible.baseline_equity) / sum(eligible.baseline_equity)
        else avg(eligible.connection_return)
      end as return_rate,
      min(eligible.started_at) as tracking_started_at,
      min(eligible.last_synced_at) as last_synced_at
    from eligible group by eligible.owner_id
  ), ranked as (
    select
      profile.id as user_id,
      profile.public_uid,
      profile.display_name,
      profile.avatar_url,
      profile.display_title,
      profile.nameplate_style,
      rolled.return_rate,
      rolled.current_equity_usdt,
      rolled.cumulative_profit_usdt,
      rolled.tracking_started_at,
      rolled.last_synced_at
    from rolled
    join public.profiles profile on profile.id = rolled.owner_id
    where profile.public_uid is not null and profile.account_status = 'active'
  )
  select
    row_number() over (order by ranked.return_rate desc, ranked.tracking_started_at asc),
    ranked.user_id,
    ranked.public_uid,
    ranked.display_name,
    ranked.avatar_url,
    ranked.display_title,
    ranked.nameplate_style,
    ranked.return_rate,
    ranked.current_equity_usdt::text,
    ranked.cumulative_profit_usdt::text,
    ranked.tracking_started_at,
    ranked.last_synced_at
  from ranked
  order by ranked.return_rate desc, ranked.tracking_started_at asc
  limit least(greatest(coalesce(p_limit, 50), 3), 100);
$$;

revoke all on function public.upsert_exchange_credential_set(uuid, text, text, text, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.rotate_exchange_credential_set(uuid, uuid, text, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.upsert_exchange_connection_v3(uuid, text, uuid, text, text, text, text, jsonb, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_exchange_sync_connection(uuid, uuid, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.publish_exchange_sync_generation(uuid, uuid, bigint, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.record_exchange_sync_failure_v3(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.save_trading_trade_review(uuid, uuid, integer, text, text, text, text[], numeric, numeric) from public, anon, authenticated;
revoke all on function public.disconnect_exchange_connection_v3(uuid, uuid) from public, anon, authenticated;
revoke all on function public.request_trading_data_deletion(uuid, uuid) from public, anon, authenticated;
revoke all on function public.purge_due_trading_data(timestamptz) from public, anon, authenticated;
grant execute on function public.upsert_exchange_credential_set(uuid, text, text, text, text, text, text, integer) to service_role;
grant execute on function public.rotate_exchange_credential_set(uuid, uuid, text, text, text, text, integer) to service_role;
grant execute on function public.upsert_exchange_connection_v3(uuid, text, uuid, text, text, text, text, jsonb, timestamptz, timestamptz) to service_role;
grant execute on function public.claim_exchange_sync_connection(uuid, uuid, timestamptz, integer) to service_role;
grant execute on function public.publish_exchange_sync_generation(uuid, uuid, bigint, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, timestamptz) to service_role;
grant execute on function public.record_exchange_sync_failure_v3(uuid, uuid, uuid, text) to service_role;
grant execute on function public.save_trading_trade_review(uuid, uuid, integer, text, text, text, text[], numeric, numeric) to service_role;
grant execute on function public.disconnect_exchange_connection_v3(uuid, uuid) to service_role;
grant execute on function public.request_trading_data_deletion(uuid, uuid) to service_role;
grant execute on function public.purge_due_trading_data(timestamptz) to service_role;
revoke all on function public.list_trading_leaderboard(text, integer) from public;
grant execute on function public.list_trading_leaderboard(text, integer) to anon, authenticated;

create or replace function public.wavekb_schema_version()
returns text
language sql
stable
security definer
set search_path = ''
as $$ select '202611240001'::text $$;

revoke all on function public.wavekb_schema_version() from public;
grant execute on function public.wavekb_schema_version() to anon, authenticated;

notify pgrst, 'reload schema';

commit;
