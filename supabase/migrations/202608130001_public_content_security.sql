create or replace function public.external_reference_kind(p_url text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when trim(coalesce(p_url, '')) ~* '^https://([a-z0-9-]+\.)*youtube\.com([/:?#]|$)'
      or trim(coalesce(p_url, '')) ~* '^https://youtu\.be([/:?#]|$)'
      then 'youtube'
    when trim(coalesce(p_url, '')) ~* '^https://([a-z0-9-]+\.)*(x\.com|twitter\.com)([/:?#]|$)'
      then 'x'
    else null
  end;
$$;

revoke all on function public.external_reference_kind(text)
from public, anon, authenticated;

alter table public.posts
  drop constraint if exists posts_external_reference_matches_kind;
alter table public.posts
  add constraint posts_external_reference_matches_kind check (
    (external_url is null and external_kind is null)
    or (
      external_url is not null
      and external_kind = public.external_reference_kind(external_url)
    )
  ) not valid;

create or replace function public.update_my_post_v2(
  p_post_id uuid,
  p_title text,
  p_body text,
  p_images jsonb,
  p_external_url text,
  p_external_kind text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_external_url text := nullif(trim(coalesce(p_external_url, '')), '');
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if not exists (
    select 1 from public.posts
    where id = p_post_id and author_id = auth.uid() and status <> 'hidden'
  ) then
    raise exception 'post not editable';
  end if;
  if char_length(trim(p_title)) not between 5 and 120
     or char_length(trim(p_body)) not between 20 and 20000 then
    raise exception 'invalid post content';
  end if;
  if normalized_external_url is not null
     and public.external_reference_kind(normalized_external_url)
       is distinct from p_external_kind then
    raise exception 'invalid external reference';
  end if;
  if normalized_external_url is null and p_external_kind is not null then
    raise exception 'invalid external reference';
  end if;

  update public.posts
  set
    title = trim(p_title),
    body = trim(p_body),
    external_url = normalized_external_url,
    external_kind = case
      when normalized_external_url is null then null
      else p_external_kind
    end
  where id = p_post_id;

  delete from public.post_images
  where post_id = p_post_id;

  insert into public.post_images(post_id, owner_id, storage_path, sort_order)
  select
    p_post_id,
    auth.uid(),
    item->>'storage_path',
    ordinality - 1
  from jsonb_array_elements(coalesce(p_images, '[]'::jsonb))
    with ordinality as image(item, ordinality)
  where item->>'storage_path' like auth.uid()::text || '/' || p_post_id::text || '/%';
end;
$$;

revoke all on function public.update_my_post_v2(
  uuid, text, text, jsonb, text, text
) from public, anon;
grant execute on function public.update_my_post_v2(
  uuid, text, text, jsonb, text, text
) to authenticated;

create or replace function public.get_public_post_profiles(p_ids uuid[])
returns table (
  id uuid,
  public_uid integer,
  display_name text,
  avatar_url text,
  role text,
  display_title text,
  nameplate_style text
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
    profiles.role,
    profiles.display_title,
    profiles.nameplate_style
  from public.profiles
  where profiles.id = any(coalesce(p_ids, '{}'::uuid[]));
$$;

revoke all on function public.get_public_post_profiles(uuid[]) from public;
grant execute on function public.get_public_post_profiles(uuid[])
to anon, authenticated;
