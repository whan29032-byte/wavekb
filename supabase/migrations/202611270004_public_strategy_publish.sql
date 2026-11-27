-- Existing unconsumed previews must be regenerated. Their receipts and
-- projections remain intact for idempotent replays of completed publications.
alter table public.strategy_share_previews
  add column source_fingerprint text not null default repeat('0', 64)
    check (source_fingerprint ~ '^[0-9a-f]{64}$');
alter table public.strategy_share_previews alter column source_fingerprint drop default;

create function public.load_public_strategy_share_source(p_owner_id uuid, p_cycle_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
set timezone = 'UTC'
as $$
  with private_source as materialized (
    select public.load_private_trade_chart_facts(p_owner_id, p_cycle_id) as facts
  )
  select jsonb_build_object(
    'revision', cycle.revision,
    'fill_digest', cycle.fill_digest,
    'chart_state_version', coalesce((source.facts #>> '{chart_state,version}')::integer, 0),
    'source_fingerprint', encode(sha256(convert_to(
      jsonb_build_array(source.facts, exact_trade.facts, cycle.fill_digest)::text, 'UTF8'
    )), 'hex'),
    'opened_at', cycle.opened_at,
    'closed_at', cycle.closed_at,
    'price_type', coalesce(source.facts #>> '{chart_state,price_type}',
      case when cycle.provider = 'exness' then 'both' else 'trade' end),
    'drawings', coalesce(source.facts #> '{chart_state,drawings}', '[]'::jsonb),
    'trade', exact_trade.facts
  )
  from private_source source
  cross join public.trading_trade_cycles cycle
  cross join lateral (
    select jsonb_build_object(
      'id', cycle.id,
      'revision', cycle.revision,
      'provider', cycle.provider,
      'product', cycle.product,
      'symbol', cycle.symbol,
      'direction', cycle.direction,
      'entry_price', cycle.entry_price::text,
      'exit_price', cycle.exit_price::text,
      'completeness', cycle.completeness,
      'account_currency', cycle.account_currency,
      'quantity', cycle.quantity::text,
      'net_pnl', cycle.net_pnl::text
    ) as facts
  ) exact_trade
  where cycle.id = p_cycle_id and cycle.owner_id = p_owner_id and source.facts is not null
$$;

revoke all on function public.load_public_strategy_share_source(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.load_public_strategy_share_source(uuid, uuid) to service_role;

create function public.publish_public_strategy_preview(
  p_owner_id uuid,
  p_cycle_id uuid,
  p_token_hash text,
  p_idempotency_key uuid,
  p_projection_digest text,
  p_board text,
  p_title text,
  p_body text,
  p_supersedes_post_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  preview public.strategy_share_previews%rowtype;
  source jsonb;
  locked_connection_id uuid;
  cycle_locked boolean := false;
  new_post_id uuid;
  new_snapshot_id uuid;
  post_title text := btrim(p_title);
  post_body text := btrim(p_body);
  consume_time timestamptz;
begin
  if p_owner_id is null or p_cycle_id is null or p_token_hash is null
     or p_token_hash !~ '^[0-9a-f]{64}$' or p_idempotency_key is null
     or p_projection_digest is null or p_projection_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'public_strategy_publish_invalid';
  end if;

  -- Apply the same account restrictions as can_participate() with the
  -- session owner already resolved by the gateway.
  perform 1 from auth.users account
  where account.id = p_owner_id and account.email_confirmed_at is not null
  for share;
  if not found then raise exception 'public_strategy_publish_forbidden'; end if;

  perform 1 from public.profiles profile
  where profile.id = p_owner_id and profile.public_uid is not null
    and profile.account_status = 'active'
    and (profile.muted_until is null or profile.muted_until <= now())
  for share;
  if not found then raise exception 'public_strategy_publish_forbidden'; end if;

  select candidate.* into preview
  from public.strategy_share_previews candidate
  where candidate.owner_id = p_owner_id and candidate.cycle_id = p_cycle_id
    and candidate.token_hash = p_token_hash;
  if not found then raise exception 'public_strategy_preview_not_found'; end if;

  if preview.consumed_at is null then
    -- Sync locks the connection before changing a cycle. Chart and note
    -- mutations lock the cycle. Preview consumption uses that same order
    -- so it can refresh source facts without racing those writes or deletion.
    select connection.id into locked_connection_id
    from public.exchange_connections connection
    join public.trading_trade_cycles cycle
      on cycle.connection_id = connection.id and cycle.owner_id = connection.owner_id
    where cycle.id = p_cycle_id and cycle.owner_id = p_owner_id
    for share of connection;

    if found then
      perform 1 from public.trading_trade_cycles cycle
      where cycle.id = p_cycle_id and cycle.owner_id = p_owner_id
        and cycle.connection_id = locked_connection_id
      for share;
      cycle_locked := found;
    end if;

    select candidate.* into preview
    from public.strategy_share_previews candidate
    where candidate.id = preview.id and candidate.owner_id = p_owner_id
      and candidate.cycle_id = p_cycle_id and candidate.token_hash = p_token_hash
    for update;
    if not found then raise exception 'public_strategy_preview_not_found'; end if;
  end if;

  if preview.consumed_at is not null then
    if preview.idempotency_key <> p_idempotency_key then
      raise exception 'public_strategy_preview_consumed';
    end if;
    if preview.projection_digest <> p_projection_digest then
      raise exception 'public_strategy_preview_stale';
    end if;

    select snapshot.id into new_snapshot_id
    from public.public_strategy_snapshots snapshot
    join public.posts post on post.id = snapshot.post_id and post.author_id = snapshot.author_id
    where snapshot.post_id = preview.published_post_id and snapshot.author_id = p_owner_id
      and snapshot.visibility_status = 'active' and post.status = 'published'
      and post.chart_package->>'provider' = 'wavekb-trade-snapshot'
      and post.chart_package->>'snapshot_id' = snapshot.id::text;
    if not found then raise exception 'public_strategy_preview_consumed'; end if;

    return jsonb_build_object(
      'post_id', preview.published_post_id, 'snapshot_id', new_snapshot_id, 'replayed', true
    );
  end if;

  if preview.idempotency_key <> p_idempotency_key then
    raise exception 'public_strategy_preview_not_found';
  end if;
  if preview.expires_at <= clock_timestamp() then
    raise exception 'public_strategy_preview_expired';
  end if;
  if p_board is null or p_board not in (
    'public_viewpoint', 'idea_sharing', 'case_submission',
    'question_answers', 'review_answers', 'video_sharing'
  ) or post_title is null or char_length(post_title) not between 5 and 120
    or post_body is null or char_length(post_body) not between 20 and 20000 then
    raise exception 'public_strategy_publish_invalid';
  end if;

  if not cycle_locked or preview.projection_digest <> p_projection_digest then
    raise exception 'public_strategy_preview_stale';
  end if;

  source := public.load_public_strategy_share_source(p_owner_id, p_cycle_id);
  if source is null or (
    (source->>'revision')::integer, source->>'fill_digest',
    (source->>'chart_state_version')::integer, source->>'source_fingerprint'
  ) is distinct from (
    preview.cycle_revision, preview.source_fill_digest,
    preview.chart_state_version, preview.source_fingerprint
  ) then
    raise exception 'public_strategy_preview_stale';
  end if;

  if p_supersedes_post_id is not null then
    -- Post deletion locks the post before tombstoning its snapshot.
    perform 1 from public.posts post
    where post.id = p_supersedes_post_id and post.author_id = p_owner_id
      and post.status = 'published'
    for share;
    if not found then raise exception 'public_strategy_publish_invalid'; end if;

    perform 1
    from public.trading_post_sources prior_source
    join public.public_strategy_snapshots prior
      on prior.post_id = prior_source.post_id and prior.author_id = prior_source.owner_id
    join public.posts post on post.id = prior.post_id and post.author_id = prior.author_id
    where prior_source.post_id = p_supersedes_post_id
      and prior_source.owner_id = p_owner_id and prior_source.cycle_id = p_cycle_id
      and prior.visibility_status = 'active' and post.status = 'published'
      and post.chart_package->>'provider' = 'wavekb-trade-snapshot'
      and post.chart_package->>'snapshot_id' = prior.id::text
    for share of prior;
    if not found then raise exception 'public_strategy_publish_invalid'; end if;
  end if;

  new_post_id := gen_random_uuid();
  new_snapshot_id := gen_random_uuid();

  insert into public.posts (id, author_id, board, title, body, status, chart_package)
  values (
    new_post_id, p_owner_id, p_board, post_title, post_body, 'draft',
    jsonb_build_object('provider', 'wavekb-trade-snapshot', 'snapshot_id', new_snapshot_id)
  );

  insert into public.public_strategy_snapshots (
    id, post_id, author_id, supersedes_post_id, projection_digest, projection
  ) values (
    new_snapshot_id, new_post_id, p_owner_id, p_supersedes_post_id, preview.projection_digest, preview.projection
  );

  insert into public.trading_post_sources (post_id, owner_id, cycle_id, source_revision, source_fill_digest)
  values (new_post_id, p_owner_id, p_cycle_id, preview.cycle_revision, preview.source_fill_digest);

  consume_time := clock_timestamp();
  if preview.expires_at <= consume_time then
    raise exception 'public_strategy_preview_expired';
  end if;
  begin
    update public.strategy_share_previews
    set consumed_at = consume_time, published_post_id = new_post_id
    where id = preview.id;
  exception when raise_exception then
    if sqlerrm = 'invalid_strategy_share_consumption' and preview.expires_at <= clock_timestamp() then
      raise exception 'public_strategy_preview_expired';
    end if;
    raise;
  end;

  -- Keep the ordinary draft-to-published transition, including its existing
  -- community triggers, inside the same transaction as preview consumption.
  update public.posts set status = 'published' where id = new_post_id and status = 'draft';
  if not found then raise exception 'public_strategy_publish_invalid'; end if;

  return jsonb_build_object('post_id', new_post_id, 'snapshot_id', new_snapshot_id, 'replayed', false);
end;
$$;

revoke all on function public.publish_public_strategy_preview(uuid, uuid, text, uuid, text, text, text, text, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.publish_public_strategy_preview(uuid, uuid, text, uuid, text, text, text, text, uuid)
to service_role;

create or replace function public.wavekb_schema_version()
returns text language sql stable security definer set search_path = ''
as $$ select '202611270004'::text $$;

notify pgrst, 'reload schema';
