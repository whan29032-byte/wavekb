begin;

-- A pending annotation keeps the last revision where its fill identity was
-- actually known. This permits user confirmation without pretending that the
-- old fill belongs to the new revision.
alter table public.trading_fill_annotations
  drop constraint if exists trading_fill_annotations_remap_state_check;
alter table public.trading_fill_annotations
  add constraint trading_fill_annotations_remap_state_check check (
    (remap_status = 'current' and remapped_from_revision is null)
    or (
      remap_status = 'remapped'
      and remapped_from_revision is not null
      and remapped_from_revision > 0
      and remapped_from_revision < cycle_revision
    )
    or (
      remap_status = 'needs_confirmation'
      and remapped_from_revision is not null
      and remapped_from_revision > 0
      and remapped_from_revision <= cycle_revision
    )
  );

-- Both the deferred trigger and the one-time migration backfill use this
-- owner/cycle/connection-bound reconciliation. Only one exact immutable
-- allocation identity may move an annotation to the target revision.
create or replace function public.reconcile_trade_chart_annotations(
  p_owner_id uuid,
  p_cycle_id uuid,
  p_connection_id uuid,
  p_target_revision integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  with annotation_matches as (
    select annotation.id,
           count(allocation.fill_id)::integer as exact_match_count
    from public.trading_fill_annotations annotation
    left join public.trading_trade_cycle_fills allocation
      on allocation.owner_id = p_owner_id
     and allocation.connection_id = p_connection_id
     and allocation.cycle_id = p_cycle_id
     and allocation.cycle_revision = p_target_revision
     and allocation.fill_id = annotation.fill_id
     and allocation.native_fill_id = annotation.native_fill_id
    where annotation.owner_id = p_owner_id
      and annotation.cycle_id = p_cycle_id
      and annotation.cycle_revision < p_target_revision
      and annotation.deleted_at is null
    group by annotation.id
  )
  update public.trading_fill_annotations annotation
  set cycle_revision = case
        when matched.exact_match_count = 1 then p_target_revision
        else annotation.cycle_revision
      end,
      remap_status = case
        when matched.exact_match_count = 1 then 'remapped'
        else 'needs_confirmation'
      end,
      remapped_from_revision = coalesce(
        annotation.remapped_from_revision,
        annotation.cycle_revision
      ),
      version = annotation.version + 1,
      updated_at = clock_timestamp()
  from annotation_matches matched
  where annotation.id = matched.id
    and (
      matched.exact_match_count = 1
      or annotation.remap_status <> 'needs_confirmation'
      or annotation.remapped_from_revision is null
    );
end;
$$;

revoke all on function public.reconcile_trade_chart_annotations(uuid, uuid, uuid, integer)
  from public, anon, authenticated, service_role;

-- Revision publication and annotation remapping must commit atomically. A
-- deferred trigger runs after the immutable allocation rows for the new
-- revision have been inserted.
create or replace function public.remap_trade_chart_annotations_after_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.trading_trade_cycle_revisions revision
    where revision.cycle_id = new.id
      and revision.owner_id = new.owner_id
      and revision.revision = new.revision
  ) then
    return null;
  end if;

  perform public.reconcile_trade_chart_annotations(
    new.owner_id,
    new.id,
    new.connection_id,
    new.revision
  );
  return null;
end;
$$;

revoke all on function public.remap_trade_chart_annotations_after_revision()
  from public, anon, authenticated, service_role;

drop trigger if exists remap_trade_chart_annotations_after_revision
  on public.trading_trade_cycles;
create constraint trigger remap_trade_chart_annotations_after_revision
after update of revision on public.trading_trade_cycles
deferrable initially deferred
for each row
when (old.revision is distinct from new.revision)
execute function public.remap_trade_chart_annotations_after_revision();

-- Repair rows that became stale while the preceding trade chart schema had
-- no revision trigger. Repeated migration application is a no-op for pending
-- rows and for exact rows already advanced to the current revision.
do $$
declare
  current_cycle record;
begin
  for current_cycle in
    select cycle.owner_id, cycle.id, cycle.connection_id, cycle.revision
    from public.trading_trade_cycles cycle
    where exists (
        select 1
        from public.trading_fill_annotations annotation
        where annotation.owner_id = cycle.owner_id
          and annotation.cycle_id = cycle.id
          and annotation.cycle_revision < cycle.revision
          and annotation.deleted_at is null
      )
  loop
    perform public.reconcile_trade_chart_annotations(
      current_cycle.owner_id,
      current_cycle.id,
      current_cycle.connection_id,
      current_cycle.revision
    );
  end loop;
end;
$$;

-- The private chart projection must be assembled from one PostgreSQL statement.
-- This prevents a publish between REST reads from splicing two cycle revisions.
-- Cycle-fill allocations are immutable revision facts, so their provenance
-- generation intentionally is not compared with the latest sync generation.
create or replace function public.load_private_trade_chart_facts(
  p_owner_id uuid,
  p_cycle_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'snapshot_token', jsonb_build_object(
      'cycle_revision', cycle.revision,
      'cycle_generation', cycle.generation,
      'sync_generation', connection.sync_generation
    ),
    'cycle', jsonb_build_object(
      'id', cycle.id,
      'owner_id', cycle.owner_id,
      'connection_id', cycle.connection_id,
      'provider', cycle.provider,
      'revision', cycle.revision,
      'product', cycle.product,
      'symbol', cycle.symbol,
      'direction', cycle.direction,
      'opened_at', cycle.opened_at,
      'closed_at', cycle.closed_at,
      'generation', cycle.generation,
      'is_current', cycle.is_current
    ),
    'connection', jsonb_build_object(
      'id', connection.id,
      'owner_id', connection.owner_id,
      'provider', connection.provider,
      'sync_generation', connection.sync_generation
    ),
    'allocations', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'cycle_revision', allocation.cycle_revision,
          'fill_id', allocation.fill_id::text,
          'native_fill_id', allocation.native_fill_id,
          'allocation_quantity', allocation.allocation_quantity::text,
          'allocation_role', allocation.allocation_role,
          'sort_order', allocation.sort_order
        ) order by allocation.sort_order, allocation.fill_id
      )
      from public.trading_trade_cycle_fills allocation
      where allocation.owner_id = p_owner_id
        and allocation.connection_id = cycle.connection_id
        and allocation.cycle_id = cycle.id
        and allocation.cycle_revision = cycle.revision
    ), '[]'::jsonb),
    'fills', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', fill_row.id::text,
          'native_fill_id', fill_row.native_fill_id,
          'native_symbol', fill_row.native_symbol,
          'occurred_at', fill_row.occurred_at,
          'price', fill_row.price::text,
          'side', fill_row.side,
          'position_side', fill_row.position_side,
          'liquidity', fill_row.liquidity
        ) order by allocation.sort_order, fill_row.id
      )
      from public.trading_trade_cycle_fills allocation
      join public.trading_fills fill_row
        on fill_row.id = allocation.fill_id
       and fill_row.owner_id = allocation.owner_id
       and fill_row.connection_id = allocation.connection_id
       and fill_row.native_fill_id = allocation.native_fill_id
      where allocation.owner_id = p_owner_id
        and allocation.connection_id = cycle.connection_id
        and allocation.cycle_id = cycle.id
        and allocation.cycle_revision = cycle.revision
    ), '[]'::jsonb),
    'annotations', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', annotation.id::text,
          'fill_id', annotation.fill_id::text,
          'native_fill_id', annotation.native_fill_id,
          'cycle_revision', annotation.cycle_revision,
          'body', annotation.body,
          'tags', annotation.tags,
          'remap_status', annotation.remap_status,
          'remapped_from_revision', annotation.remapped_from_revision,
          'version', annotation.version,
          'deleted_at', annotation.deleted_at
        ) order by annotation.created_at, annotation.id
      )
      from public.trading_fill_annotations annotation
      where annotation.owner_id = p_owner_id
        and annotation.cycle_id = cycle.id
        and annotation.deleted_at is null
    ), '[]'::jsonb),
    'images', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', image.id::text,
          'annotation_id', image.annotation_id::text,
          'mime_type', image.mime_type,
          'byte_size', image.byte_size,
          'sort_order', image.sort_order,
          'deleted_at', image.deleted_at
        ) order by image.annotation_id, image.sort_order, image.id
      )
      from public.trading_fill_annotation_images image
      join public.trading_fill_annotations annotation
        on annotation.id = image.annotation_id
       and annotation.owner_id = image.owner_id
      where image.owner_id = p_owner_id
        and annotation.cycle_id = cycle.id
        and annotation.deleted_at is null
        and image.deleted_at is null
    ), '[]'::jsonb),
    'chart_state', (
      select jsonb_build_object(
        'cycle_id', state.cycle_id,
        'cycle_revision', state.cycle_revision,
        'schema_version', state.schema_version,
        'timeframe', state.timeframe,
        'price_type', state.price_type,
        'viewport', state.viewport,
        'indicators', state.indicators,
        'drawings', state.drawings,
        'version', state.version,
        'updated_at', state.updated_at
      )
      from public.trading_chart_states state
      where state.owner_id = p_owner_id
        and state.cycle_id = cycle.id
      limit 1
    )
  )
  from public.trading_trade_cycles cycle
  join public.exchange_connections connection
    on connection.id = cycle.connection_id
   and connection.owner_id = cycle.owner_id
   and connection.provider = cycle.provider
  where cycle.id = p_cycle_id
    and cycle.owner_id = p_owner_id
    and cycle.is_current
    and cycle.generation = connection.sync_generation
    and connection.status <> 'deleting'
  limit 1
$$;

revoke all on function public.load_private_trade_chart_facts(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.load_private_trade_chart_facts(uuid, uuid)
  to service_role;

create or replace function public.wavekb_schema_version()
returns text
language sql
stable
security definer
set search_path = ''
as $$ select '202611270002'::text $$;

notify pgrst, 'reload schema';

commit;
