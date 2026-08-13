alter table public.profiles
  add column if not exists display_title text not null default ''
    check (char_length(display_title) <= 32),
  add column if not exists nameplate_style text not null default 'classic'
    check (nameplate_style in ('classic', 'blackgold', 'platinum', 'purplegold', 'rainbow')),
  add column if not exists cover_url text,
  add column if not exists cover_style text not null default 'chart-dark'
    check (cover_style in ('chart-dark', 'wave-blue', 'paper', 'midnight'));

alter table public.posts
  add column if not exists external_url text
    check (external_url is null or (
      char_length(external_url) <= 1000
      and external_url ~ '^https://'
    )),
  add column if not exists external_kind text
    check (external_kind is null or external_kind in ('youtube', 'x'));

create or replace function public.update_my_profile_v2(
  new_display_name text,
  new_bio text,
  new_markets text[],
  new_timeframes text[],
  new_avatar_url text,
  new_cover_url text,
  new_cover_style text
)
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
  if char_length(trim(coalesce(new_bio, ''))) > 200 then
    raise exception 'bio is too long';
  end if;
  if cardinality(coalesce(new_markets, '{}')) > 8
     or cardinality(coalesce(new_timeframes, '{}')) > 8 then
    raise exception 'too many profile tags';
  end if;
  if new_avatar_url is not null
     and new_avatar_url not like '%/profile-avatars/' || auth.uid()::text || '/%' then
    raise exception 'invalid avatar owner';
  end if;
  if new_cover_url is not null
     and new_cover_url not like '%/profile-avatars/' || auth.uid()::text || '/%' then
    raise exception 'invalid cover owner';
  end if;
  if coalesce(new_cover_style, '') not in (
    'chart-dark', 'wave-blue', 'paper', 'midnight'
  ) then
    raise exception 'invalid cover style';
  end if;

  update public.profiles
  set
    display_name = trim(new_display_name),
    bio = trim(coalesce(new_bio, '')),
    markets = coalesce(new_markets, '{}'),
    timeframes = coalesce(new_timeframes, '{}'),
    avatar_url = nullif(trim(coalesce(new_avatar_url, '')), ''),
    cover_url = nullif(trim(coalesce(new_cover_url, '')), ''),
    cover_style = new_cover_style
  where id = auth.uid()
  returning * into updated_profile;
  return updated_profile;
end;
$$;

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
  if p_external_url is not null and (
    p_external_url !~ '^https://'
    or p_external_kind not in ('youtube', 'x')
  ) then
    raise exception 'invalid external reference';
  end if;

  update public.posts
  set
    title = trim(p_title),
    body = trim(p_body),
    external_url = nullif(trim(coalesce(p_external_url, '')), ''),
    external_kind = case
      when nullif(trim(coalesce(p_external_url, '')), '') is null then null
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
  role,
  display_title,
  nameplate_style,
  cover_url,
  cover_style,
  created_at
from public.profiles;

revoke all on function public.update_my_profile_v2(
  text, text, text[], text[], text, text, text
) from public, anon;
grant execute on function public.update_my_profile_v2(
  text, text, text[], text[], text, text, text
) to authenticated;

revoke all on function public.update_my_post_v2(
  uuid, text, text, jsonb, text, text
) from public, anon;
grant execute on function public.update_my_post_v2(
  uuid, text, text, jsonb, text, text
) to authenticated;
