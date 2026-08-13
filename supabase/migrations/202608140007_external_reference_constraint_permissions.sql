-- The posts check constraint invokes this pure validator in the caller's
-- security context, so authenticated writers need EXECUTE on the function.
grant execute on function public.external_reference_kind(text) to authenticated;

create or replace function public.wavekb_schema_version()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select '202608140007'::text;
$$;

revoke all on function public.wavekb_schema_version() from public;
grant execute on function public.wavekb_schema_version() to anon, authenticated;
