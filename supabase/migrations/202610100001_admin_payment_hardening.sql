begin;

-- Browser/RLS access must apply the same active-admin rule as the Gateway.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and account_status = 'active');
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

create or replace function public.mentor_is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_admin();
$$;
revoke all on function public.mentor_is_admin() from public;
grant execute on function public.mentor_is_admin() to authenticated;

create table public.mentor_order_audit (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.mentor_orders(id) on delete restrict,
  actor_id uuid references public.profiles(id) on delete restrict,
  source text not null check (source in ('admin', 'member', 'service')),
  reason text not null default '' check (char_length(reason) <= 500),
  payment_event_id text,
  before_state jsonb not null,
  after_state jsonb not null,
  created_at timestamptz not null default now()
);
create index mentor_order_audit_order_idx on public.mentor_order_audit(order_id, created_at desc);
alter table public.mentor_order_audit enable row level security;
revoke all on public.mentor_order_audit from public, anon, authenticated;
grant select on public.mentor_order_audit to authenticated, service_role;
create policy mentor_order_audit_admin_read on public.mentor_order_audit
for select to authenticated using (public.is_admin());

-- Economic terms are purchase snapshots. Even service writers cannot reopen
-- a refunded/cancelled order or mutate the terms after it has been created.
create function public.guard_mentor_order_transition()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.buyer_id is distinct from old.buyer_id
    or new.mentor_id is distinct from old.mentor_id
    or new.offer_id is distinct from old.offer_id
    or new.amount_cents is distinct from old.amount_cents
    or new.currency is distinct from old.currency
    or new.payment_method_id is distinct from old.payment_method_id
    or new.idempotency_key is distinct from old.idempotency_key
    or new.offer_name_snapshot is distinct from old.offer_name_snapshot
    or new.duration_days_snapshot is distinct from old.duration_days_snapshot
    or new.weekly_questions_snapshot is distinct from old.weekly_questions_snapshot then
    raise exception 'order_terms_immutable';
  end if;
  if old.provider_order_id is not null and new.provider_order_id is distinct from old.provider_order_id then
    raise exception 'order_payment_route_invalid';
  end if;
  if old.payment_provider is not null and new.payment_provider is distinct from old.payment_provider then
    raise exception 'order_payment_route_invalid';
  end if;
  if old.paid_at is not null and new.paid_at is distinct from old.paid_at then
    raise exception 'order_paid_at_immutable';
  end if;
  if new.status is distinct from old.status and not (
    (old.status = 'pending' and new.status in ('paid', 'cancelled', 'failed'))
    or (old.status = 'failed' and new.status in ('pending', 'paid', 'cancelled'))
    or (old.status = 'paid' and new.status in ('refunded', 'cancelled'))
  ) then raise exception 'order_transition_invalid'; end if;
  return new;
end;
$$;
revoke all on function public.guard_mentor_order_transition() from public, anon, authenticated;
create trigger mentor_orders_guard_transition before update on public.mentor_orders
for each row execute function public.guard_mentor_order_transition();

create function public.audit_mentor_order_transition()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    insert into public.mentor_order_audit(order_id, actor_id, source, reason, payment_event_id, before_state, after_state)
    values (new.id, auth.uid(), case when auth.uid() is null then 'service'
      when public.is_admin() then 'admin' else 'member' end,
      left(coalesce(current_setting('wavekb.mentor_order_reason', true), ''), 500),
      nullif(current_setting('wavekb.mentor_payment_event_id', true), ''), to_jsonb(old), to_jsonb(new));
  end if;
  return new;
end;
$$;
revoke all on function public.audit_mentor_order_transition() from public, anon, authenticated;
create trigger mentor_orders_audit_transition after update of status on public.mentor_orders
for each row execute function public.audit_mentor_order_transition();

-- All browser administration uses a constrained transaction, not table PATCH.
drop policy if exists mentor_orders_admin_write on public.mentor_orders;
revoke insert, update, delete on public.mentor_orders from public, anon, authenticated;
create function public.admin_transition_mentor_order(
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
  return jsonb_build_object('id', p_order_id, 'status', p_status);
end;
$$;
revoke all on function public.admin_transition_mentor_order(uuid, text, text, text) from public, anon;
grant execute on function public.admin_transition_mentor_order(uuid, text, text, text) to authenticated;

-- Bind a hosted payment to its buyer/order once. Manual orders stay manual.
create function public.register_mentor_checkout_session(p_actor uuid, p_order_id uuid, p_provider_order_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_order public.mentor_orders%rowtype;
begin
  if p_actor is null or not exists (select 1 from public.profiles p join auth.users u on u.id = p.id
    where p.id = p_actor and p.account_status = 'active' and p.public_uid is not null and u.email_confirmed_at is not null)
    then raise exception 'account_ineligible'; end if;
  if coalesce(p_provider_order_id, '') !~ '^cs_[A-Za-z0-9_]+$' then raise exception 'payment_session_invalid'; end if;
  select * into v_order from public.mentor_orders where id = p_order_id and buyer_id = p_actor for update;
  if v_order.id is null then raise exception 'order_access_denied'; end if;
  if v_order.status <> 'pending' then raise exception 'order_not_payable'; end if;
  if v_order.payment_method_id is not null or (v_order.payment_provider is not null and v_order.payment_provider <> 'stripe')
    or (v_order.provider_order_id is not null and v_order.provider_order_id <> p_provider_order_id)
    then raise exception 'order_payment_route_invalid'; end if;
  update public.mentor_orders set payment_provider = 'stripe', provider_order_id = p_provider_order_id, updated_at = now()
    where id = p_order_id;
end;
$$;
revoke all on function public.register_mentor_checkout_session(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.register_mentor_checkout_session(uuid, uuid, text) to service_role;

alter table public.mentor_payment_events
  add column provider_order_id text,
  add column processing_outcome text;
revoke insert, update, delete on public.mentor_payment_events from anon, authenticated;

-- The signature is checked by the Edge Function. This service-only RPC checks
-- the stored purchase/session and commits the event + order + rights atomically.
create function public.apply_verified_mentor_payment_event(
  p_event_id text, p_event_type text, p_order_id uuid, p_provider_order_id text,
  p_amount_cents bigint, p_currency text, p_payment_status text, p_paid_at timestamptz default now()
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_order public.mentor_orders%rowtype; v_event public.mentor_payment_events%rowtype; v_outcome text;
begin
  if coalesce(p_event_id, '') !~ '^evt_[A-Za-z0-9_]+$'
    or coalesce(p_provider_order_id, '') !~ '^cs_[A-Za-z0-9_]+$'
    or p_event_type is null or p_event_type not in ('checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.expired')
    then raise exception 'payment_event_invalid'; end if;
  select * into v_order from public.mentor_orders where id = p_order_id for update;
  if v_order.id is null then raise exception 'order_not_found'; end if;
  if v_order.payment_provider is distinct from 'stripe' or v_order.payment_method_id is not null
    or v_order.provider_order_id is distinct from p_provider_order_id then raise exception 'order_payment_route_invalid'; end if;
  if p_event_type <> 'checkout.session.expired' and
    (p_amount_cents is distinct from v_order.amount_cents::bigint
      or upper(coalesce(p_currency, '')) <> upper(v_order.currency)) then raise exception 'payment_amount_mismatch'; end if;
  insert into public.mentor_payment_events(event_id, provider, event_type, order_id, provider_order_id)
    values(p_event_id, 'stripe', p_event_type, p_order_id, p_provider_order_id)
    on conflict(event_id) do nothing returning * into v_event;
  if v_event.event_id is null then
    select * into v_event from public.mentor_payment_events where event_id = p_event_id;
    if v_event.order_id is distinct from p_order_id or v_event.provider is distinct from 'stripe'
      or v_event.event_type is distinct from p_event_type
      or (v_event.provider_order_id is not null and v_event.provider_order_id <> p_provider_order_id)
      then raise exception 'payment_event_conflict'; end if;
    return jsonb_build_object('duplicate', true, 'applied', false, 'status', v_order.status, 'outcome', coalesce(v_event.processing_outcome, 'historical_duplicate'));
  end if;
  if v_order.status in ('paid', 'cancelled', 'refunded', 'failed') then v_outcome := 'ignored_order_state';
  elsif p_event_type = 'checkout.session.expired' then v_outcome := 'cancelled';
  elsif p_payment_status is distinct from 'paid' then v_outcome := 'ignored_unpaid';
  else v_outcome := 'paid'; end if;
  if v_outcome in ('paid', 'cancelled') then
    perform set_config('wavekb.mentor_order_reason', 'Verified Stripe event', true);
    perform set_config('wavekb.mentor_payment_event_id', p_event_id, true);
    update public.mentor_orders set status = v_outcome,
      paid_at = case when v_outcome = 'paid' then coalesce(paid_at, p_paid_at, now()) else paid_at end,
      updated_at = now() where id = p_order_id;
  end if;
  update public.mentor_payment_events set processing_outcome = v_outcome where event_id = p_event_id;
  return jsonb_build_object('duplicate', false, 'applied', v_outcome in ('paid', 'cancelled'),
    'status', case when v_outcome in ('paid', 'cancelled') then v_outcome else v_order.status end, 'outcome', v_outcome);
end;
$$;
revoke all on function public.apply_verified_mentor_payment_event(text, text, uuid, text, bigint, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.apply_verified_mentor_payment_event(text, text, uuid, text, bigint, text, text, timestamptz) to service_role;

create or replace function public.wavekb_schema_version()
returns text language sql stable security definer set search_path = '' as $$ select '202610100001'::text; $$;
revoke all on function public.wavekb_schema_version() from public;
grant execute on function public.wavekb_schema_version() to anon, authenticated;
notify pgrst, 'reload schema';
commit;
