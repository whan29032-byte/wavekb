begin;

-- Trade review is a separate AI subject. It is revision-bound and never
-- borrows workbench_analyses.analysis_id or mutable provider payloads.
alter table public.ai_jobs
  add column if not exists trade_cycle_id uuid,
  add column if not exists trade_cycle_revision integer,
  add column if not exists trade_context jsonb;

alter table public.ai_jobs
  add constraint ai_jobs_trade_cycle_owner_fkey
    foreign key (trade_cycle_id, owner_id)
    references public.trading_trade_cycles(id, owner_id) on delete cascade,
  add constraint ai_jobs_trade_cycle_revision_fkey
    foreign key (trade_cycle_id, trade_cycle_revision)
    references public.trading_trade_cycle_revisions(cycle_id, revision),
  add constraint ai_jobs_subject_check check (
    (
      task_type = 'wave_analysis'
      and analysis_id is not null
      and trade_cycle_id is null
      and trade_cycle_revision is null
      and trade_context is null
    )
    or
    (
      task_type = 'trade_review'
      and analysis_id is null
      and trade_cycle_id is not null
      and trade_cycle_revision is not null
      and trade_cycle_revision > 0
      and jsonb_typeof(trade_context) = 'object'
    )
  ) not valid;

alter table public.ai_jobs validate constraint ai_jobs_subject_check;

create index if not exists ai_jobs_trade_cycle_idx
on public.ai_jobs(owner_id, trade_cycle_id, trade_cycle_revision, created_at desc)
where task_type = 'trade_review';

create or replace function public.guard_membership_ai_job()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' then
    if row(new.owner_id,new.analysis_id,new.trade_cycle_id,new.trade_cycle_revision,new.trade_context,
      new.task_type,new.idempotency_key,new.execution_source,new.managed_model_id,new.accepted_request,new.created_at)
      is distinct from row(old.owner_id,old.analysis_id,old.trade_cycle_id,old.trade_cycle_revision,old.trade_context,
      old.task_type,old.idempotency_key,old.execution_source,old.managed_model_id,old.accepted_request,old.created_at) then
      raise exception 'ai_job_identity_immutable';
    end if;
    if new.user_connection_id is distinct from old.user_connection_id and new.user_connection_id is not null then
      raise exception 'ai_job_identity_immutable';
    end if;
    if old.execution_source='managed' and old.status in ('failed','cancelled','succeeded')
      and new.status is distinct from old.status then raise exception 'ai_job_terminal'; end if;
    return new;
  end if;

  if new.status <> 'queued' then raise exception 'ai_job_input_invalid'; end if;
  if new.task_type = 'wave_analysis' then
    if new.analysis_id is null or new.trade_cycle_id is not null
      or not exists (
        select 1 from public.workbench_analyses
        where id=new.analysis_id and owner_id=new.owner_id
      ) then raise exception 'ai_job_input_invalid'; end if;
  elsif new.task_type = 'trade_review' then
    if new.analysis_id is not null or new.trade_cycle_id is null
      or new.trade_cycle_revision is null or jsonb_typeof(new.trade_context) <> 'object'
      or not exists (
        select 1 from public.trading_trade_cycles cycle
        join public.trading_trade_cycle_revisions revision
          on revision.cycle_id=cycle.id and revision.revision=new.trade_cycle_revision
        where cycle.id=new.trade_cycle_id and cycle.owner_id=new.owner_id
          and revision.owner_id=new.owner_id
      ) then raise exception 'ai_job_input_invalid'; end if;
  else
    raise exception 'ai_job_input_invalid';
  end if;

  new.accepted_request:=new.input_payload;
  if new.execution_source='byok' then
    if new.managed_model_id is not null or new.user_connection_id is null or not exists (
      select 1 from public.user_ai_connections
      where id=new.user_connection_id and owner_id=new.owner_id and enabled
    ) then raise exception 'ai_connection_required'; end if;
  elsif new.execution_source='managed' then
    if new.user_connection_id is not null or new.managed_model_id is null then
      raise exception 'managed_ai_configuration_required';
    end if;
  else
    raise exception 'ai_job_input_invalid';
  end if;
  return new;
end;
$$;

drop trigger if exists ai_jobs_membership_guard on public.ai_jobs;
create trigger ai_jobs_membership_guard before insert or update on public.ai_jobs
for each row execute function public.guard_membership_ai_job();

revoke all on function public.guard_membership_ai_job() from public, anon, authenticated;
grant execute on function public.guard_membership_ai_job() to service_role;

create or replace function public.wavekb_schema_version()
returns text language sql stable as $$ select '202611240002'::text $$;

commit;
