begin;

create table if not exists public.profile_follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followed_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followed_id),
  check (follower_id <> followed_id)
);

create index if not exists profile_follows_followed_created_idx
  on public.profile_follows (followed_id, created_at desc);

alter table public.profile_follows enable row level security;

drop policy if exists "users read their own follows" on public.profile_follows;
create policy "users read their own follows"
  on public.profile_follows for select to authenticated
  using (follower_id = auth.uid());

drop policy if exists "users create their own follows" on public.profile_follows;
create policy "users create their own follows"
  on public.profile_follows for insert to authenticated
  with check (follower_id = auth.uid() and followed_id <> auth.uid());

drop policy if exists "users delete their own follows" on public.profile_follows;
create policy "users delete their own follows"
  on public.profile_follows for delete to authenticated
  using (follower_id = auth.uid());

revoke all on public.profile_follows from anon;
grant select, insert, delete on public.profile_follows to authenticated;

commit;
