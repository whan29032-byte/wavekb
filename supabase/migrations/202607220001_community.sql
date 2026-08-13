create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 32),
  avatar_url text,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  board text not null check (board in ('case_submission', 'idea_sharing')),
  title text not null check (char_length(title) between 5 and 120),
  body text not null check (char_length(body) between 20 and 20000),
  author_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'published', 'hidden')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.post_images (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null unique,
  sort_order smallint not null check (sort_order between 0 and 8),
  created_at timestamptz not null default now(),
  unique (post_id, sort_order)
);

create index posts_board_created_idx on public.posts(board, created_at desc)
  where status = 'published';
create index post_images_post_idx on public.post_images(post_id, sort_order);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

create trigger posts_touch_updated_at
before update on public.posts
for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(
      coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), '新用户'),
      32
    )
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.update_my_profile(new_display_name text)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_profile public.profiles;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if char_length(trim(new_display_name)) not between 2 and 32 then
    raise exception 'display name must contain 2 to 32 characters';
  end if;
  update public.profiles
  set display_name = trim(new_display_name)
  where id = auth.uid()
  returning * into updated_profile;
  return updated_profile;
end;
$$;

alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.post_images enable row level security;

create policy "profiles are publicly readable"
on public.profiles for select
using (true);

create policy "published or owned posts are readable"
on public.posts for select
using (status = 'published' or author_id = auth.uid() or public.is_admin());

create policy "verified sessions create own posts"
on public.posts for insert to authenticated
with check (author_id = auth.uid() and status = 'draft');

create policy "authors update own active posts"
on public.posts for update to authenticated
using (author_id = auth.uid() and status in ('draft', 'published'))
with check (author_id = auth.uid() and status in ('draft', 'published'));

create policy "authors delete own posts"
on public.posts for delete to authenticated
using (author_id = auth.uid());

create policy "admins manage all posts"
on public.posts for all to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "images of readable posts are readable"
on public.post_images for select
using (exists (select 1 from public.posts where posts.id = post_id));

create policy "authors add own post images"
on public.post_images for insert to authenticated
with check (
  owner_id = auth.uid()
  and exists (
    select 1 from public.posts
    where posts.id = post_id and posts.author_id = auth.uid()
  )
);

create policy "authors remove own post images"
on public.post_images for delete to authenticated
using (owner_id = auth.uid());

create policy "authors reorder own post images"
on public.post_images for update to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create policy "admins manage all post images"
on public.post_images for all to authenticated
using (public.is_admin())
with check (public.is_admin());

create or replace function public.update_my_post(
  p_post_id uuid,
  p_title text,
  p_body text,
  p_images jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if not exists (
    select 1
    from public.posts
    where id = p_post_id
      and author_id = auth.uid()
      and status in ('draft', 'published')
  ) then
    raise exception 'post not found or forbidden';
  end if;
  if char_length(trim(p_title)) not between 5 and 120 then
    raise exception 'invalid title';
  end if;
  if char_length(trim(p_body)) not between 20 and 20000 then
    raise exception 'invalid body';
  end if;
  if jsonb_typeof(p_images) <> 'array' or jsonb_array_length(p_images) > 9 then
    raise exception 'invalid images';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_images) image
    where image ->> 'storage_path'
      not like auth.uid()::text || '/' || p_post_id::text || '/%'
  ) then
    raise exception 'invalid image owner';
  end if;

  update public.posts
  set title = trim(p_title), body = trim(p_body)
  where id = p_post_id;

  delete from public.post_images where post_id = p_post_id;
  insert into public.post_images (post_id, owner_id, storage_path, sort_order)
  select
    p_post_id,
    auth.uid(),
    image ->> 'storage_path',
    (ordinality - 1)::smallint
  from jsonb_array_elements(p_images)
  with ordinality as items(image, ordinality);
end;
$$;

revoke all on function public.update_my_profile(text) from public, anon;
grant execute on function public.update_my_profile(text) to authenticated;
revoke all on function public.update_my_post(uuid, text, text, jsonb) from public, anon;
grant execute on function public.update_my_post(uuid, text, text, jsonb) to authenticated;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'post-images',
  'post-images',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "post images are publicly readable"
on storage.objects for select
using (bucket_id = 'post-images');

create policy "users upload into own image folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'post-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "users remove images from own folder"
on storage.objects for delete to authenticated
using (
  bucket_id = 'post-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "admins remove any post image"
on storage.objects for delete to authenticated
using (bucket_id = 'post-images' and public.is_admin());
