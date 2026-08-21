begin;

-- Keep the legacy friendship RPC intact for old clients while giving the
-- Next.js application a stable, explicitly typed reader.
create or replace function public.list_my_friendships_v2()
returns table (
  friendship_id uuid,
  status text,
  direction text,
  other_id uuid,
  public_uid integer,
  display_name text,
  avatar_url text,
  bio text,
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
    friendship.id::uuid,
    friendship.status::text,
    case
      when friendship.requester_id = auth.uid() then 'outgoing'::text
      else 'incoming'::text
    end,
    profile.id::uuid,
    profile.public_uid::integer,
    profile.display_name::text,
    profile.avatar_url::text,
    profile.bio::text,
    profile.role::text,
    profile.display_title::text,
    profile.nameplate_style::text
  from public.friendships as friendship
  join public.profiles as profile
    on profile.id = case
      when friendship.requester_id = auth.uid() then friendship.addressee_id
      else friendship.requester_id
    end
  where auth.uid() is not null
    and auth.uid() in (friendship.requester_id, friendship.addressee_id)
    and friendship.status <> 'blocked'
  order by friendship.updated_at desc, friendship.id desc;
$$;

revoke all on function public.list_my_friendships_v2() from public, anon;
grant execute on function public.list_my_friendships_v2() to authenticated;

create or replace function public.wavekb_schema_version()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select '202608210002'::text;
$$;

revoke all on function public.wavekb_schema_version() from public;
grant execute on function public.wavekb_schema_version() to anon, authenticated;

commit;
