begin;

-- Payment settlement and tutoring fulfilment are separate state machines.
-- Orders continue to describe money; entitlements now describe service closure.
alter table public.mentor_entitlements
  drop constraint if exists mentor_entitlements_status_check;
alter table public.mentor_entitlements
  add constraint mentor_entitlements_status_check check (
    status in ('active', 'expired', 'completion_requested', 'completed', 'disputed', 'revoked', 'refunded')
  ),
  add column if not exists completion_requested_at timestamptz,
  add column if not exists completion_requested_by uuid references public.profiles(id) on delete set null,
  add column if not exists completion_request_note text not null default '',
  add column if not exists completion_responded_at timestamptz,
  add column if not exists completion_responded_by uuid references public.profiles(id) on delete set null,
  add column if not exists completion_response_note text not null default '',
  add column if not exists updated_at timestamptz not null default now();

alter table public.mentor_entitlements
  drop constraint if exists mentor_entitlements_completion_request_note_check;
alter table public.mentor_entitlements
  add constraint mentor_entitlements_completion_request_note_check
    check (char_length(completion_request_note) <= 1000),
  drop constraint if exists mentor_entitlements_completion_response_note_check;
alter table public.mentor_entitlements
  add constraint mentor_entitlements_completion_response_note_check
    check (char_length(completion_response_note) <= 1000);

create table public.mentor_service_audit (
  id bigint generated always as identity primary key,
  entitlement_id uuid not null references public.mentor_entitlements(id) on delete restrict,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_role text not null check (actor_role in ('mentor', 'student', 'admin')),
  event text not null check (event in ('completion_requested', 'completion_confirmed', 'completion_disputed', 'admin_transition')),
  note text not null default '' check (char_length(note) <= 1000),
  before_status text not null,
  after_status text not null,
  created_at timestamptz not null default now()
);
create index mentor_service_audit_entitlement_idx
  on public.mentor_service_audit(entitlement_id, created_at desc);
alter table public.mentor_service_audit enable row level security;
revoke all on public.mentor_service_audit from public, anon, authenticated;
grant select on public.mentor_service_audit to authenticated, service_role;
create policy mentor_service_audit_participant_read on public.mentor_service_audit
for select to authenticated using (
  public.is_admin()
  or exists (
    select 1
    from public.mentor_entitlements entitlement
    join public.mentor_profiles mentor on mentor.id = entitlement.mentor_id
    where entitlement.id = mentor_service_audit.entitlement_id
      and (entitlement.student_id = auth.uid() or mentor.owner_id = auth.uid())
  )
);

-- Every checkout path, including legacy hosted-payment callers, is protected
-- from opening a second service while completion review or a dispute is open.
create function public.guard_mentor_open_service_checkout()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.mentor_entitlements entitlement
    where entitlement.student_id = new.buyer_id
      and entitlement.mentor_id = new.mentor_id
      and (
        (entitlement.status = 'active' and entitlement.ends_at > now())
        or entitlement.status in ('completion_requested', 'disputed')
      )
  ) then raise exception 'mentor_access_active'; end if;
  return new;
end;
$$;
revoke all on function public.guard_mentor_open_service_checkout() from public, anon, authenticated;
drop trigger if exists mentor_orders_guard_open_service on public.mentor_orders;
create trigger mentor_orders_guard_open_service before insert on public.mentor_orders
for each row execute function public.guard_mentor_open_service_checkout();

-- An administrator marking a manual order paid must atomically settle the
-- declaration too. The deterministic backfill repairs only paid orders whose
-- declaration is still submitted; it does not infer anything about pending orders.
update public.mentor_payment_claims claim
set status = 'confirmed',
    reviewed_at = coalesce(claim.reviewed_at, orders.paid_at, orders.updated_at, now())
from public.mentor_orders orders
where orders.id = claim.order_id
  and orders.status = 'paid'
  and claim.status = 'submitted';

create or replace function public.admin_transition_mentor_order(
  p_order_id uuid, p_expected_status text, p_status text, p_reason text default ''
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_order public.mentor_orders%rowtype;
begin
  if not public.is_admin() then raise exception 'admin_required'; end if;
  if p_status is null or p_status not in ('pending', 'paid', 'cancelled', 'refunded', 'failed')
    or p_expected_status is null then raise exception 'order_transition_invalid'; end if;
  if char_length(coalesce(p_reason, '')) > 500 then raise exception 'reason_too_long'; end if;
  select * into v_order from public.mentor_orders where id = p_order_id for update;
  if v_order.id is null then raise exception 'order_not_found'; end if;
  if v_order.status is distinct from p_expected_status then raise exception 'order_changed_concurrently'; end if;
  perform set_config('wavekb.mentor_order_reason', btrim(coalesce(p_reason, '')), true);
  perform set_config('wavekb.mentor_payment_event_id', '', true);
  update public.mentor_orders set status = p_status,
    paid_at = case when p_status = 'paid' then coalesce(paid_at, now()) else paid_at end,
    updated_at = now() where id = p_order_id;
  if p_status = 'paid' then
    update public.mentor_payment_claims
    set status = 'confirmed', reviewed_at = now(), reviewer_id = auth.uid()
    where order_id = p_order_id and status <> 'confirmed';
  elsif p_status = 'failed' then
    update public.mentor_payment_claims
    set status = 'rejected', reviewed_at = now(), reviewer_id = auth.uid()
    where order_id = p_order_id and status = 'submitted';
  elsif p_status = 'cancelled' and p_expected_status in ('pending', 'failed') then
    update public.mentor_payment_claims
    set status = 'cancelled', reviewed_at = now(), reviewer_id = auth.uid()
    where order_id = p_order_id and status = 'submitted';
  end if;
  return jsonb_build_object('id', p_order_id, 'status', p_status);
end;
$$;
revoke all on function public.admin_transition_mentor_order(uuid, text, text, text) from public, anon;
grant execute on function public.admin_transition_mentor_order(uuid, text, text, text) to authenticated;

-- A buyer may clear either an unclaimed manual order or a genuinely unbound
-- legacy checkout. Provider-bound and claimed orders remain non-cancellable here.
create or replace function public.cancel_unsubmitted_mentor_order(p_order_id uuid, p_confirm_unpaid boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_order public.mentor_orders%rowtype; v_actor uuid := auth.uid(); v_route_cancellable boolean;
begin
  if v_actor is null then raise exception 'authentication_required'; end if;
  if not public.account_is_active() then raise exception 'account_ineligible'; end if;
  if p_confirm_unpaid is distinct from true then raise exception 'unpaid_confirmation_required'; end if;
  select * into v_order from public.mentor_orders where id = p_order_id and buyer_id = v_actor;
  if v_order.id is null then raise exception 'order_access_denied'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text || ':' || v_order.mentor_id::text, 0));
  select * into v_order from public.mentor_orders where id = p_order_id and buyer_id = v_actor for update;
  if v_order.status = 'cancelled' then return v_order.id; end if;
  v_route_cancellable := (
    v_order.payment_provider = 'manual' and v_order.payment_method_id is not null and v_order.provider_order_id is null
  ) or (
    v_order.payment_provider is null and v_order.payment_method_id is null and v_order.provider_order_id is null
  );
  if not v_route_cancellable then raise exception 'order_payment_route_invalid'; end if;
  if v_order.status <> 'pending'
    or v_order.paid_at is not null
    or exists (select 1 from public.mentor_payment_claims where order_id = p_order_id) then
    raise exception 'order_not_cancellable';
  end if;
  perform set_config('wavekb.mentor_order_reason', 'Buyer confirmed no transfer occurred', true);
  update public.mentor_orders set status = 'cancelled', updated_at = now() where id = p_order_id;
  return p_order_id;
end;
$$;
revoke all on function public.cancel_unsubmitted_mentor_order(uuid, boolean) from public, anon;
grant execute on function public.cancel_unsubmitted_mentor_order(uuid, boolean) to authenticated;

create or replace function public.request_mentor_service_completion(p_thread_id uuid, p_note text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_thread public.mentor_threads%rowtype; v_entitlement public.mentor_entitlements%rowtype; v_note text := btrim(coalesce(p_note, ''));
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not public.account_is_active() then raise exception 'account_ineligible'; end if;
  if char_length(v_note) > 1000 then raise exception 'completion_note_too_long'; end if;
  select thread.* into v_thread
  from public.mentor_threads thread
  join public.mentor_profiles mentor on mentor.id = thread.mentor_id
  where thread.id = p_thread_id and mentor.owner_id = auth.uid();
  if v_thread.id is null then raise exception 'thread_access_denied'; end if;
  select * into v_entitlement from public.mentor_entitlements where id = v_thread.entitlement_id for update;
  if v_entitlement.status = 'completion_requested' then
    return jsonb_build_object('entitlement_id', v_entitlement.id, 'status', v_entitlement.status);
  end if;
  if v_entitlement.status not in ('active', 'expired') then raise exception 'service_transition_invalid'; end if;
  update public.mentor_entitlements
  set status = 'completion_requested', completion_requested_at = now(), completion_requested_by = auth.uid(),
      completion_request_note = v_note, completion_responded_at = null, completion_responded_by = null,
      completion_response_note = '', updated_at = now()
  where id = v_entitlement.id;
  insert into public.mentor_service_audit(entitlement_id, actor_id, actor_role, event, note, before_status, after_status)
  values (v_entitlement.id, auth.uid(), 'mentor', 'completion_requested', v_note, v_entitlement.status, 'completion_requested');
  return jsonb_build_object('entitlement_id', v_entitlement.id, 'status', 'completion_requested');
end;
$$;

create or replace function public.respond_mentor_service_completion(p_thread_id uuid, p_confirm boolean, p_note text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_thread public.mentor_threads%rowtype; v_entitlement public.mentor_entitlements%rowtype; v_note text := btrim(coalesce(p_note, '')); v_status text;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not public.account_is_active() then raise exception 'account_ineligible'; end if;
  if p_confirm is null then raise exception 'completion_confirmation_required'; end if;
  if char_length(v_note) > 1000 then raise exception 'completion_note_too_long'; end if;
  select * into v_thread from public.mentor_threads where id = p_thread_id and student_id = auth.uid();
  if v_thread.id is null then raise exception 'thread_access_denied'; end if;
  select * into v_entitlement from public.mentor_entitlements where id = v_thread.entitlement_id for update;
  if v_entitlement.status <> 'completion_requested' then raise exception 'service_transition_invalid'; end if;
  v_status := case when p_confirm then 'completed' else 'disputed' end;
  update public.mentor_entitlements
  set status = v_status, completion_responded_at = now(), completion_responded_by = auth.uid(),
      completion_response_note = v_note, updated_at = now()
  where id = v_entitlement.id;
  insert into public.mentor_service_audit(entitlement_id, actor_id, actor_role, event, note, before_status, after_status)
  values (v_entitlement.id, auth.uid(), 'student', case when p_confirm then 'completion_confirmed' else 'completion_disputed' end,
    v_note, v_entitlement.status, v_status);
  return jsonb_build_object('entitlement_id', v_entitlement.id, 'status', v_status);
end;
$$;

create or replace function public.admin_transition_mentor_service(
  p_entitlement_id uuid, p_expected_status text, p_status text, p_reason text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_entitlement public.mentor_entitlements%rowtype; v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not public.is_admin() then raise exception 'admin_required'; end if;
  if char_length(v_reason) < 2 then raise exception 'service_reason_required'; end if;
  if char_length(v_reason) > 500 then raise exception 'reason_too_long'; end if;
  if p_status not in ('active', 'completed', 'disputed', 'revoked') or p_expected_status is null then
    raise exception 'service_transition_invalid';
  end if;
  select * into v_entitlement from public.mentor_entitlements where id = p_entitlement_id for update;
  if v_entitlement.id is null then raise exception 'service_not_found'; end if;
  if v_entitlement.status is distinct from p_expected_status then raise exception 'service_changed_concurrently'; end if;
  if p_status = p_expected_status or not (
    (p_expected_status in ('active', 'expired') and p_status in ('completed', 'revoked'))
    or (p_expected_status = 'completion_requested' and p_status in ('active', 'completed', 'disputed', 'revoked'))
    or (p_expected_status = 'disputed' and p_status in ('active', 'completed', 'revoked'))
  ) then raise exception 'service_transition_invalid'; end if;
  update public.mentor_entitlements set status = p_status,
    completion_responded_at = case when p_status in ('completed', 'disputed') then now() else completion_responded_at end,
    completion_responded_by = case when p_status in ('completed', 'disputed') then auth.uid() else completion_responded_by end,
    completion_response_note = case when p_status in ('completed', 'disputed') then v_reason else completion_response_note end,
    updated_at = now()
  where id = p_entitlement_id;
  insert into public.mentor_service_audit(entitlement_id, actor_id, actor_role, event, note, before_status, after_status)
  values (p_entitlement_id, auth.uid(), 'admin', 'admin_transition', v_reason, p_expected_status, p_status);
  return jsonb_build_object('entitlement_id', p_entitlement_id, 'status', p_status);
end;
$$;

revoke all on function public.request_mentor_service_completion(uuid, text) from public, anon;
revoke all on function public.respond_mentor_service_completion(uuid, boolean, text) from public, anon;
revoke all on function public.admin_transition_mentor_service(uuid, text, text, text) from public, anon;
grant execute on function public.request_mentor_service_completion(uuid, text) to authenticated;
grant execute on function public.respond_mentor_service_completion(uuid, boolean, text) to authenticated;
grant execute on function public.admin_transition_mentor_service(uuid, text, text, text) to authenticated;

drop function public.list_my_mentor_access();
create function public.list_my_mentor_access()
returns table (
  entitlement_id uuid, mentor_id uuid, mentor_name text, mentor_avatar_url text, thread_id uuid,
  status text, weekly_question_limit integer, questions_used bigint, starts_at timestamptz, ends_at timestamptz,
  completion_requested_at timestamptz, completion_request_note text, completion_responded_at timestamptz,
  completion_response_note text
)
language sql stable security definer set search_path = '' as $$
  select e.id, e.mentor_id, m.display_name, public.mentor_display_avatar(m.owner_id, m.avatar_url), t.id,
    case when e.status = 'active' and e.ends_at <= now() then 'expired' else e.status end,
    e.weekly_question_limit,
    (select count(*) from public.mentor_messages message where message.thread_id = t.id and message.counts_quota and message.quota_week = date_trunc('week', now())::date),
    e.starts_at, e.ends_at, e.completion_requested_at, e.completion_request_note,
    e.completion_responded_at, e.completion_response_note
  from public.mentor_entitlements e
  join public.mentor_profiles m on m.id = e.mentor_id
  join public.mentor_threads t on t.entitlement_id = e.id
  where e.student_id = auth.uid()
  order by e.created_at desc;
$$;

drop function public.get_mentor_thread(uuid);
create function public.get_mentor_thread(p_thread_id uuid)
returns table (
  thread_id uuid, mentor_id uuid, mentor_name text, mentor_avatar_url text, student_id uuid,
  status text, weekly_question_limit integer, questions_used bigint, starts_at timestamptz, ends_at timestamptz,
  completion_requested_at timestamptz, completion_request_note text, completion_responded_at timestamptz,
  completion_response_note text
)
language sql stable security definer set search_path = '' as $$
  select t.id, t.mentor_id, m.display_name, public.mentor_display_avatar(m.owner_id, m.avatar_url), t.student_id,
    case when e.status = 'active' and e.ends_at <= now() then 'expired' else e.status end,
    e.weekly_question_limit,
    (select count(*) from public.mentor_messages message where message.thread_id = t.id and message.counts_quota and message.quota_week = date_trunc('week', now())::date),
    e.starts_at, e.ends_at, e.completion_requested_at, e.completion_request_note,
    e.completion_responded_at, e.completion_response_note
  from public.mentor_threads t
  join public.mentor_entitlements e on e.id = t.entitlement_id
  join public.mentor_profiles m on m.id = t.mentor_id
  where t.id = p_thread_id and (t.student_id = auth.uid() or m.owner_id = auth.uid() or public.mentor_is_admin());
$$;

create or replace function public.list_my_mentor_students()
returns table (
  thread_id uuid, student_id uuid, public_uid integer, display_name text, avatar_url text, bio text,
  display_title text, nameplate_style text, access_status text, last_message text, last_message_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select thread.id, student.id, student.public_uid, student.display_name, student.avatar_url, student.bio,
    student.display_title, student.nameplate_style,
    case when entitlement.status = 'active' and entitlement.ends_at <= now() then 'expired' else entitlement.status end,
    latest.body, latest.created_at
  from public.mentor_threads thread
  join public.mentor_profiles mentor on mentor.id = thread.mentor_id
  join public.mentor_entitlements entitlement on entitlement.id = thread.entitlement_id
  join public.profiles student on student.id = thread.student_id
  left join lateral (
    select message.body, message.created_at from public.mentor_messages message
    where message.thread_id = thread.id order by message.created_at desc limit 1
  ) latest on true
  where mentor.owner_id = auth.uid()
  order by coalesce(latest.created_at, thread.updated_at) desc;
$$;

create or replace function public.send_mentor_message(p_thread_id uuid, p_body text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_thread public.mentor_threads%rowtype; v_entitlement public.mentor_entitlements%rowtype;
  v_mentor public.mentor_profiles%rowtype; v_is_student boolean; v_used bigint; v_id bigint;
  v_body text := btrim(coalesce(p_body, ''));
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if char_length(v_body) < 5 or char_length(v_body) > 5000 then raise exception 'invalid_message'; end if;
  select * into v_thread from public.mentor_threads where id = p_thread_id;
  if v_thread.id is null then raise exception 'thread_access_denied'; end if;
  select * into v_entitlement from public.mentor_entitlements where id = v_thread.entitlement_id;
  select * into v_mentor from public.mentor_profiles where id = v_thread.mentor_id;
  v_is_student := v_thread.student_id = auth.uid();
  if not v_is_student and v_mentor.owner_id is distinct from auth.uid() and not public.mentor_is_admin() then
    raise exception 'thread_access_denied';
  end if;
  if v_is_student then
    if v_entitlement.status not in ('active', 'completion_requested', 'disputed') or v_entitlement.ends_at <= now() then raise exception 'tutoring_access_expired'; end if;
    select count(*) into v_used from public.mentor_messages
    where thread_id = p_thread_id and counts_quota and quota_week = date_trunc('week', now())::date;
    if v_used >= v_entitlement.weekly_question_limit then raise exception 'weekly_question_limit_reached'; end if;
  elsif v_entitlement.status not in ('active', 'expired', 'completion_requested', 'disputed') then
    raise exception 'tutoring_access_closed';
  end if;
  insert into public.mentor_messages(thread_id, sender_id, body, message_kind, counts_quota, quota_week)
  values (p_thread_id, auth.uid(), v_body, case when v_is_student then 'question' else 'reply' end,
    v_is_student, case when v_is_student then date_trunc('week', now())::date else null end)
  returning id into v_id;
  update public.mentor_threads set updated_at = now() where id = p_thread_id;
  return v_id;
end;
$$;

revoke all on function public.list_my_mentor_access() from public;
revoke all on function public.get_mentor_thread(uuid) from public;
revoke all on function public.list_my_mentor_students() from public;
revoke all on function public.send_mentor_message(uuid, text) from public;
grant execute on function public.list_my_mentor_access() to authenticated;
grant execute on function public.get_mentor_thread(uuid) to authenticated;
grant execute on function public.list_my_mentor_students() to authenticated;
grant execute on function public.send_mentor_message(uuid, text) to authenticated;

create or replace function public.wavekb_schema_version()
returns text language sql stable security definer set search_path = ''
as $$ select '202610220002'::text; $$;
revoke all on function public.wavekb_schema_version() from public;
grant execute on function public.wavekb_schema_version() to anon, authenticated;

notify pgrst, 'reload schema';
commit;
