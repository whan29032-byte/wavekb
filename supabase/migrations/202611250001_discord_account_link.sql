alter table public.profiles
  add column if not exists discord_user_id text
    check (discord_user_id is null or discord_user_id ~ '^[0-9]{17,20}$'),
  add column if not exists discord_linked_at timestamptz;

create unique index if not exists profiles_discord_user_id_unique
on public.profiles(discord_user_id)
where discord_user_id is not null;

create table if not exists public.discord_link_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique
    check (token_hash ~ '^[0-9a-f]{64}$'),
  discord_user_id text not null
    check (discord_user_id ~ '^[0-9]{17,20}$'),
  guild_id text not null
    check (guild_id ~ '^[0-9]{17,20}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  redeemed_at timestamptz,
  redeemed_by uuid references auth.users(id) on delete set null,
  check ((redeemed_at is null) = (redeemed_by is null))
);

create index if not exists discord_link_tokens_identity_idx
on public.discord_link_tokens(discord_user_id, guild_id, created_at desc);

create index if not exists discord_link_tokens_expiry_idx
on public.discord_link_tokens(expires_at)
where revoked_at is null and redeemed_at is null;

alter table public.discord_link_tokens enable row level security;

revoke all on table public.discord_link_tokens from public, anon, authenticated;
grant select, insert, update, delete on table public.discord_link_tokens to service_role;

create or replace function public.issue_discord_link_token(
  p_token_hash text,
  p_discord_user_id text,
  p_guild_id text
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  issued_at timestamptz;
  token_expires_at timestamptz;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'discord_link_token_invalid';
  end if;
  if p_discord_user_id is null or p_discord_user_id !~ '^[0-9]{17,20}$' then
    raise exception 'discord_user_invalid';
  end if;
  if p_guild_id is null or p_guild_id !~ '^[0-9]{17,20}$' then
    raise exception 'discord_guild_invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_guild_id || ':' || p_discord_user_id, 0)
  );
  issued_at := pg_catalog.clock_timestamp();

  update public.discord_link_tokens
  set revoked_at = issued_at
  where discord_user_id = p_discord_user_id
    and guild_id = p_guild_id
    and revoked_at is null
    and redeemed_at is null;

  token_expires_at := issued_at + interval '10 minutes';
  insert into public.discord_link_tokens (
    token_hash,
    discord_user_id,
    guild_id,
    expires_at
  ) values (
    p_token_hash,
    p_discord_user_id,
    p_guild_id,
    token_expires_at
  );

  return token_expires_at;
end;
$$;

revoke all on function public.issue_discord_link_token(text, text, text)
from public, anon, authenticated;
grant execute on function public.issue_discord_link_token(text, text, text)
to service_role;

create or replace function public.redeem_discord_link_token(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  token_row public.discord_link_tokens%rowtype;
  profile_row public.profiles%rowtype;
begin
  actor := auth.uid();
  if actor is null then
    raise exception 'authentication_required';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'discord_link_token_invalid';
  end if;

  select *
  into token_row
  from public.discord_link_tokens
  where token_hash = p_token_hash
  for update;

  if not found then
    raise exception 'discord_link_token_invalid';
  end if;
  if token_row.revoked_at is not null then
    raise exception 'discord_link_token_revoked';
  end if;
  if token_row.redeemed_at is not null then
    raise exception 'discord_link_token_used';
  end if;
  if token_row.expires_at <= now() then
    raise exception 'discord_link_token_expired';
  end if;

  select *
  into profile_row
  from public.profiles
  where id = actor
  for update;

  if not found then
    raise exception 'member_profile_missing';
  end if;
  if profile_row.account_status <> 'active' then
    raise exception 'account_restricted';
  end if;
  if profile_row.public_uid is null then
    raise exception 'uid_activation_required';
  end if;
  if exists (
    select 1
    from public.profiles
    where discord_user_id = token_row.discord_user_id
      and id <> actor
  ) then
    raise exception 'discord_identity_already_linked';
  end if;

  begin
    update public.profiles
    set discord_user_id = token_row.discord_user_id,
        discord_linked_at = now()
    where id = actor;
  exception
    when unique_violation then
      raise exception 'discord_identity_already_linked';
  end;

  update public.discord_link_tokens
  set redeemed_at = now(),
      redeemed_by = actor
  where id = token_row.id;

  return jsonb_build_object(
    'public_uid', profile_row.public_uid,
    'discord_user_id', token_row.discord_user_id
  );
end;
$$;

revoke all on function public.redeem_discord_link_token(text)
from public, anon;
grant execute on function public.redeem_discord_link_token(text)
to authenticated;

create or replace function public.wavekb_schema_version()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select '202611250001'::text;
$$;

revoke all on function public.wavekb_schema_version()
from public, anon, authenticated, service_role;
grant execute on function public.wavekb_schema_version()
to anon, authenticated, service_role;
