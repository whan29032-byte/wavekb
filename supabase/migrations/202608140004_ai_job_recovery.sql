create or replace function public.claim_ai_job(p_worker_id text)
returns public.ai_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed public.ai_jobs;
begin
  select * into claimed
  from public.ai_jobs
  where (
      status in ('queued', 'waiting_retry')
      and available_at <= now()
    ) or (
      status = 'running'
      and started_at < now() - interval '10 minutes'
    )
  order by created_at
  for update skip locked
  limit 1;

  if claimed.id is null then return null; end if;

  update public.ai_jobs
  set status = 'running', worker_id = p_worker_id, started_at = now(), finished_at = null
  where id = claimed.id
  returning * into claimed;
  return claimed;
end;
$$;

revoke all on function public.claim_ai_job(text) from public, anon, authenticated;
grant execute on function public.claim_ai_job(text) to service_role;
