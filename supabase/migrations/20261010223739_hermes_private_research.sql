begin;

-- This schema is deliberately NOT exposed through the browser's PostgREST schemas.
-- The public RPCs below are the sole HTTP surface, and require both the database
-- service role and a service-role JWT. Nothing here grants a member theory access.
create schema if not exists hermes_research_private;
revoke all on schema hermes_research_private from public, anon, authenticated;
grant usage on schema hermes_research_private to service_role;

create table hermes_research_private.artifacts (
  artifact_sha256 text primary key check (artifact_sha256 ~ '^[a-f0-9]{64}$'),
  schema_version text not null check (schema_version = 'hermes-private-theory-v2'),
  artifact jsonb not null check (jsonb_typeof(artifact) = 'object' and octet_length(artifact::text) <= 4194304),
  created_at timestamptz not null default now()
);
create table hermes_research_private.source_lineage (
  artifact_sha256 text not null references hermes_research_private.artifacts(artifact_sha256) on delete cascade,
  source_id text not null check (source_id ~ '^s_[a-f0-9]{32}$'),
  original_sha256 text not null check (original_sha256 ~ '^[a-f0-9]{64}$'),
  original_bytes integer not null check (original_bytes between 1 and 524288),
  original_version text not null check (original_version = 'sha256:' || original_sha256),
  curated_sha256 text not null check (curated_sha256 ~ '^[a-f0-9]{64}$'),
  curated_bytes integer not null check (curated_bytes between 1 and 524800),
  curated_version text not null check (curated_version = 'hermes-theory-curation-v1'),
  receipt jsonb not null check (jsonb_typeof(receipt) = 'object'
    and receipt->>'originalSha256' = original_sha256 and receipt->>'curatedSha256' = curated_sha256),
  primary key (artifact_sha256, source_id)
);
create table hermes_research_private.active_snapshot (
  singleton boolean primary key default true check (singleton),
  artifact_sha256 text not null references hermes_research_private.artifacts(artifact_sha256),
  revision integer not null check (revision > 0),
  activated_at timestamptz not null default now()
);
-- No initial active snapshot: deployment alone neither imports private files nor
-- turns on retrieval. Registration and explicit activation are separate actions.
create table hermes_research_private.retrieval_audits (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.ai_jobs(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  analysis_id uuid not null references public.workbench_analyses(id) on delete cascade,
  artifact_sha256 text not null references hermes_research_private.artifacts(artifact_sha256),
  chunk_ids text[] not null check (cardinality(chunk_ids) between 0 and 8),
  context_hash text not null check (context_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique (job_id, artifact_sha256, context_hash)
);
create index hermes_retrieval_owner_idx on hermes_research_private.retrieval_audits(owner_id);
create index hermes_retrieval_analysis_idx on hermes_research_private.retrieval_audits(analysis_id);
create index hermes_retrieval_artifact_idx on hermes_research_private.retrieval_audits(artifact_sha256);
create table hermes_research_private.learning_candidates (
  job_id uuid primary key references public.ai_jobs(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  analysis_id uuid not null references public.workbench_analyses(id) on delete cascade,
  knowledge_version text not null check (length(knowledge_version) between 1 and 128),
  output_payload jsonb not null check (jsonb_typeof(output_payload) = 'object' and octet_length(output_payload::text) <= 131072),
  status text not null default 'candidate' check (status = 'candidate'),
  created_at timestamptz not null default now()
);
create index hermes_candidate_owner_idx on hermes_research_private.learning_candidates(owner_id);
create index hermes_candidate_analysis_idx on hermes_research_private.learning_candidates(analysis_id);
create table hermes_research_private.candidate_reviews (
  request_id uuid primary key,
  job_id uuid not null references hermes_research_private.learning_candidates(job_id) on delete cascade,
  administrator_id uuid not null references public.profiles(id) on delete cascade,
  outcome text not null check (outcome in ('supported', 'rejected', 'inconclusive')),
  reason text not null check (length(btrim(reason)) between 1 and 1000),
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object' and octet_length(evidence::text) <= 32768),
  created_at timestamptz not null default now()
);
create index hermes_review_job_idx on hermes_research_private.candidate_reviews(job_id);
create index hermes_review_administrator_idx on hermes_research_private.candidate_reviews(administrator_id);

alter table hermes_research_private.artifacts enable row level security;
alter table hermes_research_private.artifacts force row level security;
alter table hermes_research_private.source_lineage enable row level security;
alter table hermes_research_private.source_lineage force row level security;
alter table hermes_research_private.active_snapshot enable row level security;
alter table hermes_research_private.active_snapshot force row level security;
alter table hermes_research_private.retrieval_audits enable row level security;
alter table hermes_research_private.retrieval_audits force row level security;
alter table hermes_research_private.learning_candidates enable row level security;
alter table hermes_research_private.learning_candidates force row level security;
alter table hermes_research_private.candidate_reviews enable row level security;
alter table hermes_research_private.candidate_reviews force row level security;
revoke all on all tables in schema hermes_research_private from public, anon, authenticated, service_role;
grant select, insert on hermes_research_private.artifacts, hermes_research_private.source_lineage,
  hermes_research_private.retrieval_audits, hermes_research_private.learning_candidates,
  hermes_research_private.candidate_reviews to service_role;
grant select, insert, update on hermes_research_private.active_snapshot to service_role;
alter default privileges in schema hermes_research_private revoke all on tables from public, anon, authenticated;
alter default privileges in schema hermes_research_private revoke execute on functions from public, anon, authenticated;

create function hermes_research_private.assert_service() returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if current_user <> 'service_role' or coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'hermes_research_service_required';
  end if;
end;
$$;

create function hermes_research_private.exact_keys(value jsonb, expected text[]) returns boolean
language sql immutable security invoker set search_path = '' as $$
  select case when jsonb_typeof(value) <> 'object' or value is null then false else
    (select array_agg(key order by key collate "C") from jsonb_object_keys(value) key)
      = (select array_agg(key order by key collate "C") from unnest(expected) key) end;
$$;
create function hermes_research_private.canonical_json(value jsonb) returns text
language plpgsql immutable strict security invoker set search_path = '' as $$
declare result text;
begin
  if jsonb_typeof(value) = 'object' then
    select '{' || coalesce(string_agg(to_jsonb(key)::text || ':' || hermes_research_private.canonical_json(val), ',' order by key collate "C"), '') || '}'
      into result from jsonb_each(value) as fields(key, val);
  elsif jsonb_typeof(value) = 'array' then
    select '[' || coalesce(string_agg(hermes_research_private.canonical_json(val), ',' order by ordinal), '') || ']'
      into result from jsonb_array_elements(value) with ordinality as items(val, ordinal);
  else result := value::text;
  end if;
  return result;
end;
$$;
create function hermes_research_private.digest_json(value jsonb) returns text
language sql immutable strict security invoker set search_path = '' as $$
  select encode(sha256(convert_to(hermes_research_private.canonical_json(value), 'UTF8')), 'hex');
$$;

create function public.hermes_research_register_artifact(p_artifact jsonb, p_expected_sha256 text) returns text
language plpgsql security invoker set search_path = '' as $$
declare
  source jsonb; original jsonb; curated jsonb; receipt jsonb; counts jsonb; chunk jsonb;
  existing jsonb; previous_index integer; original_total bigint := 0; i integer := 0;
  source_paths text[] := array['source-pages-001-070','source-pages-071-140','source-pages-141-210','source-pages-211-280','updated-rules-and-examples','practical-courses-01-17-distilled','chanlun-trading-system','cross-market-sync','wave-chanlun-integration'];
  source_labels text[] := array['book-distillation-001','book-distillation-002','book-distillation-003','book-distillation-004','rule-supplement','course-distillation','structure-context','market-context','integration-context'];
  source_ids text[] := '{}'; chunk_ids text[] := '{}'; joined_text text; n integer;
begin
  perform hermes_research_private.assert_service();
  if p_expected_sha256 is null or p_expected_sha256 !~ '^[a-f0-9]{64}$'
    or not hermes_research_private.exact_keys(p_artifact, array['schemaVersion','classification','authority','curationVersion','privateSourceTerms','sources','chunks','artifactSha256'])
    or p_artifact->>'schemaVersion' <> 'hermes-private-theory-v2' or p_artifact->>'classification' <> 'server-private'
    or p_artifact->>'authority' <> 'supplement' or p_artifact->>'curationVersion' <> 'hermes-theory-curation-v1'
    or p_artifact->>'artifactSha256' <> p_expected_sha256 or octet_length(p_artifact::text) > 4194304
    or jsonb_path_exists(p_artifact, '$.** ? (@ == null)')
    or jsonb_typeof(p_artifact->'sources') <> 'array' or jsonb_array_length(p_artifact->'sources') <> 9
    or jsonb_typeof(p_artifact->'chunks') <> 'array' or jsonb_array_length(p_artifact->'chunks') not between 9 and 1024
    or jsonb_typeof(p_artifact->'privateSourceTerms') <> 'array' or jsonb_array_length(p_artifact->'privateSourceTerms') > 128 then
    raise exception 'hermes_research_artifact_invalid';
  end if;
  if exists(select 1 from jsonb_array_elements(p_artifact->'privateSourceTerms') term
    where jsonb_typeof(term) <> 'string' or length(term#>>'{}') not between 1 and 256)
    or (select count(distinct term) <> count(*) from jsonb_array_elements(p_artifact->'privateSourceTerms') term) then
    raise exception 'hermes_research_artifact_invalid';
  end if;
  for source in select value from jsonb_array_elements(p_artifact->'sources') loop
    i := i + 1; original := source->'original'; curated := source->'curated'; receipt := source->'receipt'; counts := receipt->'counts';
    if not hermes_research_private.exact_keys(source, array['id','relativePath','sourceLabel','authority','original','curated','receipt'])
      or not hermes_research_private.exact_keys(original, array['sha256','bytes','version'])
      or not hermes_research_private.exact_keys(curated, array['sha256','bytes','version'])
      or not hermes_research_private.exact_keys(receipt, array['schemaVersion','originalSha256','curatedSha256','transformSha256','counts'])
      or not hermes_research_private.exact_keys(counts, array['imagesOmitted','referenceLinesOmitted','referenceMentionsReplaced','titleMentionsReplaced','newlinesNormalized','noticeAdded'])
      or source->>'relativePath' <> 'references/' || source_paths[i] || '.md' or source->>'sourceLabel' <> source_labels[i]
      or source->>'authority' <> 'supplement' or coalesce(original->>'sha256','') !~ '^[a-f0-9]{64}$'
      or coalesce(curated->>'sha256','') !~ '^[a-f0-9]{64}$' or original->>'version' <> 'sha256:' || (original->>'sha256')
      or curated->>'version' <> 'hermes-theory-curation-v1' or jsonb_typeof(original->'bytes') <> 'number' or jsonb_typeof(curated->'bytes') <> 'number'
      or coalesce(original->>'bytes','') !~ '^[1-9][0-9]{0,5}$'
      or coalesce(curated->>'bytes','') !~ '^[1-9][0-9]{0,5}$' or (original->>'bytes')::int > 524288 or (curated->>'bytes')::int > 524800
      or receipt->>'schemaVersion' <> 'hermes-theory-curation-receipt-v1'
      or receipt->>'originalSha256' <> original->>'sha256' or receipt->>'curatedSha256' <> curated->>'sha256'
      or coalesce(receipt->>'transformSha256','') !~ '^[a-f0-9]{64}$'
      or exists(select 1 from jsonb_each(counts) as count_item(key, val) where jsonb_typeof(val) <> 'number' or val::text !~ '^(0|[1-9][0-9]{0,5})$' or val::text::int > 100000)
      or counts->>'noticeAdded' <> '1' then raise exception 'hermes_research_artifact_invalid'; end if;
    if source->>'id' <> 's_' || substr(encode(sha256(convert_to(source->>'relativePath','UTF8') || decode('00','hex') || convert_to(original->>'sha256','UTF8')),'hex'),1,32)
      or source->>'id' = any(source_ids)
      or receipt->>'transformSha256' <> hermes_research_private.digest_json(receipt - 'transformSha256') then
      raise exception 'hermes_research_artifact_invalid';
    end if;
    source_ids := array_append(source_ids, source->>'id'); original_total := original_total + (original->>'bytes')::int;
    previous_index := -1; joined_text := '';
    for chunk in select value from jsonb_array_elements(p_artifact->'chunks') where value->>'sourceId' = source->>'id' loop
      if not hermes_research_private.exact_keys(chunk, array['id','sourceId','index','text','sha256','authority'])
        or chunk->>'authority' <> 'supplement' or jsonb_typeof(chunk->'index') <> 'number'
        or coalesce(chunk->>'index','') !~ '^(0|[1-9][0-9]{0,3})$' or (chunk->>'index')::int <> previous_index + 1
        or jsonb_typeof(chunk->'text') <> 'string' or length(chunk->>'text') not between 1 and 2000
        or length(btrim(chunk->>'text')) = 0 or coalesce(chunk->>'sha256','') !~ '^[a-f0-9]{64}$'
        or chunk->>'sha256' <> encode(sha256(convert_to(chunk->>'text','UTF8')),'hex') then
        raise exception 'hermes_research_artifact_invalid';
      end if;
      if chunk->>'id' <> 'h_' || substr(encode(sha256(convert_to(chunk->>'sourceId','UTF8') || decode('00','hex') || convert_to(chunk->>'index','UTF8') || decode('00','hex') || convert_to(chunk->>'text','UTF8')),'hex'),1,32)
        or chunk->>'id' = any(chunk_ids) then raise exception 'hermes_research_artifact_invalid'; end if;
      previous_index := (chunk->>'index')::int; chunk_ids := array_append(chunk_ids, chunk->>'id'); joined_text := joined_text || (chunk->>'text');
    end loop;
    if previous_index < 0 or not starts_with(joined_text,E'本段为补充理论资料；不得覆盖网站第十一版原书规则。未载入的图片不构成已验证证据。\n\n')
      or octet_length(joined_text) <> (curated->>'bytes')::int
      or encode(sha256(convert_to(joined_text,'UTF8')),'hex') <> curated->>'sha256' then raise exception 'hermes_research_artifact_invalid'; end if;
  end loop;
  if original_total > 2097152 or cardinality(chunk_ids) <> jsonb_array_length(p_artifact->'chunks')
    or hermes_research_private.digest_json(p_artifact - 'artifactSha256') <> p_expected_sha256 then
    raise exception 'hermes_research_artifact_invalid';
  end if;
  insert into hermes_research_private.artifacts(artifact_sha256,schema_version,artifact)
    values(p_expected_sha256,'hermes-private-theory-v2',p_artifact) on conflict do nothing;
  select artifact into existing from hermes_research_private.artifacts where artifact_sha256 = p_expected_sha256;
  if existing is distinct from p_artifact then raise exception 'hermes_research_artifact_conflict'; end if;
  for source in select value from jsonb_array_elements(p_artifact->'sources') loop
    insert into hermes_research_private.source_lineage values(p_expected_sha256,source->>'id',source->'original'->>'sha256',
      (source->'original'->>'bytes')::int,source->'original'->>'version',source->'curated'->>'sha256',(source->'curated'->>'bytes')::int,
      source->'curated'->>'version',source->'receipt') on conflict do nothing;
  end loop;
  return p_expected_sha256;
end;
$$;

create function public.hermes_research_activate_artifact(p_artifact_sha256 text, p_expected_revision integer default 0) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare snapshot hermes_research_private.active_snapshot;
begin
  perform hermes_research_private.assert_service();
  if p_artifact_sha256 is null or p_expected_revision is null or p_expected_revision < 0
    or not exists(select 1 from hermes_research_private.artifacts where artifact_sha256 = p_artifact_sha256) then
    raise exception 'hermes_research_artifact_missing'; end if;
  -- Serialize even the first activation, when the singleton row does not exist.
  perform pg_advisory_xact_lock(6081037);
  select * into snapshot from hermes_research_private.active_snapshot where singleton for update;
  if coalesce(snapshot.revision,0) <> p_expected_revision then raise exception 'hermes_research_revision_conflict'; end if;
  insert into hermes_research_private.active_snapshot(singleton,artifact_sha256,revision)
    values(true,p_artifact_sha256,p_expected_revision+1)
    on conflict(singleton) do update set artifact_sha256 = excluded.artifact_sha256, revision = excluded.revision, activated_at = now();
  return jsonb_build_object('artifact_sha256',p_artifact_sha256,'revision',p_expected_revision+1);
end;
$$;
create function public.hermes_research_load_active_artifact() returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb;
begin
  perform hermes_research_private.assert_service();
  select jsonb_build_object('artifact',a.artifact,'expected_sha256',a.artifact_sha256) into result
    from hermes_research_private.active_snapshot s join hermes_research_private.artifacts a using(artifact_sha256) where s.singleton;
  return result;
end;
$$;

create function public.hermes_research_record_retrieval(p_job_id uuid, p_artifact_sha256 text, p_chunk_ids text[], p_context_hash text) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare job public.ai_jobs; payload jsonb; audit hermes_research_private.retrieval_audits;
begin
  perform hermes_research_private.assert_service();
  select j.* into job from public.ai_jobs j join public.workbench_analyses a on a.id=j.analysis_id and a.owner_id=j.owner_id
    where j.id=p_job_id and j.task_type='wave_analysis' and j.status in ('running','succeeded') for share of j,a;
  if not found then raise exception 'hermes_research_job_invalid'; end if;
  select artifact into payload from hermes_research_private.artifacts where artifact_sha256=p_artifact_sha256;
  if not found or p_context_hash is null or p_context_hash !~ '^[a-f0-9]{64}$' or p_chunk_ids is null
    or cardinality(p_chunk_ids) not between 0 and 8 or (cardinality(p_chunk_ids)>0 and array_ndims(p_chunk_ids) <> 1)
    or exists(select 1 from unnest(p_chunk_ids) id where id is null or id !~ '^h_[a-f0-9]{32}$'
      or not exists(select 1 from jsonb_array_elements(payload->'chunks') chunk where chunk->>'id'=id))
    or (select count(distinct id) <> count(*) from unnest(p_chunk_ids) id) then raise exception 'hermes_research_retrieval_invalid'; end if;
  insert into hermes_research_private.retrieval_audits(job_id,owner_id,analysis_id,artifact_sha256,chunk_ids,context_hash)
    values(job.id,job.owner_id,job.analysis_id,p_artifact_sha256,p_chunk_ids,p_context_hash) on conflict do nothing;
  select * into audit from hermes_research_private.retrieval_audits where job_id=job.id and artifact_sha256=p_artifact_sha256 and context_hash=p_context_hash;
  if audit.chunk_ids is distinct from p_chunk_ids or audit.owner_id <> job.owner_id or audit.analysis_id <> job.analysis_id then raise exception 'hermes_research_retrieval_conflict'; end if;
  return audit.id;
end;
$$;

create function hermes_research_private.is_candidate_output(value jsonb) returns boolean
language plpgsql immutable security invoker set search_path = '' as $$
declare key text;
begin
  if value is null or jsonb_typeof(value) <> 'object' or octet_length(value::text)>131072
    or value->>'schema_version' is distinct from 'wavekb-public-analysis-v1'
    or coalesce(value->>'source_visibility','') not in ('public_books','private_research')
    or value ? 'status' or value ? 'reason' then return false; end if;
  for key in select jsonb_object_keys(value) loop
    if not key=any(array['schema_version','source_visibility','knowledge_version','scope','instrument','timeframe','analysis_level','parent_trend','current_pattern','current_subwave',
      'valid_scenarios','eliminated_scenarios','unknown_fields','risk','knowledge_citations','citations','analysis_basis','wave_chart']) then return false; end if;
  end loop;
  if jsonb_typeof(value->'citations') is distinct from 'array' or jsonb_typeof(value->'knowledge_citations') is distinct from 'array'
    or jsonb_typeof(value->'analysis_basis') is distinct from 'array' or jsonb_typeof(value->'valid_scenarios') is distinct from 'array'
    or jsonb_typeof(value->'eliminated_scenarios') is distinct from 'array' or jsonb_typeof(value->'unknown_fields') is distinct from 'array'
    or jsonb_typeof(value->'instrument') is distinct from 'string' or jsonb_typeof(value->'timeframe') is distinct from 'string'
    or jsonb_typeof(value->'analysis_level') is distinct from 'string' or jsonb_typeof(value->'parent_trend') is distinct from 'string'
    or jsonb_typeof(value->'current_pattern') is distinct from 'string' or jsonb_typeof(value->'current_subwave') is distinct from 'string' then return false; end if;
  if value->>'source_visibility'='private_research' and (jsonb_array_length(value->'citations')>0 or jsonb_array_length(value->'knowledge_citations')>0) then return false; end if;
  return true;
end;
$$;
create function public.hermes_research_record_candidate(p_job_id uuid, p_output jsonb, p_knowledge_version text) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare job public.ai_jobs; candidate hermes_research_private.learning_candidates;
begin
  perform hermes_research_private.assert_service();
  select j.* into job from public.ai_jobs j join public.workbench_analyses a on a.id=j.analysis_id and a.owner_id=j.owner_id
    where j.id=p_job_id and j.task_type='wave_analysis' and j.status='succeeded' for share of j,a;
  if not found then raise exception 'hermes_research_job_invalid'; end if;
  if p_output is distinct from job.output_payload or p_knowledge_version is distinct from job.knowledge_version
    or p_knowledge_version is null or length(p_knowledge_version) not between 1 and 128
    or not hermes_research_private.is_candidate_output(p_output) then raise exception 'hermes_research_candidate_invalid'; end if;
  insert into hermes_research_private.learning_candidates(job_id,owner_id,analysis_id,knowledge_version,output_payload)
    values(job.id,job.owner_id,job.analysis_id,job.knowledge_version,job.output_payload) on conflict do nothing;
  select * into candidate from hermes_research_private.learning_candidates where job_id=job.id;
  if candidate.owner_id<>job.owner_id or candidate.analysis_id<>job.analysis_id or candidate.knowledge_version<>job.knowledge_version
    or candidate.output_payload is distinct from job.output_payload then raise exception 'hermes_research_candidate_conflict'; end if;
  return candidate.job_id;
end;
$$;
create function hermes_research_private.capture_candidate_success() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  -- Browser-originated historical updates must not gain private write privileges
  -- and must not be broken by a trigger trying to read private tables.
  if current_user <> 'service_role' or coalesce(auth.jwt()->>'role','') <> 'service_role' then return new; end if;
  if new.task_type='wave_analysis' and new.status='succeeded'
    and hermes_research_private.is_candidate_output(new.output_payload) then
    perform public.hermes_research_record_candidate(new.id,new.output_payload,new.knowledge_version);
  end if;
  return new;
end;
$$;
create trigger hermes_capture_candidate_success after insert or update of status, output_payload, knowledge_version
  on public.ai_jobs for each row execute function hermes_research_private.capture_candidate_success();

create function public.hermes_research_review_candidate(p_request_id uuid, p_job_id uuid, p_administrator_id uuid,
  p_outcome text, p_reason text, p_evidence jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare review hermes_research_private.candidate_reviews;
begin
  perform hermes_research_private.assert_service();
  if p_request_id is null or p_administrator_id is null or not exists(select 1 from public.profiles where id=p_administrator_id and role='admin' and account_status='active') then
    raise exception 'hermes_research_administrator_required'; end if;
  if p_outcome is null or p_outcome not in ('supported','rejected','inconclusive') or p_reason is null or length(btrim(p_reason)) not between 1 and 1000
    or p_evidence is null or jsonb_typeof(p_evidence)<>'object' or octet_length(p_evidence::text)>32768
    or not exists(select 1 from hermes_research_private.learning_candidates where job_id=p_job_id) then raise exception 'hermes_research_review_invalid'; end if;
  insert into hermes_research_private.candidate_reviews(request_id,job_id,administrator_id,outcome,reason,evidence)
    values(p_request_id,p_job_id,p_administrator_id,p_outcome,btrim(p_reason),p_evidence) on conflict do nothing;
  select * into review from hermes_research_private.candidate_reviews where request_id=p_request_id;
  if review.job_id is distinct from p_job_id or review.administrator_id is distinct from p_administrator_id or review.outcome is distinct from p_outcome
    or review.reason is distinct from btrim(p_reason) or review.evidence is distinct from p_evidence then raise exception 'hermes_research_review_conflict'; end if;
  -- A supported review remains an audit event; it cannot promote a candidate,
  -- edit an original book, or change the active retrieval snapshot.
  return review.request_id;
end;
$$;

revoke all on all functions in schema hermes_research_private from public, anon, authenticated, service_role;
grant execute on all functions in schema hermes_research_private to service_role;
revoke all on function public.hermes_research_register_artifact(jsonb,text), public.hermes_research_activate_artifact(text,integer),
  public.hermes_research_load_active_artifact(), public.hermes_research_record_retrieval(uuid,text,text[],text),
  public.hermes_research_record_candidate(uuid,jsonb,text), public.hermes_research_review_candidate(uuid,uuid,uuid,text,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.hermes_research_register_artifact(jsonb,text), public.hermes_research_activate_artifact(text,integer),
  public.hermes_research_load_active_artifact(), public.hermes_research_record_retrieval(uuid,text,text[],text),
  public.hermes_research_record_candidate(uuid,jsonb,text), public.hermes_research_review_candidate(uuid,uuid,uuid,text,text,jsonb) to service_role;

create or replace function public.wavekb_schema_version() returns text
language sql stable security invoker set search_path = '' as $$ select '20261010223739'; $$;
revoke all on function public.wavekb_schema_version() from public, anon, authenticated, service_role;
grant execute on function public.wavekb_schema_version() to anon, authenticated, service_role;
notify pgrst, 'reload schema';
commit;
