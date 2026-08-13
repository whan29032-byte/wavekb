create extension if not exists pgcrypto;

alter table public.profiles
  add column if not exists public_uid integer
    check (public_uid between 10000 and 999999);

create unique index if not exists profiles_public_uid_unique
on public.profiles(public_uid)
where public_uid is not null;

create or replace function public._random_public_uid()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  random_bytes bytea;
  random_value bigint;
begin
  random_bytes := extensions.gen_random_bytes(4);
  random_value :=
    (get_byte(random_bytes, 0)::bigint << 24)
    | (get_byte(random_bytes, 1)::bigint << 16)
    | (get_byte(random_bytes, 2)::bigint << 8)
    | get_byte(random_bytes, 3)::bigint;
  return 10000 + (random_value % 990000)::integer;
end;
$$;

revoke all on function public._random_public_uid() from public, anon, authenticated;

do $$
declare
  profile_row record;
  candidate integer;
  attempt integer;
begin
  for profile_row in
    select id
    from public.profiles
    where public_uid is null
    order by created_at, id
    for update
  loop
    for attempt in 1..128 loop
      candidate := public._random_public_uid();
      begin
        update public.profiles
        set public_uid = candidate
        where id = profile_row.id;
        exit;
      exception
        when unique_violation then
          if attempt = 128 then
            raise exception 'uid_backfill_exhausted';
          end if;
      end;
    end loop;
  end loop;

  if exists (
    select 1 from public.profiles where public_uid is null
  ) then
    raise exception 'uid_backfill_incomplete';
  end if;
end;
$$;

create table public.uid_selection_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  selected_uid integer check (selected_uid between 10000 and 999999),
  refreshes_used smallint not null default 0
    check (refreshes_used between 0 and 3),
  max_refreshes smallint not null default 3
    check (max_refreshes = 3),
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'expired', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  completed_at timestamptz
);

create table public.uid_selection_candidates (
  uid integer primary key check (uid between 10000 and 999999),
  session_id uuid not null references public.uid_selection_sessions(id) on delete cascade,
  sort_order smallint not null check (sort_order between 0 and 3),
  status text not null default 'reserved'
    check (status in ('reserved', 'selected', 'consumed')),
  created_at timestamptz not null default now(),
  unique (session_id, sort_order)
);

create index uid_selection_sessions_expiry_idx
on public.uid_selection_sessions(status, expires_at);

create index uid_selection_candidates_session_idx
on public.uid_selection_candidates(session_id, sort_order);

create trigger uid_selection_sessions_touch_updated_at
before update on public.uid_selection_sessions
for each row execute function public.touch_updated_at();

alter table public.uid_selection_sessions enable row level security;
alter table public.uid_selection_candidates enable row level security;

create or replace function public.is_activated_user()
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
      and auth.users.email_confirmed_at is not null
  );
$$;

revoke all on function public.is_activated_user() from public, anon;
grant execute on function public.is_activated_user() to authenticated;

create or replace function public._uid_selection_state(p_owner uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'candidate_uids',
      coalesce(
        (
          select jsonb_agg(candidates.uid order by candidates.sort_order)
          from public.uid_selection_candidates candidates
          where candidates.session_id = sessions.id
        ),
        '[]'::jsonb
      ),
    'selected_uid', sessions.selected_uid,
    'refreshes_used', sessions.refreshes_used,
    'refreshes_remaining', greatest(0, sessions.max_refreshes - sessions.refreshes_used),
    'expires_at', sessions.expires_at,
    'status',
      case
        when profiles.public_uid is not null then 'completed'
        when sessions.expires_at <= now() and sessions.status = 'pending' then 'expired'
        else sessions.status
      end,
    'public_uid', profiles.public_uid
  )
  from public.uid_selection_sessions sessions
  join public.profiles on profiles.id = sessions.owner_id
  where sessions.owner_id = p_owner;
$$;

revoke all on function public._uid_selection_state(uuid)
from public, anon, authenticated;

create or replace function public._reserve_uid_candidate(
  target_session uuid,
  target_order smallint
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  candidate integer;
  attempt integer;
begin
  for attempt in 1..128 loop
    candidate := public._random_public_uid();
    if exists (
      select 1
      from public.profiles
      where public_uid = candidate
    ) then
      continue;
    end if;
    begin
      insert into public.uid_selection_candidates (
        uid,
        session_id,
        sort_order,
        status
      )
      values (
        candidate,
        target_session,
        target_order,
        'reserved'
      );
      return candidate;
    exception
      when unique_violation then
        if attempt = 128 then
          raise exception 'uid_unavailable';
        end if;
    end;
  end loop;
  raise exception 'uid_unavailable';
end;
$$;

revoke all on function public._reserve_uid_candidate(uuid, smallint)
from public, anon, authenticated;

create or replace function public._require_confirmed_uid_actor()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid;
begin
  actor := auth.uid();
  if actor is null then
    raise exception 'authentication_required';
  end if;
  if not exists (
    select 1
    from auth.users
    where id = actor
      and email_confirmed_at is not null
  ) then
    raise exception 'email_confirmation_required';
  end if;
  return actor;
end;
$$;

revoke all on function public._require_confirmed_uid_actor()
from public, anon, authenticated;

create or replace function public.start_uid_selection()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  session_row public.uid_selection_sessions;
  initial_uid integer;
begin
  actor := public._require_confirmed_uid_actor();

  if exists (
    select 1 from public.profiles
    where id = actor and public_uid is not null
  ) then
    insert into public.uid_selection_sessions (
      owner_id,
      status,
      completed_at
    )
    values (actor, 'completed', now())
    on conflict (owner_id) do update
      set status = 'completed',
          completed_at = coalesce(
            public.uid_selection_sessions.completed_at,
            now()
          );
    return public._uid_selection_state(actor);
  end if;

  insert into public.uid_selection_sessions (owner_id)
  values (actor)
  on conflict (owner_id) do nothing;

  select *
  into session_row
  from public.uid_selection_sessions
  where owner_id = actor
  for update;

  if session_row.status in ('expired', 'revoked')
     or (
       session_row.status = 'pending'
       and session_row.expires_at <= now()
     ) then
    delete from public.uid_selection_candidates
    where session_id = session_row.id;

    update public.uid_selection_sessions
    set
      selected_uid = null,
      status = 'pending',
      expires_at = now() + interval '30 minutes',
      completed_at = null
    where id = session_row.id
    returning * into session_row;
  end if;

  if not exists (
    select 1
    from public.uid_selection_candidates
    where session_id = session_row.id
  ) then
    initial_uid := public._reserve_uid_candidate(session_row.id, 0);
    update public.uid_selection_sessions
    set selected_uid = initial_uid
    where id = session_row.id;
  end if;

  return public._uid_selection_state(actor);
end;
$$;

create or replace function public.get_uid_selection_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid;
begin
  actor := public._require_confirmed_uid_actor();
  if not exists (
    select 1
    from public.uid_selection_sessions
    where owner_id = actor
  ) then
    raise exception 'uid_selection_invalid';
  end if;
  return public._uid_selection_state(actor);
end;
$$;

create or replace function public.refresh_uid_selection()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  session_row public.uid_selection_sessions;
  candidate integer;
  next_order smallint;
begin
  actor := public._require_confirmed_uid_actor();

  select *
  into session_row
  from public.uid_selection_sessions
  where owner_id = actor
  for update;

  if not found then
    raise exception 'uid_selection_invalid';
  end if;
  if session_row.status <> 'pending'
     or session_row.expires_at <= now() then
    raise exception 'uid_selection_expired';
  end if;
  if exists (
    select 1 from public.profiles
    where id = actor and public_uid is not null
  ) then
    raise exception 'uid_already_assigned';
  end if;
  if session_row.refreshes_used >= session_row.max_refreshes then
    raise exception 'uid_refresh_exhausted';
  end if;

  select coalesce(max(sort_order), -1) + 1
  into next_order
  from public.uid_selection_candidates
  where session_id = session_row.id;

  candidate := public._reserve_uid_candidate(session_row.id, next_order);

  update public.uid_selection_sessions
  set refreshes_used = refreshes_used + 1
  where id = session_row.id;

  return public._uid_selection_state(actor);
end;
$$;

create or replace function public.select_uid_candidate(chosen_uid integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  session_row public.uid_selection_sessions;
begin
  actor := public._require_confirmed_uid_actor();

  select *
  into session_row
  from public.uid_selection_sessions
  where owner_id = actor
  for update;

  if not found
     or session_row.status <> 'pending'
     or session_row.expires_at <= now() then
    raise exception 'uid_selection_expired';
  end if;
  if not exists (
    select 1
    from public.uid_selection_candidates
    where session_id = session_row.id
      and uid = chosen_uid
      and status in ('reserved', 'selected')
  ) then
    raise exception 'uid_unavailable';
  end if;

  update public.uid_selection_candidates
  set status = case when uid = chosen_uid then 'selected' else 'reserved' end
  where session_id = session_row.id;

  update public.uid_selection_sessions
  set selected_uid = chosen_uid
  where id = session_row.id;

  return public._uid_selection_state(actor);
end;
$$;

create or replace function public.complete_uid_selection()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  session_row public.uid_selection_sessions;
  assigned_uid integer;
begin
  actor := public._require_confirmed_uid_actor();

  select public_uid
  into assigned_uid
  from public.profiles
  where id = actor
  for update;

  if assigned_uid is not null then
    return public._uid_selection_state(actor);
  end if;

  select *
  into session_row
  from public.uid_selection_sessions
  where owner_id = actor
  for update;

  if not found
     or session_row.status <> 'pending'
     or session_row.expires_at <= now() then
    raise exception 'uid_selection_expired';
  end if;
  if session_row.selected_uid is null
     or not exists (
       select 1
       from public.uid_selection_candidates
       where session_id = session_row.id
         and uid = session_row.selected_uid
         and status in ('reserved', 'selected')
     ) then
    raise exception 'uid_unavailable';
  end if;

  update public.profiles
  set public_uid = session_row.selected_uid
  where id = actor
    and public_uid is null;

  update public.uid_selection_candidates
  set status = 'consumed'
  where session_id = session_row.id
    and uid = session_row.selected_uid;

  delete from public.uid_selection_candidates
  where session_id = session_row.id
    and uid <> session_row.selected_uid;

  update public.uid_selection_sessions
  set status = 'completed',
      completed_at = now()
  where id = session_row.id;

  return public._uid_selection_state(actor);
exception
  when unique_violation then
    raise exception 'uid_unavailable';
end;
$$;

create or replace function public.expire_uid_selections()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  expired_count integer;
begin
  with expired as (
    update public.uid_selection_sessions
    set status = 'expired'
    where status = 'pending'
      and expires_at <= now()
    returning id
  ),
  removed as (
    delete from public.uid_selection_candidates
    where session_id in (select id from expired)
    returning session_id
  )
  select count(*) into expired_count from expired;
  return expired_count;
end;
$$;

revoke all on function public.start_uid_selection() from public, anon;
revoke all on function public.get_uid_selection_state() from public, anon;
revoke all on function public.refresh_uid_selection() from public, anon;
revoke all on function public.select_uid_candidate(integer) from public, anon;
revoke all on function public.complete_uid_selection() from public, anon;
revoke all on function public.expire_uid_selections() from public, anon, authenticated;

grant execute on function public.start_uid_selection() to authenticated;
grant execute on function public.get_uid_selection_state() to authenticated;
grant execute on function public.refresh_uid_selection() to authenticated;
grant execute on function public.select_uid_candidate(integer) to authenticated;
grant execute on function public.complete_uid_selection() to authenticated;

drop view if exists public.public_profiles;
create view public.public_profiles
with (security_invoker = true)
as
select
  id,
  public_uid,
  display_name,
  avatar_url,
  bio,
  markets,
  timeframes,
  created_at
from public.profiles;

drop function if exists public.get_public_profiles(uuid[]);
create function public.get_public_profiles(p_ids uuid[] default null)
returns table (
  id uuid,
  public_uid integer,
  display_name text,
  avatar_url text,
  bio text,
  markets text[],
  timeframes text[],
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    profiles.id,
    profiles.public_uid,
    profiles.display_name,
    profiles.avatar_url,
    profiles.bio,
    profiles.markets,
    profiles.timeframes,
    profiles.created_at
  from public.profiles
  where p_ids is null or profiles.id = any(p_ids);
$$;

revoke all on function public.get_public_profiles(uuid[]) from public;
grant execute on function public.get_public_profiles(uuid[]) to anon, authenticated;

drop policy if exists "verified sessions create own posts" on public.posts;
drop policy if exists "activated users create own posts" on public.posts;
create policy "activated users create own posts"
on public.posts for insert to authenticated
with check (
  author_id = auth.uid()
  and status = 'draft'
  and public.is_activated_user()
);

drop policy if exists "verified users add comments" on public.post_comments;
drop policy if exists "activated users add comments" on public.post_comments;
create policy "activated users add comments"
on public.post_comments for insert to authenticated
with check (
  author_id = auth.uid()
  and status = 'visible'
  and public.is_activated_user()
  and exists (
    select 1
    from public.posts
    where posts.id = post_id
      and posts.status = 'published'
      and posts.comments_enabled
  )
);

drop policy if exists "owners create private entries" on public.private_entries;
drop policy if exists "activated owners create private entries" on public.private_entries;
create policy "activated owners create private entries"
on public.private_entries for insert to authenticated
with check (
  owner_id = auth.uid()
  and public.is_activated_user()
);

drop policy if exists "owners create workbench analyses" on public.workbench_analyses;
drop policy if exists "activated owners create workbench analyses" on public.workbench_analyses;
create policy "activated owners create workbench analyses"
on public.workbench_analyses for insert to authenticated
with check (
  owner_id = auth.uid()
  and public.is_activated_user()
);

drop policy if exists "owners create workbench scenarios" on public.workbench_scenarios;
create policy "activated owners create workbench scenarios"
on public.workbench_scenarios for insert to authenticated
with check (
  owner_id = auth.uid()
  and public.is_activated_user()
);

drop policy if exists "owners create workbench reviews" on public.workbench_reviews;
create policy "activated owners create workbench reviews"
on public.workbench_reviews for insert to authenticated
with check (
  owner_id = auth.uid()
  and public.is_activated_user()
);

drop policy if exists "owners create ai jobs" on public.ai_jobs;
drop policy if exists "activated owners create ai jobs" on public.ai_jobs;
create policy "activated owners create ai jobs"
on public.ai_jobs for insert to authenticated
with check (
  owner_id = auth.uid()
  and public.is_activated_user()
);

drop policy if exists "users add own bookmarks" on public.post_bookmarks;
create policy "activated users add own bookmarks"
on public.post_bookmarks for insert to authenticated
with check (
  user_id = auth.uid()
  and public.is_activated_user()
);

drop policy if exists "users create reports" on public.post_reports;
create policy "activated users create reports"
on public.post_reports for insert to authenticated
with check (
  reporter_id = auth.uid()
  and public.is_activated_user()
);
