create or replace function public.external_media_kind(p_url text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when trim(coalesce(p_url, '')) ~ '^https://(www\.|m\.)?youtube\.com/watch\?([^#]*&)?v=[A-Za-z0-9_-]{6,64}(&[^#]*)?(#.*)?$'
      or trim(coalesce(p_url, '')) ~ '^https://(www\.)?youtube\.com/(shorts|embed)/[A-Za-z0-9_-]{6,64}/?([?#].*)?$'
      or trim(coalesce(p_url, '')) ~ '^https://youtu\.be/[A-Za-z0-9_-]{6,64}/?([?#].*)?$'
      or trim(coalesce(p_url, '')) ~ '^https://(www\.)?youtube-nocookie\.com/embed/[A-Za-z0-9_-]{6,64}/?([?#].*)?$'
      then 'youtube'
    when trim(coalesce(p_url, '')) ~ '^https://(www\.|mobile\.)?(x\.com|twitter\.com)/[^/?#]+/status/[0-9]+/?([?#].*)?$'
      then 'x'
    else null
  end;
$$;

revoke all on function public.external_media_kind(text) from public, anon;
grant execute on function public.external_media_kind(text) to authenticated;

alter table public.post_images
  add column if not exists caption text not null default ''
    check (char_length(caption) <= 240);

create table if not exists public.post_external_references (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  url text not null check (char_length(url) <= 1000),
  kind text not null check (kind in ('youtube', 'x')),
  sort_order smallint not null check (sort_order between 0 and 4),
  created_at timestamptz not null default now(),
  unique (post_id, sort_order),
  unique (post_id, url),
  check (kind = public.external_media_kind(url))
);

create index if not exists post_external_references_post_idx
  on public.post_external_references(post_id, sort_order);

insert into public.post_external_references(post_id, owner_id, url, kind, sort_order)
select id, author_id, external_url, external_kind, 0
from public.posts
where external_url is not null
  and external_kind is not null
  and public.external_media_kind(external_url) = external_kind
on conflict (post_id, sort_order) do nothing;

create table if not exists public.research_timeline_nodes (
  id uuid primary key,
  subject_type text not null check (subject_type in ('post', 'private_entry')),
  post_id uuid references public.posts(id) on delete cascade,
  private_entry_id uuid references public.private_entries(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in (
    'published', 'update', 'confirmed', 'invalidated', 'trade_started',
    'position_added', 'position_reduced', 'stop_updated', 'target_hit',
    'stop_hit', 'trade_closed', 'review'
  )),
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now(),
  check (
    (subject_type = 'post' and post_id is not null and private_entry_id is null)
    or (subject_type = 'private_entry' and private_entry_id is not null and post_id is null)
  )
);

create index if not exists research_timeline_post_idx
  on public.research_timeline_nodes(post_id, created_at asc)
  where post_id is not null;
create index if not exists research_timeline_private_entry_idx
  on public.research_timeline_nodes(private_entry_id, created_at asc)
  where private_entry_id is not null;

create table if not exists public.research_timeline_images (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.research_timeline_nodes(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null unique,
  sort_order smallint not null check (sort_order between 0 and 8),
  caption text not null default '' check (char_length(caption) <= 240),
  created_at timestamptz not null default now(),
  unique (node_id, sort_order)
);

create index if not exists research_timeline_images_node_idx
  on public.research_timeline_images(node_id, sort_order);

alter table public.post_external_references enable row level security;
alter table public.research_timeline_nodes enable row level security;
alter table public.research_timeline_images enable row level security;

create policy "references follow readable posts"
on public.post_external_references for select
using (exists (
  select 1 from public.posts
  where posts.id = post_id
    and (posts.status = 'published' or posts.author_id = auth.uid() or public.is_admin())
));

create policy "authors add references to their posts"
on public.post_external_references for insert to authenticated
with check (
  owner_id = auth.uid()
  and exists (
    select 1 from public.posts
    where posts.id = post_id
      and posts.author_id = auth.uid()
      and posts.status <> 'hidden'
  )
);

create policy "admins manage post references"
on public.post_external_references for all to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "readable research timelines"
on public.research_timeline_nodes for select
using (
  (post_id is not null and exists (
    select 1 from public.posts
    where posts.id = post_id
      and (posts.status = 'published' or posts.author_id = auth.uid() or public.is_admin())
  ))
  or (private_entry_id is not null and exists (
    select 1 from public.private_entries
    where private_entries.id = private_entry_id
      and (private_entries.owner_id = auth.uid() or public.is_admin())
  ))
);

create policy "admins manage research timelines"
on public.research_timeline_nodes for all to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "timeline images follow readable nodes"
on public.research_timeline_images for select
using (exists (
  select 1 from public.research_timeline_nodes
  where research_timeline_nodes.id = node_id
));

create policy "admins manage timeline images"
on public.research_timeline_images for all to authenticated
using (public.is_admin())
with check (public.is_admin());

create or replace function public.update_my_post_v4(
  p_post_id uuid,
  p_title text,
  p_body text,
  p_images jsonb,
  p_external_references jsonb,
  p_chart_package jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  image_count integer;
  reference_count integer;
  first_reference jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if not public.account_is_active() then raise exception 'account restricted'; end if;
  if not exists (
    select 1 from public.posts
    where id = p_post_id and author_id = auth.uid() and status <> 'hidden'
  ) then raise exception 'post not editable'; end if;
  if char_length(trim(p_title)) not between 5 and 120
     or char_length(trim(p_body)) not between 20 and 20000 then
    raise exception 'invalid post content';
  end if;
  if jsonb_typeof(coalesce(p_images, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_external_references, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid post collections';
  end if;
  image_count := jsonb_array_length(coalesce(p_images, '[]'::jsonb));
  reference_count := jsonb_array_length(coalesce(p_external_references, '[]'::jsonb));
  if image_count > 9 then raise exception 'too many post images'; end if;
  if reference_count > 5 then raise exception 'too many external references'; end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_external_references, '[]'::jsonb)) item
    where public.external_media_kind(item->>'url') is distinct from item->>'kind'
  ) then raise exception 'invalid external reference'; end if;

  first_reference := coalesce(p_external_references, '[]'::jsonb)->0;
  update public.posts set
    title = trim(p_title),
    body = trim(p_body),
    external_url = nullif(first_reference->>'url', ''),
    external_kind = nullif(first_reference->>'kind', ''),
    chart_package = p_chart_package
  where id = p_post_id;

  delete from public.post_images where post_id = p_post_id;
  insert into public.post_images(post_id, owner_id, storage_path, sort_order, caption)
  select p_post_id, auth.uid(), item->>'storage_path', ordinality - 1,
    left(trim(coalesce(item->>'caption', '')), 240)
  from jsonb_array_elements(coalesce(p_images, '[]'::jsonb))
    with ordinality as image(item, ordinality)
  where item->>'storage_path' like auth.uid()::text || '/' || p_post_id::text || '/%';
  if (select count(*) from public.post_images where post_id = p_post_id) <> image_count then
    raise exception 'invalid post image path';
  end if;

  delete from public.post_external_references where post_id = p_post_id;
  insert into public.post_external_references(post_id, owner_id, url, kind, sort_order)
  select p_post_id, auth.uid(), item->>'url', item->>'kind', ordinality - 1
  from jsonb_array_elements(coalesce(p_external_references, '[]'::jsonb))
    with ordinality as reference(item, ordinality);
end;
$$;

revoke all on function public.update_my_post_v4(uuid, text, text, jsonb, jsonb, jsonb)
from public, anon;
grant execute on function public.update_my_post_v4(uuid, text, text, jsonb, jsonb, jsonb)
to authenticated;

create or replace function public.append_research_timeline_node(
  p_post_id uuid,
  p_node_id uuid,
  p_kind text,
  p_body text,
  p_images jsonb
)
returns public.research_timeline_nodes
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_node public.research_timeline_nodes;
  image_count integer;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if not public.account_is_active() then raise exception 'account restricted'; end if;
  if not exists (
    select 1 from public.posts
    where id = p_post_id and author_id = auth.uid() and status = 'published'
  ) then raise exception 'post not editable'; end if;
  if p_kind not in (
    'update', 'confirmed', 'invalidated', 'trade_started', 'position_added',
    'position_reduced', 'stop_updated', 'target_hit', 'stop_hit',
    'trade_closed', 'review'
  ) then raise exception 'invalid timeline kind'; end if;
  if char_length(trim(coalesce(p_body, ''))) not between 1 and 5000 then
    raise exception 'invalid timeline body';
  end if;
  if jsonb_typeof(coalesce(p_images, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid timeline images';
  end if;
  image_count := jsonb_array_length(coalesce(p_images, '[]'::jsonb));
  if image_count > 9 then raise exception 'too many timeline images'; end if;

  insert into public.research_timeline_nodes(
    id, subject_type, post_id, private_entry_id, author_id, kind, body
  ) values (
    p_node_id, 'post', p_post_id, null, auth.uid(), p_kind, trim(p_body)
  ) returning * into inserted_node;

  insert into public.research_timeline_images(node_id, owner_id, storage_path, sort_order, caption)
  select p_node_id, auth.uid(), item->>'storage_path', ordinality - 1,
    left(trim(coalesce(item->>'caption', '')), 240)
  from jsonb_array_elements(coalesce(p_images, '[]'::jsonb))
    with ordinality as image(item, ordinality)
  where item->>'storage_path' like auth.uid()::text || '/' || p_post_id::text || '/timeline/' || p_node_id::text || '/%';
  if (select count(*) from public.research_timeline_images where node_id = p_node_id) <> image_count then
    raise exception 'invalid timeline image path';
  end if;
  return inserted_node;
end;
$$;

revoke all on function public.append_research_timeline_node(uuid, uuid, text, text, jsonb)
from public, anon;
grant execute on function public.append_research_timeline_node(uuid, uuid, text, text, jsonb)
to authenticated;

create or replace function public.wavekb_schema_version()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select '202608210001'::text;
$$;

revoke all on function public.wavekb_schema_version() from public;
grant execute on function public.wavekb_schema_version() to anon, authenticated;
