create table public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  parent_id uuid references public.post_comments(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  status text not null default 'visible'
    check (status in ('visible', 'deleted_by_author', 'hidden_by_admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index post_comments_post_created_idx
on public.post_comments(post_id, created_at);

create trigger post_comments_touch_updated_at
before update on public.post_comments
for each row execute function public.touch_updated_at();

create or replace function public.validate_comment_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_post_id uuid;
  parent_parent_id uuid;
begin
  if new.parent_id is null then
    return new;
  end if;

  select post_id, parent_id
  into parent_post_id, parent_parent_id
  from public.post_comments
  where id = new.parent_id;

  if parent_post_id is null or parent_post_id <> new.post_id then
    raise exception 'parent comment must belong to the same post';
  end if;
  if parent_parent_id is not null then
    raise exception 'parent comment must be top level';
  end if;
  return new;
end;
$$;

create trigger validate_comment_parent
before insert or update of parent_id, post_id on public.post_comments
for each row execute function public.validate_comment_parent();

alter table public.post_comments enable row level security;

create policy "visible comments are readable"
on public.post_comments for select
using (
  status = 'visible'
  and exists (
    select 1
    from public.posts
    where posts.id = post_id and posts.status = 'published'
  )
);

create policy "verified users add comments"
on public.post_comments for insert to authenticated
with check (
  author_id = auth.uid()
  and status = 'visible'
  and public.is_verified_user()
  and exists (
    select 1
    from public.posts
    where posts.id = post_id
      and posts.status = 'published'
      and posts.comments_enabled
  )
);

create policy "authors soft delete comments"
on public.post_comments for update to authenticated
using (author_id = auth.uid() and status = 'visible')
with check (author_id = auth.uid() and status = 'deleted_by_author');

create policy "admins moderate comments"
on public.post_comments for update to authenticated
using (public.is_admin())
with check (public.is_admin());

create table public.post_bookmarks (
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

alter table public.post_bookmarks enable row level security;

create policy "users read own bookmarks"
on public.post_bookmarks for select to authenticated
using (user_id = auth.uid());

create policy "users add own bookmarks"
on public.post_bookmarks for insert to authenticated
with check (user_id = auth.uid());

create policy "users remove own bookmarks"
on public.post_bookmarks for delete to authenticated
using (user_id = auth.uid());

create table public.post_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  reason text not null check (char_length(reason) between 5 and 500),
  status text not null default 'open'
    check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (reporter_id, post_id)
);

alter table public.post_reports enable row level security;

create policy "users create reports"
on public.post_reports for insert to authenticated
with check (reporter_id = auth.uid());

create policy "reporters and admins read reports"
on public.post_reports for select to authenticated
using (reporter_id = auth.uid() or public.is_admin());

create policy "admins update reports"
on public.post_reports for update to authenticated
using (public.is_admin())
with check (public.is_admin());
