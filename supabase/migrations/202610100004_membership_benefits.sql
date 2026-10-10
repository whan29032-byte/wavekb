begin;

-- Platform-funded jobs are distinct from BYOK. Existing jobs remain BYOK and
-- never consume membership allowance. Only the service can choose the source.
alter table public.ai_jobs
  add column execution_source text not null default 'byok' check (execution_source in ('byok','managed')),
  add column managed_model_id uuid references public.ai_models(id),
  add column accepted_request jsonb;

create table public.membership_ai_reservations (
  accepted_job_id uuid primary key,
  job_id uuid unique references public.ai_jobs(id) on delete set null,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  usage_day date not null,
  status text not null default 'reserved' check (status in ('reserved','released')),
  reserved_at timestamptz not null default now(),
  released_at timestamptz,
  check (job_id is null or job_id=accepted_job_id),
  check ((status='reserved' and released_at is null) or (status='released' and released_at is not null))
);
create index membership_ai_reservations_owner_day on public.membership_ai_reservations(owner_id,usage_day,status);
alter table public.membership_ai_reservations enable row level security;
revoke all on public.membership_ai_reservations from public,anon,authenticated;
grant select on public.membership_ai_reservations to service_role;

create function public.membership_ai_usage(p_user_id uuid)
returns jsonb language sql volatile security definer set search_path='' as $$
  with entitlement as (select public.membership_effective_entitlements(p_user_id) as value),
    used as (select count(*)::integer as value from public.membership_ai_reservations
      where owner_id=p_user_id and usage_day=(now() at time zone 'Asia/Shanghai')::date and status='reserved')
  select jsonb_build_object('user_id',p_user_id,'usage_day',(now() at time zone 'Asia/Shanghai')::date,
    'timezone','Asia/Shanghai','has_vip',(e.value->>'has_vip')::boolean,
    'daily_limit',case when (e.value->>'has_vip')::boolean then (e.value->>'ai_daily_limit')::integer else 0 end,
    'used',u.value,'remaining',greatest(0,case when (e.value->>'has_vip')::boolean then (e.value->>'ai_daily_limit')::integer else 0 end-u.value))
  from entitlement e cross join used u;
$$;
create function public.get_my_membership_ai_usage(p_actor_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if p_actor_id is null or p_actor_id is distinct from auth.uid() then raise exception 'authentication_required'; end if;
  return public.membership_ai_usage(p_actor_id);
end;
$$;
create function public.get_membership_ai_usage_for_user(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if p_user_id is null then raise exception 'membership_input_invalid'; end if;
  return public.membership_ai_usage(p_user_id);
end;
$$;

create function public.guard_membership_ai_job()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' then
    if row(new.owner_id,new.analysis_id,new.task_type,new.idempotency_key,new.execution_source,
      new.managed_model_id,new.accepted_request,new.created_at)
      is distinct from row(old.owner_id,old.analysis_id,old.task_type,old.idempotency_key,old.execution_source,
      old.managed_model_id,old.accepted_request,old.created_at) then
      raise exception 'ai_job_identity_immutable';
    end if;
    if new.user_connection_id is distinct from old.user_connection_id and new.user_connection_id is not null then
      raise exception 'ai_job_identity_immutable';
    end if;
    if old.execution_source='managed' and old.status in ('failed','cancelled','succeeded')
      and new.status is distinct from old.status then raise exception 'ai_job_terminal'; end if;
    return new;
  end if;
  if new.status<>'queued' or new.analysis_id is null or not exists (
    select 1 from public.workbench_analyses where id=new.analysis_id and owner_id=new.owner_id
  ) then raise exception 'ai_job_input_invalid'; end if;
  new.accepted_request:=new.input_payload;
  if new.execution_source='byok' then
    if new.managed_model_id is not null or new.user_connection_id is null or not exists (
      select 1 from public.user_ai_connections where id=new.user_connection_id and owner_id=new.owner_id and enabled
    ) then raise exception 'ai_connection_required'; end if;
  elsif new.user_connection_id is not null or new.managed_model_id is null then
    raise exception 'managed_ai_configuration_required';
  end if;
  return new;
end;
$$;
create trigger ai_jobs_membership_guard before insert or update on public.ai_jobs
for each row execute function public.guard_membership_ai_job();

-- AFTER INSERT permits the reservation FK to bind the accepted job. A quota
-- failure rolls back both rows; every insert path (including REST) hits it.
create function public.reserve_membership_ai_job()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_usage jsonb; v_day date:=(now() at time zone 'Asia/Shanghai')::date;
begin
  if new.execution_source<>'managed' then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('membership_ai:'||new.owner_id::text||':'||v_day::text,0));
  v_usage:=public.membership_ai_usage(new.owner_id);
  if not coalesce((v_usage->>'has_vip')::boolean,false) or (v_usage->>'daily_limit')::integer<=0 then
    raise exception 'membership_ai_vip_required';
  end if;
  if (v_usage->>'remaining')::integer<=0 then raise exception 'membership_ai_quota_exceeded'; end if;
  if not exists(select 1 from public.ai_task_routes r join public.ai_models m on m.id=r.primary_model_id
      join public.ai_providers p on p.id=m.provider_id
      where r.task_type=new.task_type and r.enabled and m.id=new.managed_model_id and m.enabled and p.enabled
      and exists(select 1 from public.ai_provider_secrets s where s.provider_id=p.id and s.active)) then
    raise exception 'managed_ai_configuration_required';
  end if;
  -- Deleting an analysis/job must not reset the accepted-job allowance. Keep a
  -- tombstone ID when the FK is detached; the daily audit row is never cascaded.
  insert into public.membership_ai_reservations(accepted_job_id,job_id,owner_id,usage_day) values(new.id,new.id,new.owner_id,v_day);
  return new;
end;
$$;
create trigger ai_jobs_membership_reserve after insert on public.ai_jobs
for each row execute function public.reserve_membership_ai_job();

-- Only a server-recorded terminal failure is refundable. Waiting retries,
-- cancellations, successful analysis and browser assertions never refund.
create function public.release_failed_membership_ai_job(p_job_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_job public.ai_jobs%rowtype; v_changed integer;
begin
  select * into v_job from public.ai_jobs where id=p_job_id for update;
  if v_job.id is null or v_job.execution_source<>'managed' or v_job.status<>'failed' or v_job.finished_at is null then
    raise exception 'ai_job_failure_not_confirmed';
  end if;
  update public.membership_ai_reservations set status='released',released_at=now()
    where job_id=p_job_id and status='reserved';
  get diagnostics v_changed=row_count;
  return v_changed=1;
end;
$$;
create function public.refund_failed_membership_ai_job()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.execution_source='managed' and new.status='failed' and new.finished_at is not null then
    perform public.release_failed_membership_ai_job(new.id);
  end if;
  return new;
end;
$$;
create trigger ai_jobs_membership_failure_refund after update on public.ai_jobs
for each row execute function public.refund_failed_membership_ai_job();

create function public.enqueue_membership_ai_job(p_owner_id uuid,p_analysis_id uuid,p_idempotency_key text,
  p_task_type text,p_input_payload jsonb,p_knowledge_version text,p_execution_source text,
  p_user_connection_id uuid default null,p_managed_model_id uuid default null,p_connection_snapshot jsonb default '{}'::jsonb)
returns public.ai_jobs language plpgsql security definer set search_path='' as $$
declare v_job public.ai_jobs%rowtype;
begin
  if p_owner_id is null or p_analysis_id is null or p_idempotency_key is null or length(p_idempotency_key)>200
    or p_task_type is distinct from 'wave_analysis' or p_execution_source is null or p_execution_source not in ('byok','managed')
    or p_input_payload is null or jsonb_typeof(p_input_payload)<>'object'
    or not public.membership_user_is_eligible(p_owner_id) then raise exception 'ai_job_input_invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ai_request:'||p_idempotency_key,0));
  select * into v_job from public.ai_jobs where idempotency_key=p_idempotency_key for update;
  if v_job.id is not null then
    if v_job.owner_id<>p_owner_id or v_job.analysis_id<>p_analysis_id or v_job.task_type<>p_task_type
      or v_job.execution_source<>p_execution_source or coalesce(v_job.accepted_request,v_job.input_payload) is distinct from p_input_payload
      then raise exception 'ai_request_conflict'; end if;
    return v_job;
  end if;
  insert into public.ai_jobs(owner_id,analysis_id,idempotency_key,task_type,input_payload,knowledge_version,
    execution_source,user_connection_id,managed_model_id,connection_snapshot)
    values(p_owner_id,p_analysis_id,p_idempotency_key,p_task_type,p_input_payload,p_knowledge_version,
      p_execution_source,p_user_connection_id,p_managed_model_id,p_connection_snapshot) returning * into v_job;
  return v_job;
end;
$$;
create function public.authorize_membership_ai_job(p_job_id uuid,p_owner_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_rights jsonb;
begin
  if not exists(select 1 from public.ai_jobs j join public.membership_ai_reservations r on r.job_id=j.id
    where j.id=p_job_id and j.owner_id=p_owner_id and j.execution_source='managed' and j.status='running'
      and r.owner_id=p_owner_id and r.status='reserved') then raise exception 'membership_ai_job_invalid'; end if;
  v_rights:=public.membership_effective_entitlements(p_owner_id);
  if not coalesce((v_rights->>'has_vip')::boolean,false) or (v_rights->>'ai_daily_limit')::integer<=0
    then raise exception 'membership_ai_vip_required'; end if;
  return true;
end;
$$;
revoke insert,update on public.ai_jobs from authenticated;
grant insert(owner_id,analysis_id,task_type,idempotency_key,input_payload,user_connection_id,connection_snapshot,knowledge_version)
  on public.ai_jobs to authenticated;
grant update(status) on public.ai_jobs to authenticated;
drop policy if exists "owners cancel queued ai jobs" on public.ai_jobs;
create policy "owners cancel queued ai jobs" on public.ai_jobs for update to authenticated
  using (owner_id=auth.uid() and status in ('queued','waiting_retry'))
  with check (owner_id=auth.uid() and status='cancelled');
revoke all on function public.membership_ai_usage(uuid),public.guard_membership_ai_job(),public.reserve_membership_ai_job(),
  public.refund_failed_membership_ai_job(),public.release_failed_membership_ai_job(uuid),
  public.get_my_membership_ai_usage(uuid),public.get_membership_ai_usage_for_user(uuid),public.authorize_membership_ai_job(uuid,uuid),
  public.enqueue_membership_ai_job(uuid,uuid,text,text,jsonb,text,text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.get_my_membership_ai_usage(uuid) to authenticated;
grant execute on function public.get_membership_ai_usage_for_user(uuid),public.release_failed_membership_ai_job(uuid),
  public.enqueue_membership_ai_job(uuid,uuid,text,text,jsonb,text,text,uuid,uuid,jsonb),public.authorize_membership_ai_job(uuid,uuid) to service_role;

-- Original mentor price and membership discount are sealed on NEW orders only.
alter table public.mentor_orders
  add column base_price_cents_snapshot integer check (base_price_cents_snapshot>0),
  add column discount_bps_snapshot integer check (discount_bps_snapshot between 0 and 10000);
create function public.membership_mentor_offer_quote(p_user_id uuid,p_offer_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_offer public.mentor_offers%rowtype; v_rights jsonb; v_bps integer; v_price integer;
begin
  select * into v_offer from public.mentor_offers where id=p_offer_id;
  if v_offer.id is null or not v_offer.active or not exists(select 1 from public.mentor_profiles
    where id=v_offer.mentor_id and active and owner_id is not null and owner_id<>p_user_id) then raise exception 'offer_unavailable'; end if;
  v_rights:=public.membership_effective_entitlements(p_user_id);
  if not coalesce((v_rights->>'eligible')::boolean,false) then raise exception 'account_ineligible'; end if;
  v_bps:=case when (v_rights->>'has_vip')::boolean then (v_rights->>'mentor_discount_bps')::integer else 0 end;
  -- Do not disguise a zero-price promotion as a one-cent payment. Free mentor
  -- checkout requires its own explicit flow; paid orders stay strictly positive.
  v_price:=round(v_offer.price_cents::numeric*(10000-v_bps)/10000)::integer;
  if v_price<=0 then raise exception 'mentor_discount_free_checkout_unsupported'; end if;
  return jsonb_build_object('price_cents',v_price,
    'base_price_cents',v_offer.price_cents,'discount_bps',v_bps,'currency',upper(v_offer.currency),
    'duration_days',v_offer.duration_days,'weekly_questions',v_offer.weekly_questions);
end;
$$;
create function public.get_my_mentor_offer_quote(p_actor_id uuid,p_offer_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if p_actor_id is null or p_actor_id is distinct from auth.uid() then raise exception 'authentication_required'; end if;
  return public.membership_mentor_offer_quote(p_actor_id,p_offer_id);
end;
$$;
create or replace function public.snapshot_mentor_order_terms()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_offer public.mentor_offers%rowtype; v_quote jsonb;
begin
  select * into v_offer from public.mentor_offers where id=new.offer_id for share;
  if v_offer.id is null or v_offer.mentor_id<>new.mentor_id then raise exception 'offer_unavailable'; end if;
  v_quote:=public.membership_mentor_offer_quote(new.buyer_id,new.offer_id);
  new.amount_cents:=(v_quote->>'price_cents')::integer;
  new.currency:=v_quote->>'currency';
  new.base_price_cents_snapshot:=(v_quote->>'base_price_cents')::integer;
  new.discount_bps_snapshot:=(v_quote->>'discount_bps')::integer;
  new.offer_name_snapshot:=v_offer.name;
  new.duration_days_snapshot:=v_offer.duration_days;
  new.weekly_questions_snapshot:=v_offer.weekly_questions;
  return new;
end;
$$;
create function public.guard_mentor_membership_snapshot()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if row(new.base_price_cents_snapshot,new.discount_bps_snapshot) is distinct from row(old.base_price_cents_snapshot,old.discount_bps_snapshot)
    then raise exception 'mentor_order_terms_immutable'; end if;
  return new;
end;
$$;
create trigger mentor_orders_membership_snapshot_guard before update on public.mentor_orders
for each row execute function public.guard_mentor_membership_snapshot();

create or replace function public.mentor_checkout_order(
  p_offer_id uuid,p_payment_method_id uuid,p_request_id uuid,p_expected_quote jsonb default null
)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_offer public.mentor_offers%rowtype; v_method public.mentor_payment_methods%rowtype;
  v_order public.mentor_orders%rowtype; v_mentor public.mentor_profiles%rowtype; v_quote jsonb;
begin
  if v_actor is null then raise exception 'authentication_required'; end if;
  if not public.account_is_active() then raise exception 'account_ineligible'; end if;
  if p_request_id is null then raise exception 'request_id_required'; end if;
  select * into v_offer from public.mentor_offers where id=p_offer_id for share;
  if v_offer.id is null then raise exception 'offer_unavailable'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text||':'||v_offer.mentor_id::text,0));
  select * into v_order from public.mentor_orders where idempotency_key=p_request_id for update;
  if v_order.id is not null then
    if v_order.buyer_id<>v_actor or v_order.offer_id<>p_offer_id or v_order.payment_method_id is distinct from p_payment_method_id
      then raise exception 'request_conflict'; end if;
    v_quote:=jsonb_build_object('price_cents',v_order.amount_cents,'currency',v_order.currency,
      'duration_days',v_order.duration_days_snapshot,'weekly_questions',v_order.weekly_questions_snapshot);
    if p_expected_quote is not null and p_expected_quote is distinct from v_quote then raise exception 'request_conflict'; end if;
    return v_order.id;
  end if;
  select * into v_mentor from public.mentor_profiles where id=v_offer.mentor_id for share;
  if not coalesce(v_mentor.active,false) or v_mentor.owner_id is null then raise exception 'mentor_unavailable'; end if;
  if v_mentor.owner_id=v_actor then raise exception 'mentor_self_purchase'; end if;
  select * into v_offer from public.mentor_offers where id=p_offer_id for share;
  if not v_offer.active then raise exception 'offer_unavailable'; end if;
  v_quote:=public.membership_mentor_offer_quote(v_actor,p_offer_id)-'base_price_cents'-'discount_bps';
  if p_expected_quote is not null and p_expected_quote is distinct from v_quote then raise exception 'offer_changed'; end if;
  select * into v_method from public.mentor_payment_methods where id=p_payment_method_id for share;
  if v_method.id is null or not v_method.active or v_method.mentor_id<>v_offer.mentor_id then raise exception 'payment_method_unavailable'; end if;
  if exists(select 1 from public.mentor_entitlements where student_id=v_actor and mentor_id=v_offer.mentor_id and status='active' and ends_at>now())
    then raise exception 'mentor_access_active'; end if;
  if exists(select 1 from public.mentor_orders orders where buyer_id=v_actor and mentor_id=v_offer.mentor_id and status='pending'
    and not exists(select 1 from public.mentor_payment_claims claims where claims.order_id=orders.id and claims.status in ('rejected','cancelled')))
    then raise exception 'checkout_pending_exists'; end if;
  insert into public.mentor_orders(buyer_id,mentor_id,offer_id,amount_cents,currency,payment_provider,payment_method_id,idempotency_key)
    values(v_actor,v_offer.mentor_id,v_offer.id,(v_quote->>'price_cents')::integer,v_quote->>'currency','manual',v_method.id,p_request_id)
    returning * into v_order;
  -- The INSERT trigger rechecks executable membership rights. A concurrent
  -- refund/config change may alter that second quote: never return an order
  -- whose sealed amount differs from the buyer-confirmed quote above.
  if jsonb_build_object('price_cents',v_order.amount_cents,'currency',v_order.currency,
    'duration_days',v_order.duration_days_snapshot,'weekly_questions',v_order.weekly_questions_snapshot) is distinct from v_quote
    then raise exception 'offer_changed'; end if;
  return v_order.id;
end;
$$;
-- create_mentor_order and create_manual_mentor_order retain their gate/recovery
-- contracts. The common INSERT trigger applies the same canonical discount to
-- both hosted and manual new orders; returning an existing order never reprices.
revoke all on function public.membership_mentor_offer_quote(uuid,uuid),public.get_my_mentor_offer_quote(uuid,uuid),
  public.guard_mentor_membership_snapshot(),public.snapshot_mentor_order_terms(),
  public.mentor_checkout_order(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.get_my_mentor_offer_quote(uuid,uuid) to authenticated;

create or replace function public.wavekb_schema_version()
returns text language sql stable as $$ select '202610100004'; $$;
commit;
