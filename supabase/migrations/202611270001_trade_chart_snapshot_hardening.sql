begin;

-- Revision publication and annotation remapping must commit atomically. A
-- deferred trigger runs after the immutable allocation rows for the new
-- revision have been inserted, so exact fill identities can be distinguished
-- from references that genuinely need user confirmation.
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

  update public.trading_fill_annotations annotation
  set cycle_revision = new.revision,
      remap_status = case
        when exists (
          select 1
          from public.trading_trade_cycle_fills allocation
          where allocation.owner_id = new.owner_id
            and allocation.connection_id = new.connection_id
            and allocation.cycle_id = new.id
            and allocation.cycle_revision = new.revision
            and allocation.fill_id = annotation.fill_id
            and allocation.native_fill_id = annotation.native_fill_id
        ) then 'remapped'
        else 'needs_confirmation'
      end,
      remapped_from_revision = coalesce(
        annotation.remapped_from_revision,
        annotation.cycle_revision
      ),
      version = annotation.version + 1,
      updated_at = clock_timestamp()
  where annotation.owner_id = new.owner_id
    and annotation.cycle_id = new.id
    and annotation.cycle_revision < new.revision
    and annotation.deleted_at is null;
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
as $$ select '202611270001'::text $$;

notify pgrst, 'reload schema';

commit;
