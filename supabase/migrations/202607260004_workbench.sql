create table public.workbench_analyses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  schema_version text not null default 'workbench-v1',
  input_source text not null default 'manual'
    check (input_source in ('manual', 'image_recognition', 'market_api')),
  instrument text not null check (char_length(instrument) between 1 and 80),
  market text not null default '' check (char_length(market) <= 80),
  primary_timeframe text not null,
  parent_timeframe text not null,
  child_timeframe text not null,
  holding_style text not null,
  step_data jsonb not null default '{}'::jsonb,
  rule_result jsonb not null default '{}'::jsonb,
  score_result jsonb not null default '{}'::jsonb,
  risk_result jsonb not null default '{}'::jsonb,
  execution_status text not null default 'draft'
    check (execution_status in ('draft', 'waiting', 'ready', 'executed', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workbench_analyses_owner_updated_idx
on public.workbench_analyses(owner_id, updated_at desc);

create trigger workbench_analyses_touch_updated_at
before update on public.workbench_analyses
for each row execute function public.touch_updated_at();

create table public.workbench_scenarios (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.workbench_analyses(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  scenario_key text not null check (scenario_key in ('primary', 'alternative_a', 'alternative_b')),
  pattern text not null,
  current_wave text not null default '',
  structure_data jsonb not null default '{}'::jsonb,
  conditions jsonb not null default '[]'::jsonb,
  confirmations jsonb not null default '[]'::jsonb,
  invalidations jsonb not null default '[]'::jsonb,
  target_zone jsonb not null default '{}'::jsonb,
  rule_status text not null default 'unknown'
    check (rule_status in ('valid', 'eliminated', 'unknown')),
  score_result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (analysis_id, scenario_key)
);

create trigger workbench_scenarios_touch_updated_at
before update on public.workbench_scenarios
for each row execute function public.touch_updated_at();

create table public.workbench_reviews (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null unique
    references public.workbench_analyses(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  analysis_snapshot jsonb not null,
  actual_result jsonb not null default '{}'::jsonb,
  final_pattern text not null default '',
  error_category text not null default ''
    check (error_category in ('', 'counting', 'execution', 'risk', 'discipline', 'data')),
  rule_violation_ids text[] not null default '{}',
  discipline_notes text not null default '',
  lessons text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger workbench_reviews_touch_updated_at
before update on public.workbench_reviews
for each row execute function public.touch_updated_at();

alter table public.workbench_analyses enable row level security;
alter table public.workbench_scenarios enable row level security;
alter table public.workbench_reviews enable row level security;

create policy "owners read workbench analyses"
on public.workbench_analyses for select to authenticated
using (owner_id = auth.uid());
create policy "owners create workbench analyses"
on public.workbench_analyses for insert to authenticated
with check (owner_id = auth.uid());
create policy "owners update workbench analyses"
on public.workbench_analyses for update to authenticated
using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owners delete workbench analyses"
on public.workbench_analyses for delete to authenticated
using (owner_id = auth.uid());

create policy "owners read workbench scenarios"
on public.workbench_scenarios for select to authenticated
using (owner_id = auth.uid());
create policy "owners create workbench scenarios"
on public.workbench_scenarios for insert to authenticated
with check (owner_id = auth.uid());
create policy "owners update workbench scenarios"
on public.workbench_scenarios for update to authenticated
using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owners delete workbench scenarios"
on public.workbench_scenarios for delete to authenticated
using (owner_id = auth.uid());

create policy "owners read workbench reviews"
on public.workbench_reviews for select to authenticated
using (owner_id = auth.uid());
create policy "owners create workbench reviews"
on public.workbench_reviews for insert to authenticated
with check (owner_id = auth.uid());
create policy "owners update workbench reviews"
on public.workbench_reviews for update to authenticated
using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owners delete workbench reviews"
on public.workbench_reviews for delete to authenticated
using (owner_id = auth.uid());
