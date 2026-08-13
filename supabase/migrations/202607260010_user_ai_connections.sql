create table if not exists public.user_ai_connections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  label text not null check (char_length(label) between 2 and 60),
  adapter text not null check (adapter in ('openai_compatible', 'anthropic', 'gemini')),
  base_url text not null,
  model_name text not null check (char_length(model_name) between 1 and 120),
  max_output_tokens integer not null default 4096
    check (max_output_tokens between 1 and 262144),
  context_tokens integer not null default 32768
    check (context_tokens between 1 and 4000000),
  temperature numeric(3,2) not null default 0.20
    check (temperature between 0 and 2),
  timeout_ms integer not null default 60000
    check (timeout_ms between 1000 and 600000),
  enabled boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists user_ai_connections_one_default_idx
on public.user_ai_connections(owner_id) where is_default and enabled;

create index if not exists user_ai_connections_owner_idx
on public.user_ai_connections(owner_id, created_at desc);

drop trigger if exists user_ai_connections_touch_updated_at
on public.user_ai_connections;
create trigger user_ai_connections_touch_updated_at
before update on public.user_ai_connections
for each row execute function public.touch_updated_at();

create table if not exists public.user_ai_connection_secrets (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.user_ai_connections(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  ciphertext text not null,
  iv text not null,
  auth_tag text not null,
  key_version integer not null default 1 check (key_version > 0),
  last_four text not null check (char_length(last_four) <= 4),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

create unique index if not exists user_ai_connection_secrets_one_active_idx
on public.user_ai_connection_secrets(connection_id) where active;

alter table public.ai_jobs
  add column if not exists user_connection_id uuid
  references public.user_ai_connections(id) on delete set null,
  add column if not exists connection_snapshot jsonb not null default '{}'::jsonb;

alter table public.user_ai_connections enable row level security;
alter table public.user_ai_connection_secrets enable row level security;

drop policy if exists "owners read their ai connection metadata"
on public.user_ai_connections;
create policy "owners read their ai connection metadata"
on public.user_ai_connections for select to authenticated
using (owner_id = auth.uid());

-- Connections and secrets are written only by the site gateway. The browser can
-- never read ciphertext, IVs, tags, or a stored API key through Supabase RLS.

create or replace function public.set_default_user_ai_connection(
  p_owner_id uuid,
  p_connection_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.user_ai_connections
    where id = p_connection_id
      and owner_id = p_owner_id
      and enabled
  ) then
    raise exception 'connection not found or disabled';
  end if;

  update public.user_ai_connections
  set is_default = (id = p_connection_id)
  where owner_id = p_owner_id;
end;
$$;

revoke all on function public.set_default_user_ai_connection(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.set_default_user_ai_connection(uuid, uuid)
to service_role;

create or replace function public.rotate_user_ai_connection_secret(
  p_owner_id uuid,
  p_connection_id uuid,
  p_ciphertext text,
  p_iv text,
  p_auth_tag text,
  p_key_version integer,
  p_last_four text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.user_ai_connections
    where id = p_connection_id and owner_id = p_owner_id
  ) then
    raise exception 'connection not found';
  end if;

  update public.user_ai_connection_secrets
  set active = false, rotated_at = now()
  where connection_id = p_connection_id
    and owner_id = p_owner_id
    and active;

  insert into public.user_ai_connection_secrets (
    connection_id, owner_id, ciphertext, iv, auth_tag,
    key_version, last_four, active
  )
  values (
    p_connection_id, p_owner_id, p_ciphertext, p_iv, p_auth_tag,
    p_key_version, p_last_four, true
  );
end;
$$;

revoke all on function public.rotate_user_ai_connection_secret(
  uuid, uuid, text, text, text, integer, text
) from public, anon, authenticated;
grant execute on function public.rotate_user_ai_connection_secret(
  uuid, uuid, text, text, text, integer, text
) to service_role;
