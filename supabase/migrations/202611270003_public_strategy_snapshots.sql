begin;

-- The preview and snapshot store the same public DTO. Task-specific field and
-- calculation rules are applied by the server-side projector before insertion.
create function public.is_public_strategy_projection(payload jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  required_keys constant text[] := array[
    'schema_version', 'renderer_schema_version', 'calculation_engine_version',
    'provider', 'product', 'symbol', 'timeframe', 'price_type', 'range',
    'snapshot_status', 'candles', 'markers', 'public_annotations', 'indicators',
    'drawings', 'coverage', 'show_quantity', 'show_absolute_pnl', 'price_return_rate'
  ];
  public_optional_keys constant text[] := array[
    'direction', 'warnings', 'price_return_label', 'quantity', 'absolute_pnl'
  ];
  candle_required_keys constant text[] := array['open_time', 'close_time', 'open', 'high', 'low', 'close'];
  candle_optional_keys constant text[] := array['series_basis', 'volume', 'status', 'gap_before', 'gap_after'];
  marker_required_keys constant text[] := array['marker_key', 'occurred_at', 'price', 'allocation_role', 'side'];
  marker_optional_keys constant text[] := array['position_side', 'liquidity', 'quantity', 'absolute_pnl'];
  timestamp_pattern constant text := '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$';
  price_pattern constant text := '^(0|[1-9][0-9]*)(\.[0-9]+)?$';
  range_from text := payload#>>'{range,from}';
  range_to text := payload#>>'{range,to}';
  show_quantity boolean;
  show_pnl boolean;
begin
  if jsonb_typeof(payload) <> 'object'
     or not payload ?& required_keys
     or payload - (required_keys || public_optional_keys) <> '{}'::jsonb
     or octet_length(payload::text) > 4194304
     or payload->>'schema_version' <> 'wavekb-public-strategy-snapshot-v1'
     or jsonb_typeof(payload->'renderer_schema_version') <> 'string'
     or length(payload->>'renderer_schema_version') not between 1 and 64
     or jsonb_typeof(payload->'calculation_engine_version') <> 'string'
     or length(payload->>'calculation_engine_version') not between 1 and 64
     or payload->>'provider' not in ('binance', 'okx', 'bybit', 'bitget', 'exness')
     or payload->>'product' not in ('usdt_perpetual', 'usdt_delivery', 'cfd')
     or jsonb_typeof(payload->'symbol') <> 'string'
     or length(btrim(payload->>'symbol')) not between 1 and 80
     or payload->>'timeframe' not in ('1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '1w', '1M')
     or payload->>'price_type' not in ('trade', 'mark', 'bid', 'ask', 'both')
     or payload->>'snapshot_status' not in ('closed', 'open_at_snapshot')
     or jsonb_typeof(payload->'range') <> 'object'
     or (payload->'range') - array['from', 'to'] <> '{}'::jsonb
     or range_from is null or range_to is null
     or range_from !~ timestamp_pattern
     or range_to !~ timestamp_pattern
     or range_from >= range_to
     or jsonb_typeof(payload->'coverage') <> 'object'
     or jsonb_typeof(payload->'show_quantity') <> 'boolean'
     or jsonb_typeof(payload->'show_absolute_pnl') <> 'boolean'
     or jsonb_typeof(payload->'price_return_rate') not in ('string', 'null')
     or (jsonb_typeof(payload->'price_return_rate') = 'string'
         and payload->>'price_return_rate' !~ '^-?(0|[1-9][0-9]*)(\.[0-9]+)?$')
     or jsonb_typeof(payload->'candles') <> 'array'
     or jsonb_typeof(payload->'markers') <> 'array'
     or jsonb_typeof(payload->'public_annotations') <> 'array'
     or jsonb_typeof(payload->'indicators') <> 'array'
     or jsonb_typeof(payload->'drawings') <> 'array'
     or exists (
       select 1 from unnest(required_keys) key
       where key <> 'price_return_rate' and payload->key = 'null'::jsonb
     ) then
    return false;
  end if;
  if jsonb_array_length(payload->'candles') not between 1 and 3000
     or jsonb_array_length(payload->'markers') not between 1 and 10000
     or jsonb_array_length(payload->'public_annotations') > jsonb_array_length(payload->'markers')
     or jsonb_array_length(payload->'indicators') > 32
     or jsonb_array_length(payload->'drawings') > 200 then
    return false;
  end if;

  show_quantity := (payload->>'show_quantity')::boolean;
  show_pnl := (payload->>'show_absolute_pnl')::boolean;
  -- The projector supplies a full allowlist. This second gate stops private
  -- identities and the most direct hidden values from reaching public rows.
  if jsonb_path_exists(payload, 'strict $.** ? (
       exists(@.owner_id) || exists(@.cycle_id) || exists(@.connection_id)
       || exists(@.account_id) || exists(@.account_name) || exists(@.account_label)
       || exists(@.credential_set_id) || exists(@.api_key) || exists(@.api_secret)
       || exists(@.private_key) || exists(@.raw_payload) || exists(@.storage_path)
       || exists(@.native_order_id) || exists(@.native_fill_id) || exists(@.fill_id)
       || exists(@.native_position_id) || exists(@.source_fill_digest)
       || exists(@.balance) || exists(@.equity) || exists(@.leverage) || exists(@.margin)
       || exists(@.roi) || exists(@.account_roi)
     )') then
    return false;
  end if;
  if not show_quantity and jsonb_path_exists(payload, 'strict $.** ? (
       exists(@.quantity) || exists(@.allocated_quantity) || exists(@.lot_quantity)
       || exists(@.notional) || exists(@.notional_value) || exists(@.position_size)
       || exists(@.accountSize)
     )') then
    return false;
  end if;
  if not show_pnl and jsonb_path_exists(payload, 'strict $.** ? (
       exists(@.absolute_pnl) || exists(@.realized_pnl) || exists(@.net_pnl)
       || exists(@.usd_net_pnl) || exists(@.fees) || exists(@.funding_or_swap)
       || exists(@.dividends)
     )') then
    return false;
  end if;
  if exists (
    select 1 from jsonb_array_elements(payload->'candles') candle
    where case when jsonb_typeof(candle) <> 'object' then true else
      not candle ?& candle_required_keys
      or candle - (candle_required_keys || candle_optional_keys) <> '{}'::jsonb
      or exists (
        select 1 from unnest(candle_required_keys) key
        where jsonb_typeof(candle->key) is distinct from 'string'
          or candle->>key !~ case when key in ('open_time', 'close_time') then timestamp_pattern else price_pattern end
      )
      or candle->>'open_time' >= candle->>'close_time'
      or (candle ? 'series_basis' and coalesce(candle->>'series_basis', '') not in ('trade','mark','bid','ask'))
      or (candle ? 'status' and coalesce(candle->>'status', '') not in ('final','partial'))
      or (candle ? 'gap_before' and jsonb_typeof(candle->'gap_before') <> 'boolean')
      or (candle ? 'gap_after' and jsonb_typeof(candle->'gap_after') <> 'boolean')
      or (candle ? 'volume' and candle->'volume' <> 'null'::jsonb and (
          jsonb_typeof(candle->'volume') <> 'string' or candle->>'volume' !~ price_pattern
      ))
    end
  ) then
    return false;
  end if;
  if exists (
    select 1 from jsonb_array_elements(payload->'markers') marker
    where case when jsonb_typeof(marker) <> 'object' then true else
      not marker ?& marker_required_keys
      or marker - (marker_required_keys || marker_optional_keys) <> '{}'::jsonb
      or exists (
        select 1 from unnest(marker_required_keys) key
        where jsonb_typeof(marker->key) is distinct from 'string'
      )
      or marker->>'marker_key' !~ '^[0-9a-f]{32}$'
      or marker->>'occurred_at' !~ timestamp_pattern
      or marker->>'price' !~ price_pattern
      or marker->>'allocation_role' not in ('open','add','reduce','close','reverse_open')
      or marker->>'side' not in ('buy','sell')
      or (marker ? 'position_side' and coalesce(marker->>'position_side', '') not in ('both','long','short'))
      or (marker ? 'liquidity' and coalesce(marker->>'liquidity', '') not in ('maker','taker','unknown'))
      or (marker ? 'quantity' and (jsonb_typeof(marker->'quantity') <> 'string' or marker->>'quantity' !~ price_pattern))
    end
  ) or exists (
    select 1 from jsonb_array_elements(payload->'markers') marker
    group by marker->>'marker_key' having count(*) > 1
  ) then
    return false;
  end if;
  return true;
end;
$$;

revoke all on function public.is_public_strategy_projection(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.is_public_strategy_projection(jsonb) to service_role;

create table public.public_strategy_snapshots (
  id uuid primary key default gen_random_uuid(),
  -- The post ID remains immutable during the private deletion-retention
  -- window. An insert trigger binds it to the post and a delete trigger hides
  -- the snapshot immediately, including on account-deletion cascades.
  post_id uuid not null unique,
  author_id uuid not null,
  supersedes_post_id uuid,
  projection_digest text not null check (projection_digest ~ '^[0-9a-f]{64}$'),
  projection jsonb not null check (public.is_public_strategy_projection(projection)),
  created_at timestamptz not null default now(),
  visibility_status text not null default 'active'
    check (visibility_status in ('active', 'unpublished', 'tombstoned')),
  visibility_changed_at timestamptz not null default now(),
  constraint public_strategy_snapshot_distinct_predecessor check (supersedes_post_id is distinct from post_id),
  constraint public_strategy_snapshot_post_author_unique unique (post_id, author_id)
);

create index public_strategy_snapshots_author_created_idx
on public.public_strategy_snapshots (author_id, created_at desc, id);

create index public_strategy_snapshots_tombstone_idx
on public.public_strategy_snapshots (visibility_changed_at, id)
where visibility_status = 'tombstoned';

create table public.trading_post_sources (
  post_id uuid primary key references public.posts(id) on delete cascade,
  owner_id uuid not null,
  cycle_id uuid not null,
  source_revision integer not null check (source_revision > 0),
  source_fill_digest text not null check (length(source_fill_digest) between 1 and 256),
  created_at timestamptz not null default now(),
  constraint trading_post_sources_snapshot_owner_fkey
    foreign key (post_id, owner_id)
    references public.public_strategy_snapshots (post_id, author_id) on delete cascade,
  constraint trading_post_sources_cycle_owner_fkey
    foreign key (cycle_id, owner_id)
    references public.trading_trade_cycles (id, owner_id) on delete cascade
);

create index trading_post_sources_cycle_owner_idx
on public.trading_post_sources (cycle_id, owner_id);

create table public.strategy_share_previews (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  cycle_id uuid not null,
  cycle_revision integer not null check (cycle_revision > 0),
  source_fill_digest text not null check (length(source_fill_digest) between 1 and 256),
  chart_state_version integer not null check (chart_state_version >= 0),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key uuid not null default gen_random_uuid(),
  projection_digest text not null check (projection_digest ~ '^[0-9a-f]{64}$'),
  projection jsonb not null check (public.is_public_strategy_projection(projection)),
  show_quantity boolean generated always as ((projection->>'show_quantity')::boolean) stored not null,
  show_absolute_pnl boolean generated always as ((projection->>'show_absolute_pnl')::boolean) stored not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  consumed_at timestamptz,
  published_post_id uuid,
  constraint strategy_share_preview_cycle_owner_fkey
    foreign key (cycle_id, owner_id)
    references public.trading_trade_cycles (id, owner_id) on delete cascade,
  constraint strategy_share_preview_owner_request_unique unique (owner_id, idempotency_key),
  constraint strategy_share_preview_expiry_check
    check (expires_at > created_at and expires_at <= created_at + interval '15 minutes'),
  constraint strategy_share_preview_consumption_check check (
    (consumed_at is null and published_post_id is null)
    or (consumed_at is not null and published_post_id is not null
        and consumed_at >= created_at and consumed_at <= expires_at)
  )
);

create index strategy_share_previews_expiry_idx
on public.strategy_share_previews (expires_at, id)
where consumed_at is null;

create index strategy_share_previews_cycle_owner_idx
on public.strategy_share_previews (cycle_id, owner_id);

create function public.guard_strategy_share_preview_consumption()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.consumed_at is not null or new.published_post_id is not null then
      raise exception 'invalid_strategy_share_consumption';
    end if;
    return new;
  end if;
  if old.consumed_at is not null then
    if (new.consumed_at, new.published_post_id) is distinct from
       (old.consumed_at, old.published_post_id) then
      raise exception 'strategy_share_preview_consumed';
    end if;
    return new;
  end if;
  if new.consumed_at is null and new.published_post_id is null then
    return new;
  end if;
  if old.expires_at < clock_timestamp() or not exists (
    select 1 from public.public_strategy_snapshots snapshot
    join public.trading_post_sources source on source.post_id = snapshot.post_id
    where snapshot.post_id = new.published_post_id
      and snapshot.author_id = old.owner_id
      and snapshot.projection_digest = old.projection_digest
      and snapshot.projection = old.projection
      and snapshot.visibility_status = 'active'
      and source.owner_id = old.owner_id
      and source.cycle_id = old.cycle_id
      and source.source_revision = old.cycle_revision
      and source.source_fill_digest = old.source_fill_digest
  ) then
    raise exception 'invalid_strategy_share_consumption';
  end if;
  return new;
end;
$$;

create trigger guard_strategy_share_preview_consumption
before insert or update of consumed_at, published_post_id on public.strategy_share_previews
for each row execute function public.guard_strategy_share_preview_consumption();
revoke all on function public.guard_strategy_share_preview_consumption() from public, anon, authenticated, service_role;

alter table public.public_strategy_snapshots enable row level security;
alter table public.public_strategy_snapshots force row level security;
alter table public.trading_post_sources enable row level security;
alter table public.trading_post_sources force row level security;
alter table public.strategy_share_previews enable row level security;
alter table public.strategy_share_previews force row level security;

revoke all on public.public_strategy_snapshots, public.trading_post_sources, public.strategy_share_previews
from public, anon, authenticated, service_role;
grant select on public.public_strategy_snapshots to anon, authenticated;
grant select, insert, update, delete on public.public_strategy_snapshots to service_role;
grant select, insert, delete on public.trading_post_sources to service_role;
grant select, insert, delete on public.strategy_share_previews to service_role;
grant update (consumed_at, published_post_id) on public.strategy_share_previews to service_role;

create policy public_strategy_snapshots_read_published_post
on public.public_strategy_snapshots for select to anon, authenticated
using (
  visibility_status = 'active'
  and exists (
    select 1 from public.posts post
    where post.id = public_strategy_snapshots.post_id
      and post.author_id = public_strategy_snapshots.author_id
      and post.status = 'published'
      and post.chart_package->>'provider' = 'wavekb-trade-snapshot'
      and post.chart_package->>'snapshot_id' = public_strategy_snapshots.id::text
  )
);

create function public.guard_public_strategy_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform 1 from public.posts post
    where post.id = new.post_id
      and post.author_id = new.author_id
      and post.status in ('draft', 'published')
      and post.chart_package->>'provider' = 'wavekb-trade-snapshot'
      and post.chart_package->>'snapshot_id' = new.id::text
    for share;
    if not found then raise exception 'invalid_strategy_snapshot_post'; end if;
    if new.supersedes_post_id is not null and not exists (
      select 1 from public.public_strategy_snapshots prior
      join public.posts post on post.id = prior.post_id and post.author_id = prior.author_id
      where prior.post_id = new.supersedes_post_id and prior.author_id = new.author_id
        and prior.visibility_status = 'active' and post.status = 'published'
        and post.chart_package->>'provider' = 'wavekb-trade-snapshot'
        and post.chart_package->>'snapshot_id' = prior.id::text
    ) then
      raise exception 'invalid_strategy_snapshot_predecessor';
    end if;
    if new.visibility_status <> 'active' then raise exception 'invalid_strategy_snapshot_visibility'; end if;
    new.visibility_changed_at := new.created_at;
    return new;
  end if;

  if (new.id, new.post_id, new.author_id, new.supersedes_post_id, new.projection_digest, new.projection, new.created_at)
     is distinct from
     (old.id, old.post_id, old.author_id, old.supersedes_post_id, old.projection_digest, old.projection, old.created_at) then
    raise exception 'strategy_snapshot_immutable';
  end if;
  if old.visibility_status = 'tombstoned' and new.visibility_status <> old.visibility_status then
    raise exception 'strategy_snapshot_tombstoned';
  end if;
  new.visibility_changed_at := case when new.visibility_status is distinct from old.visibility_status
                                    then clock_timestamp() else old.visibility_changed_at end;
  return new;
end;
$$;

create trigger guard_public_strategy_snapshot
before insert or update on public.public_strategy_snapshots
for each row execute function public.guard_public_strategy_snapshot();
revoke all on function public.guard_public_strategy_snapshot() from public, anon, authenticated, service_role;

create function public.tombstone_deleted_post_strategy_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.public_strategy_snapshots
  set visibility_status = 'tombstoned'
  where post_id = old.id and visibility_status <> 'tombstoned';
  return old;
end;
$$;

create trigger tombstone_deleted_post_strategy_snapshot
after delete on public.posts
for each row execute function public.tombstone_deleted_post_strategy_snapshot();
revoke all on function public.tombstone_deleted_post_strategy_snapshot() from public, anon, authenticated, service_role;

alter table public.post_comments
add column marker_key text check (marker_key is null or marker_key ~ '^[0-9a-f]{32}$');

create index post_comments_post_marker_created_idx
on public.post_comments (post_id, marker_key, created_at, id)
where marker_key is not null;

create function public.validate_strategy_comment_marker()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  inherited_marker text;
begin
  if tg_op = 'UPDATE' and (
    new.marker_key is distinct from old.marker_key
    or (old.marker_key is not null and (
      new.post_id is distinct from old.post_id or new.parent_id is distinct from old.parent_id
    ))
  ) then
    raise exception 'strategy_comment_marker_immutable';
  end if;

  if new.parent_id is not null then
    -- The existing validate_comment_parent trigger checks the same post and
    -- disallows replies to replies before this trigger runs.
    select parent.marker_key into inherited_marker
    from public.post_comments parent where parent.id = new.parent_id;
    if not found or (new.marker_key is not null and new.marker_key is distinct from inherited_marker) then
      raise exception 'invalid_strategy_comment_marker';
    end if;
    if tg_op = 'UPDATE' and new.marker_key is distinct from inherited_marker then
      raise exception 'strategy_comment_marker_immutable';
    end if;
    new.marker_key := inherited_marker;
  end if;

  if new.marker_key is not null and not exists (
    select 1 from public.public_strategy_snapshots snapshot
    join public.posts post on post.id = snapshot.post_id and post.author_id = snapshot.author_id
    where snapshot.post_id = new.post_id
      and snapshot.visibility_status = 'active'
      and post.status = 'published' and post.comments_enabled
      and post.chart_package->>'provider' = 'wavekb-trade-snapshot'
      and post.chart_package->>'snapshot_id' = snapshot.id::text
      and snapshot.projection->'markers' @> jsonb_build_array(jsonb_build_object('marker_key', new.marker_key))
  ) then
    raise exception 'invalid_strategy_comment_marker';
  end if;
  return new;
end;
$$;

create trigger validate_strategy_comment_marker
before insert or update of marker_key, post_id, parent_id on public.post_comments
for each row execute function public.validate_strategy_comment_marker();
revoke all on function public.validate_strategy_comment_marker() from public, anon, authenticated, service_role;

-- Existing comment permissions still decide ordinary comment visibility.
create policy strategy_marker_comments_require_visible_snapshot
on public.post_comments as restrictive for select to anon, authenticated
using (
  marker_key is null or exists (
    select 1 from public.public_strategy_snapshots snapshot
    where snapshot.post_id = post_comments.post_id
  )
);

create or replace function public.wavekb_schema_version()
returns text language sql stable security definer set search_path = ''
as $$ select '202611270003'::text $$;

notify pgrst, 'reload schema';

commit;
