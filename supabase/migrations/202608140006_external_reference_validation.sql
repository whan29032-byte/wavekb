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

create or replace function public.wavekb_schema_version()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select '202608140006'::text;
$$;

revoke all on function public.wavekb_schema_version() from public;
grant execute on function public.wavekb_schema_version() to anon, authenticated;
