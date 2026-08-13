alter table public.profiles
  add column if not exists account_status text not null default 'active'
    check (account_status in ('active', 'banned')),
  add column if not exists muted_until timestamptz,
  add column if not exists moderation_note text not null default ''
    check (char_length(moderation_note) <= 500),
  add column if not exists moderated_at timestamptz,
  add column if not exists moderated_by uuid references public.profiles(id)
    on delete set null;

create index if not exists profiles_account_status_idx
on public.profiles(account_status, created_at desc);

create index if not exists profiles_muted_until_idx
on public.profiles(muted_until)
where muted_until is not null;

create table if not exists public.user_moderation_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id) on delete restrict,
  target_id uuid not null references public.profiles(id) on delete cascade,
  action text not null check (
    action in (
      'ban',
      'unban',
      'mute',
      'unmute',
      'grant_admin',
      'revoke_admin',
      'set_uid'
    )
  ),
  reason text not null default '' check (char_length(reason) <= 500),
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists user_moderation_audit_created_idx
on public.user_moderation_audit(created_at desc);

create index if not exists user_moderation_audit_target_idx
on public.user_moderation_audit(target_id, created_at desc);

alter table public.user_moderation_audit enable row level security;

drop policy if exists "admins read moderation audit" on public.user_moderation_audit;
create policy "admins read moderation audit"
on public.user_moderation_audit for select to authenticated
using (public.is_admin());

create or replace function public.can_participate()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    join auth.users on auth.users.id = profiles.id
    where profiles.id = auth.uid()
      and profiles.public_uid is not null
      and profiles.account_status = 'active'
      and (
        profiles.muted_until is null
        or profiles.muted_until <= now()
      )
      and auth.users.email_confirmed_at is not null
  );
$$;

revoke all on function public.can_participate() from public, anon;
grant execute on function public.can_participate() to authenticated;

drop policy if exists "activated users create own posts" on public.posts;
drop policy if exists "active users create own posts" on public.posts;
create policy "active users create own posts"
on public.posts for insert to authenticated
with check (
  author_id = auth.uid()
  and status = 'draft'
  and public.can_participate()
);

drop policy if exists "authors update own active posts" on public.posts;
drop policy if exists "active authors update own posts" on public.posts;
create policy "active authors update own posts"
on public.posts for update to authenticated
using (
  author_id = auth.uid()
  and status in ('draft', 'published')
  and public.can_participate()
)
with check (
  author_id = auth.uid()
  and status in ('draft', 'published')
  and public.can_participate()
);

drop policy if exists "activated users add comments" on public.post_comments;
drop policy if exists "active users add comments" on public.post_comments;
create policy "active users add comments"
on public.post_comments for insert to authenticated
with check (
  author_id = auth.uid()
  and status = 'visible'
  and public.can_participate()
  and exists (
    select 1
    from public.posts
    where posts.id = post_id
      and posts.status = 'published'
      and posts.comments_enabled
  )
);

drop policy if exists "users create reports" on public.post_reports;
drop policy if exists "active users create reports" on public.post_reports;
create policy "active users create reports"
on public.post_reports for insert to authenticated
with check (
  reporter_id = auth.uid()
  and public.can_participate()
);

create or replace function public._require_admin_actor(p_actor uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_actor is null or not exists (
    select 1
    from public.profiles
    where id = p_actor
      and role = 'admin'
      and account_status = 'active'
  ) then
    raise exception 'admin_required';
  end if;
end;
$$;

revoke all on function public._require_admin_actor(uuid)
from public, anon, authenticated;
grant execute on function public._require_admin_actor(uuid) to service_role;

create or replace function public.admin_user_summary(p_actor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform public._require_admin_actor(p_actor);
  select jsonb_build_object(
    'total_users', count(*),
    'active_users', count(*) filter (where account_status = 'active'),
    'banned_users', count(*) filter (where account_status = 'banned'),
    'muted_users', count(*) filter (
      where account_status = 'active'
        and muted_until is not null
        and muted_until > now()
    ),
    'admin_users', count(*) filter (where role = 'admin'),
    'new_today', count(*) filter (
      where created_at >= date_trunc('day', now())
    )
  )
  into result
  from public.profiles;
  return result;
end;
$$;

revoke all on function public.admin_user_summary(uuid)
from public, anon, authenticated;
grant execute on function public.admin_user_summary(uuid) to service_role;

create or replace function public.admin_list_users(
  p_actor uuid,
  p_query text default '',
  p_status text default 'all',
  p_role text default 'all',
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  email text,
  public_uid integer,
  display_name text,
  avatar_url text,
  role text,
  account_status text,
  muted_until timestamptz,
  moderation_note text,
  email_confirmed boolean,
  last_sign_in_at timestamptz,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  query_text text := trim(coalesce(p_query, ''));
  safe_limit integer := greatest(1, least(coalesce(p_limit, 25), 100));
  safe_offset integer := greatest(0, coalesce(p_offset, 0));
begin
  perform public._require_admin_actor(p_actor);
  if coalesce(p_status, 'all') not in ('all', 'active', 'banned', 'muted') then
    raise exception 'invalid_status';
  end if;
  if coalesce(p_role, 'all') not in ('all', 'user', 'admin') then
    raise exception 'invalid_role';
  end if;

  return query
  select
    profiles.id,
    auth.users.email::text,
    profiles.public_uid,
    profiles.display_name,
    profiles.avatar_url,
    profiles.role,
    profiles.account_status,
    profiles.muted_until,
    profiles.moderation_note,
    auth.users.email_confirmed_at is not null,
    auth.users.last_sign_in_at,
    profiles.created_at,
    count(*) over()
  from public.profiles
  join auth.users on auth.users.id = profiles.id
  where (
    query_text = ''
    or profiles.display_name ilike '%' || query_text || '%'
    or coalesce(auth.users.email, '') ilike '%' || query_text || '%'
    or profiles.public_uid::text = query_text
  )
    and (
      p_role = 'all'
      or profiles.role = p_role
    )
    and (
      p_status = 'all'
      or (p_status = 'active' and profiles.account_status = 'active')
      or (p_status = 'banned' and profiles.account_status = 'banned')
      or (
        p_status = 'muted'
        and profiles.account_status = 'active'
        and profiles.muted_until is not null
        and profiles.muted_until > now()
      )
    )
  order by profiles.created_at desc
  limit safe_limit
  offset safe_offset;
end;
$$;

revoke all on function public.admin_list_users(uuid, text, text, text, integer, integer)
from public, anon, authenticated;
grant execute on function public.admin_list_users(uuid, text, text, text, integer, integer)
to service_role;

create or replace function public.admin_set_account_status(
  p_actor uuid,
  p_target uuid,
  p_status text,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_row public.profiles;
  after_row public.profiles;
  action_name text;
begin
  perform public._require_admin_actor(p_actor);
  if p_status not in ('active', 'banned') then
    raise exception 'invalid_status';
  end if;
  if p_actor = p_target and p_status = 'banned' then
    raise exception 'cannot_ban_self';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) > 500 then
    raise exception 'reason_too_long';
  end if;

  select * into before_row
  from public.profiles
  where id = p_target
  for update;
  if not found then
    raise exception 'user_not_found';
  end if;

  update public.profiles
  set
    account_status = p_status,
    muted_until = case when p_status = 'banned' then null else muted_until end,
    moderation_note = trim(coalesce(p_reason, '')),
    moderated_at = now(),
    moderated_by = p_actor
  where id = p_target
  returning * into after_row;

  action_name := case when p_status = 'banned' then 'ban' else 'unban' end;
  insert into public.user_moderation_audit (
    actor_id, target_id, action, reason, before_state, after_state
  )
  values (
    p_actor,
    p_target,
    action_name,
    trim(coalesce(p_reason, '')),
    jsonb_build_object(
      'account_status', before_row.account_status,
      'muted_until', before_row.muted_until
    ),
    jsonb_build_object(
      'account_status', after_row.account_status,
      'muted_until', after_row.muted_until
    )
  );

  return jsonb_build_object(
    'id', after_row.id,
    'account_status', after_row.account_status,
    'muted_until', after_row.muted_until,
    'moderation_note', after_row.moderation_note
  );
end;
$$;

revoke all on function public.admin_set_account_status(uuid, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.admin_set_account_status(uuid, uuid, text, text)
to service_role;

create or replace function public.admin_set_mute(
  p_actor uuid,
  p_target uuid,
  p_muted_until timestamptz,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_row public.profiles;
  after_row public.profiles;
  action_name text;
begin
  perform public._require_admin_actor(p_actor);
  if p_actor = p_target and p_muted_until is not null then
    raise exception 'cannot_mute_self';
  end if;
  if p_muted_until is not null and (
    p_muted_until <= now()
    or p_muted_until > now() + interval '365 days'
  ) then
    raise exception 'invalid_mute_until';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) > 500 then
    raise exception 'reason_too_long';
  end if;

  select * into before_row
  from public.profiles
  where id = p_target
  for update;
  if not found then
    raise exception 'user_not_found';
  end if;
  if before_row.account_status = 'banned' and p_muted_until is not null then
    raise exception 'user_is_banned';
  end if;

  update public.profiles
  set
    muted_until = p_muted_until,
    moderation_note = trim(coalesce(p_reason, '')),
    moderated_at = now(),
    moderated_by = p_actor
  where id = p_target
  returning * into after_row;

  action_name := case when p_muted_until is null then 'unmute' else 'mute' end;
  insert into public.user_moderation_audit (
    actor_id, target_id, action, reason, before_state, after_state
  )
  values (
    p_actor,
    p_target,
    action_name,
    trim(coalesce(p_reason, '')),
    jsonb_build_object('muted_until', before_row.muted_until),
    jsonb_build_object('muted_until', after_row.muted_until)
  );

  return jsonb_build_object(
    'id', after_row.id,
    'account_status', after_row.account_status,
    'muted_until', after_row.muted_until,
    'moderation_note', after_row.moderation_note
  );
end;
$$;

revoke all on function public.admin_set_mute(uuid, uuid, timestamptz, text)
from public, anon, authenticated;
grant execute on function public.admin_set_mute(uuid, uuid, timestamptz, text)
to service_role;

create or replace function public.admin_set_role(
  p_actor uuid,
  p_target uuid,
  p_role text,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_row public.profiles;
  after_row public.profiles;
  action_name text;
begin
  perform public._require_admin_actor(p_actor);
  if p_role not in ('user', 'admin') then
    raise exception 'invalid_role';
  end if;
  if p_actor = p_target then
    raise exception 'cannot_change_own_role';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) > 500 then
    raise exception 'reason_too_long';
  end if;

  select * into before_row
  from public.profiles
  where id = p_target
  for update;
  if not found then
    raise exception 'user_not_found';
  end if;

  update public.profiles
  set
    role = p_role,
    moderation_note = trim(coalesce(p_reason, '')),
    moderated_at = now(),
    moderated_by = p_actor
  where id = p_target
  returning * into after_row;

  action_name := case when p_role = 'admin' then 'grant_admin' else 'revoke_admin' end;
  insert into public.user_moderation_audit (
    actor_id, target_id, action, reason, before_state, after_state
  )
  values (
    p_actor,
    p_target,
    action_name,
    trim(coalesce(p_reason, '')),
    jsonb_build_object('role', before_row.role),
    jsonb_build_object('role', after_row.role)
  );

  return jsonb_build_object('id', after_row.id, 'role', after_row.role);
end;
$$;

revoke all on function public.admin_set_role(uuid, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.admin_set_role(uuid, uuid, text, text)
to service_role;

create or replace function public.admin_set_uid(
  p_actor uuid,
  p_target uuid,
  p_uid integer,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_row public.profiles;
  after_row public.profiles;
  target_session uuid;
begin
  perform public._require_admin_actor(p_actor);
  if p_uid not between 10000 and 999999 then
    raise exception 'invalid_uid';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) > 500 then
    raise exception 'reason_too_long';
  end if;

  select * into before_row
  from public.profiles
  where id = p_target
  for update;
  if not found then
    raise exception 'user_not_found';
  end if;

  if exists (
    select 1 from public.profiles
    where public_uid = p_uid and id <> p_target
  ) then
    raise exception 'uid_unavailable';
  end if;

  select id into target_session
  from public.uid_selection_sessions
  where owner_id = p_target
  for update;

  if exists (
    select 1
    from public.uid_selection_candidates candidates
    join public.uid_selection_sessions sessions
      on sessions.id = candidates.session_id
    where candidates.uid = p_uid
      and sessions.owner_id <> p_target
  ) then
    raise exception 'uid_unavailable';
  end if;

  if target_session is not null then
    delete from public.uid_selection_candidates
    where session_id = target_session;
  end if;

  update public.profiles
  set
    public_uid = p_uid,
    moderation_note = trim(coalesce(p_reason, '')),
    moderated_at = now(),
    moderated_by = p_actor
  where id = p_target
  returning * into after_row;

  if target_session is not null then
    update public.uid_selection_sessions
    set
      selected_uid = p_uid,
      status = 'completed',
      completed_at = now()
    where id = target_session;
  end if;

  insert into public.user_moderation_audit (
    actor_id, target_id, action, reason, before_state, after_state
  )
  values (
    p_actor,
    p_target,
    'set_uid',
    trim(coalesce(p_reason, '')),
    jsonb_build_object('public_uid', before_row.public_uid),
    jsonb_build_object('public_uid', after_row.public_uid)
  );

  return jsonb_build_object('id', after_row.id, 'public_uid', after_row.public_uid);
end;
$$;

revoke all on function public.admin_set_uid(uuid, uuid, integer, text)
from public, anon, authenticated;
grant execute on function public.admin_set_uid(uuid, uuid, integer, text)
to service_role;

create or replace function public.admin_list_moderation_audit(
  p_actor uuid,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  action text,
  reason text,
  actor_id uuid,
  actor_name text,
  actor_uid integer,
  target_id uuid,
  target_name text,
  target_uid integer,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public._require_admin_actor(p_actor);
  return query
  select
    audit.id,
    audit.action,
    audit.reason,
    audit.actor_id,
    actor.display_name,
    actor.public_uid,
    audit.target_id,
    target.display_name,
    target.public_uid,
    audit.before_state,
    audit.after_state,
    audit.created_at
  from public.user_moderation_audit audit
  join public.profiles actor on actor.id = audit.actor_id
  join public.profiles target on target.id = audit.target_id
  order by audit.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

revoke all on function public.admin_list_moderation_audit(uuid, integer, integer)
from public, anon, authenticated;
grant execute on function public.admin_list_moderation_audit(uuid, integer, integer)
to service_role;
