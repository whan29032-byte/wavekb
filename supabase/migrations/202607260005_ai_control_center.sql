create table public.ai_providers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 2 and 80),
  adapter text not null check (adapter in ('openai_compatible', 'anthropic', 'gemini')),
  base_url text not null,
  enabled boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger ai_providers_touch_updated_at
before update on public.ai_providers
for each row execute function public.touch_updated_at();

create table public.ai_provider_secrets (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.ai_providers(id) on delete cascade,
  ciphertext text not null,
  iv text not null,
  auth_tag text not null,
  key_version integer not null default 1 check (key_version > 0),
  last_four text not null check (char_length(last_four) <= 4),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

create unique index ai_provider_secrets_one_active_idx
on public.ai_provider_secrets(provider_id) where active;

create table public.ai_models (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.ai_providers(id) on delete cascade,
  name text not null,
  label text not null,
  enabled boolean not null default true,
  max_output_tokens integer not null default 4096 check (max_output_tokens between 1 and 262144),
  context_tokens integer not null default 32768 check (context_tokens > 0),
  temperature numeric(3,2) not null default 0.20 check (temperature between 0 and 2),
  timeout_ms integer not null default 60000 check (timeout_ms between 1000 and 600000),
  input_cost_per_million numeric(16,6) not null default 0,
  output_cost_per_million numeric(16,6) not null default 0,
  capabilities jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_id, name)
);

create trigger ai_models_touch_updated_at
before update on public.ai_models
for each row execute function public.touch_updated_at();

create table public.ai_task_routes (
  id uuid primary key default gen_random_uuid(),
  task_type text not null unique,
  primary_model_id uuid not null references public.ai_models(id),
  fallback_model_ids uuid[] not null default '{}',
  retry_count integer not null default 1 check (retry_count between 0 and 5),
  daily_user_limit integer not null default 20 check (daily_user_limit >= 0),
  monthly_budget numeric(16,4) not null default 0 check (monthly_budget >= 0),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger ai_task_routes_touch_updated_at
before update on public.ai_task_routes
for each row execute function public.touch_updated_at();

create table public.ai_prompts (
  id uuid primary key default gen_random_uuid(),
  prompt_key text not null unique,
  label text not null,
  task_type text not null,
  active_test_version_id uuid,
  active_production_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger ai_prompts_touch_updated_at
before update on public.ai_prompts
for each row execute function public.touch_updated_at();

create table public.ai_prompt_versions (
  id uuid primary key default gen_random_uuid(),
  prompt_id uuid not null references public.ai_prompts(id) on delete cascade,
  version integer not null check (version > 0),
  content text not null,
  model_overrides jsonb not null default '{}'::jsonb,
  change_note text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (prompt_id, version)
);

alter table public.ai_prompts
  add constraint ai_prompts_test_version_fk
  foreign key (active_test_version_id) references public.ai_prompt_versions(id),
  add constraint ai_prompts_production_version_fk
  foreign key (active_production_version_id) references public.ai_prompt_versions(id);

create table public.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  analysis_id uuid references public.workbench_analyses(id) on delete cascade,
  task_type text not null,
  idempotency_key text not null unique,
  status text not null default 'queued'
    check (status in ('queued', 'waiting_retry', 'running', 'succeeded', 'failed', 'cancelled')),
  input_payload jsonb not null default '{}'::jsonb,
  output_payload jsonb,
  actual_model_id uuid references public.ai_models(id),
  prompt_version_ids uuid[] not null default '{}',
  knowledge_version text not null default 'ewp-10-zh-2016',
  error_code text,
  error_message text,
  available_at timestamptz not null default now(),
  worker_id text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ai_jobs_queue_idx
on public.ai_jobs(status, available_at, created_at);

create index ai_jobs_owner_idx
on public.ai_jobs(owner_id, created_at desc);

create trigger ai_jobs_touch_updated_at
before update on public.ai_jobs
for each row execute function public.touch_updated_at();

create table public.ai_job_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.ai_jobs(id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  model_id uuid references public.ai_models(id),
  status text not null check (status in ('running', 'succeeded', 'failed')),
  error_class text,
  provider_request_id text,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (job_id, attempt_number)
);

create table public.ai_usage_ledger (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.ai_jobs(id) on delete cascade,
  attempt_id uuid references public.ai_job_attempts(id) on delete set null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  model_id uuid references public.ai_models(id),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cost_amount numeric(16,6) not null default 0 check (cost_amount >= 0),
  cost_confirmed boolean not null default false,
  currency text not null default 'USD',
  created_at timestamptz not null default now()
);

create index ai_usage_owner_created_idx
on public.ai_usage_ledger(owner_id, created_at desc);

create table public.knowledge_retrievals (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.ai_jobs(id) on delete cascade,
  query text not null,
  task_type text not null,
  knowledge_ids text[] not null default '{}',
  source_ids text[] not null default '{}',
  token_budget integer not null default 0 check (token_budget >= 0),
  context_hash text not null,
  created_at timestamptz not null default now()
);

create table public.review_decisions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.ai_jobs(id) on delete set null,
  review_id uuid references public.workbench_reviews(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'draft'
    check (status in ('draft', 'ai_reviewed', 'human_approved', 'published_experience', 'rejected')),
  ai_summary jsonb not null default '{}'::jsonb,
  decision_reason text not null default '',
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  published_knowledge_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger review_decisions_touch_updated_at
before update on public.review_decisions
for each row execute function public.touch_updated_at();

alter table public.ai_providers enable row level security;
alter table public.ai_provider_secrets enable row level security;
alter table public.ai_models enable row level security;
alter table public.ai_task_routes enable row level security;
alter table public.ai_prompts enable row level security;
alter table public.ai_prompt_versions enable row level security;
alter table public.ai_jobs enable row level security;
alter table public.ai_job_attempts enable row level security;
alter table public.ai_usage_ledger enable row level security;
alter table public.knowledge_retrievals enable row level security;
alter table public.review_decisions enable row level security;

create policy "admins manage ai providers"
on public.ai_providers for all to authenticated
using (public.is_admin()) with check (public.is_admin());
create policy "admins manage ai models"
on public.ai_models for all to authenticated
using (public.is_admin()) with check (public.is_admin());
create policy "admins manage ai routes"
on public.ai_task_routes for all to authenticated
using (public.is_admin()) with check (public.is_admin());
create policy "admins manage ai prompts"
on public.ai_prompts for all to authenticated
using (public.is_admin()) with check (public.is_admin());
create policy "admins read prompt versions"
on public.ai_prompt_versions for select to authenticated
using (public.is_admin());
create policy "admins create prompt versions"
on public.ai_prompt_versions for insert to authenticated
with check (public.is_admin());

create policy "owners read ai jobs"
on public.ai_jobs for select to authenticated
using (owner_id = auth.uid() or public.is_admin());
create policy "owners create ai jobs"
on public.ai_jobs for insert to authenticated
with check (owner_id = auth.uid());
create policy "owners cancel queued ai jobs"
on public.ai_jobs for update to authenticated
using (owner_id = auth.uid() and status in ('queued', 'waiting_retry'))
with check (owner_id = auth.uid() and status = 'cancelled');

create policy "owners read ai attempts"
on public.ai_job_attempts for select to authenticated
using (
  exists (
    select 1 from public.ai_jobs
    where ai_jobs.id = ai_job_attempts.job_id
      and (ai_jobs.owner_id = auth.uid() or public.is_admin())
  )
);
create policy "owners read ai usage"
on public.ai_usage_ledger for select to authenticated
using (owner_id = auth.uid() or public.is_admin());
create policy "owners read knowledge retrievals"
on public.knowledge_retrievals for select to authenticated
using (
  exists (
    select 1 from public.ai_jobs
    where ai_jobs.id = knowledge_retrievals.job_id
      and (ai_jobs.owner_id = auth.uid() or public.is_admin())
  )
);
create policy "owners read review decisions"
on public.review_decisions for select to authenticated
using (owner_id = auth.uid() or public.is_admin());
create policy "admins manage review decisions"
on public.review_decisions for all to authenticated
using (public.is_admin()) with check (public.is_admin());

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
  where status in ('queued', 'waiting_retry')
    and available_at <= now()
  order by created_at
  for update skip locked
  limit 1;

  if claimed.id is null then
    return null;
  end if;

  update public.ai_jobs
  set status = 'running',
      worker_id = p_worker_id,
      started_at = now()
  where id = claimed.id
  returning * into claimed;
  return claimed;
end;
$$;

revoke all on function public.claim_ai_job(text) from public, anon, authenticated;
grant execute on function public.claim_ai_job(text) to service_role;
