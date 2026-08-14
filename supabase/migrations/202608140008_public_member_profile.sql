-- Publish one active member by UID through an explicit field allowlist. Full
-- profile rows remain protected by RLS, while public profile pages work for
-- anonymous visitors without exposing account or authentication metadata.
create or replace function public.get_public_profile_by_uid(p_uid integer)
returns table (
  id uuid,
  public_uid integer,
  display_name text,
  avatar_url text,
  bio text,
  markets text[],
  timeframes text[],
  role text,
  display_title text,
  nameplate_style text,
  cover_url text,
  cover_style text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    profile.id,
    profile.public_uid,
    profile.display_name,
    profile.avatar_url,
    profile.bio,
    profile.markets,
    profile.timeframes,
    profile.role,
    profile.display_title,
    profile.nameplate_style,
    profile.cover_url,
    profile.cover_style,
    profile.created_at
  from public.profiles profile
  where profile.public_uid = p_uid
    and profile.account_status = 'active'
  limit 1;
$$;

revoke all on function public.get_public_profile_by_uid(integer) from public;
grant execute on function public.get_public_profile_by_uid(integer) to anon, authenticated;

create or replace function public.wavekb_schema_version()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select '202608140008'::text;
$$;

revoke all on function public.wavekb_schema_version() from public;
grant execute on function public.wavekb_schema_version() to anon, authenticated;
