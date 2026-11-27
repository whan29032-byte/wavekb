create function public.preserve_strategy_post_chart_pointer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.chart_package->>'provider' = 'wavekb-trade-snapshot' then
    -- Generic editors send NULL when they have no chart form value.
    if new.chart_package is null or new.chart_package = 'null'::jsonb then
      new.chart_package := old.chart_package;
    elsif new.chart_package is distinct from old.chart_package then
      raise exception 'strategy_post_pointer_immutable';
    end if;
  elsif new.chart_package->>'provider' = 'wavekb-trade-snapshot' then
    if tg_op <> 'INSERT'
       or new.chart_package - array['provider', 'snapshot_id'] <> '{}'::jsonb
       or jsonb_typeof(new.chart_package->'snapshot_id') is distinct from 'string'
       or (new.chart_package->>'snapshot_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'invalid_strategy_post_pointer';
    end if;
  end if;
  return new;
end;
$$;

create trigger preserve_strategy_post_chart_pointer
before insert or update of chart_package on public.posts
for each row execute function public.preserve_strategy_post_chart_pointer();
revoke all on function public.preserve_strategy_post_chart_pointer() from public, anon, authenticated, service_role;

create function public.verify_strategy_post_snapshot_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.public_strategy_snapshots snapshot
    where snapshot.id = (new.chart_package->>'snapshot_id')::uuid
      and snapshot.post_id = new.id
      and snapshot.author_id = new.author_id
  ) then
    raise exception 'invalid_strategy_post_pointer';
  end if;
  return null;
end;
$$;

-- Publishing creates the post first and its linked snapshot in the same transaction.
create constraint trigger verify_strategy_post_snapshot_link
after insert on public.posts deferrable initially deferred
for each row when (new.chart_package->>'provider' = 'wavekb-trade-snapshot')
execute function public.verify_strategy_post_snapshot_link();
revoke all on function public.verify_strategy_post_snapshot_link() from public, anon, authenticated, service_role;

create function public.soft_delete_my_post_comment(p_comment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null or not public.is_verified_user() then
    raise exception 'comment_delete_forbidden' using errcode = '42501';
  end if;

  update public.post_comments
  set status = 'deleted_by_author', body = '该评论已由作者删除。'
  where id = p_comment_id and author_id = actor_id and status = 'visible';
  if found then return true; end if;

  return exists (
    select 1 from public.post_comments
    where id = p_comment_id and author_id = actor_id and status = 'deleted_by_author'
  );
end;
$$;

drop policy "authors soft delete comments" on public.post_comments;
revoke all on function public.soft_delete_my_post_comment(uuid) from public, anon, authenticated, service_role;
grant execute on function public.soft_delete_my_post_comment(uuid) to authenticated;

create function public.purge_expired_strategy_share_previews()
returns integer
language sql
security definer
set search_path = ''
as $$
  with expired as (
    select preview.id from public.strategy_share_previews preview
    where preview.consumed_at is null and preview.expires_at <= statement_timestamp()
    order by preview.expires_at, preview.id
    limit 500
    for update of preview skip locked
  ), removed as (
    delete from public.strategy_share_previews preview using expired
    where preview.id = expired.id and preview.consumed_at is null
    returning preview.id
  )
  select count(*)::integer from removed;
$$;

revoke all on function public.purge_expired_strategy_share_previews() from public, anon, authenticated, service_role;
grant execute on function public.purge_expired_strategy_share_previews() to service_role;

create or replace function public.wavekb_schema_version()
returns text language sql stable security definer set search_path = ''
as $$ select '202611270005'::text $$;

notify pgrst, 'reload schema';
