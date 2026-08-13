alter table public.profiles
  add column if not exists bio text not null default ''
    check (char_length(bio) <= 200),
  add column if not exists markets text[] not null default '{}'
    check (cardinality(markets) <= 8),
  add column if not exists timeframes text[] not null default '{}'
    check (cardinality(timeframes) <= 8);

drop policy if exists "profiles are publicly readable" on public.profiles;

create policy "owners and admins read full profiles"
on public.profiles for select
using (id = auth.uid() or public.is_admin());

drop view if exists public.public_profiles;
create view public.public_profiles
with (security_invoker = true)
as
select id, display_name, avatar_url, bio, markets, timeframes, created_at
from public.profiles;

create or replace function public.get_public_profiles(p_ids uuid[] default null)
returns table (
  id uuid,
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
    profiles.display_name,
    profiles.avatar_url,
    profiles.bio,
    profiles.markets,
    profiles.timeframes,
    profiles.created_at
  from public.profiles
  where p_ids is null or profiles.id = any(p_ids);
$$;

create or replace function public.is_verified_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users
    where id = auth.uid()
      and email_confirmed_at is not null
  );
$$;

create or replace function public.update_my_profile(
  new_display_name text,
  new_bio text,
  new_markets text[],
  new_timeframes text[],
  new_avatar_url text
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

  update public.profiles
  set
    display_name = trim(new_display_name),
    bio = trim(coalesce(new_bio, '')),
    markets = coalesce(new_markets, '{}'),
    timeframes = coalesce(new_timeframes, '{}'),
    avatar_url = nullif(trim(coalesce(new_avatar_url, '')), '')
  where id = auth.uid()
  returning * into updated_profile;
  return updated_profile;
end;
$$;

revoke all on function public.get_public_profiles(uuid[]) from public;
grant execute on function public.get_public_profiles(uuid[]) to anon, authenticated;
revoke all on function public.is_verified_user() from public, anon;
grant execute on function public.is_verified_user() to authenticated;
revoke all on function public.update_my_profile(text, text, text[], text[], text)
  from public, anon;
grant execute on function public.update_my_profile(text, text, text[], text[], text)
  to authenticated;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'profile-avatars',
  'profile-avatars',
  true,
  5000000,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "profile avatars are publicly readable"
on storage.objects for select
using (bucket_id = 'profile-avatars');

create policy "users upload own profile avatar"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "users replace own profile avatar"
on storage.objects for update to authenticated
using (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "users remove own profile avatar"
on storage.objects for delete to authenticated
using (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "admins remove any profile avatar"
on storage.objects for delete to authenticated
using (bucket_id = 'profile-avatars' and public.is_admin());
