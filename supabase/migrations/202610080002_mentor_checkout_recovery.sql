begin;

-- Snapshot new purchases only. Historical orders are not rewritten or re-priced.
alter table public.mentor_orders
  add column if not exists offer_name_snapshot text,
  add column if not exists duration_days_snapshot integer check (duration_days_snapshot between 1 and 366),
  add column if not exists weekly_questions_snapshot integer check (weekly_questions_snapshot between 1 and 100);

create or replace function public.snapshot_mentor_order_terms()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_offer public.mentor_offers%rowtype;
begin
  select * into v_offer from public.mentor_offers where id = new.offer_id;
  if v_offer.id is null or v_offer.mentor_id <> new.mentor_id then raise exception 'offer_unavailable'; end if;
  new.offer_name_snapshot := v_offer.name;
  new.duration_days_snapshot := v_offer.duration_days;
  new.weekly_questions_snapshot := v_offer.weekly_questions;
  return new;
end;
$$;
revoke all on function public.snapshot_mentor_order_terms() from public, anon, authenticated;
drop trigger if exists mentor_orders_snapshot_terms on public.mentor_orders;
create trigger mentor_orders_snapshot_terms before insert on public.mentor_orders
for each row execute function public.snapshot_mentor_order_terms();

create or replace function public.mentor_checkout_order(
  p_offer_id uuid, p_payment_method_id uuid, p_request_id uuid, p_expected_quote jsonb default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_offer public.mentor_offers%rowtype;
  v_method public.mentor_payment_methods%rowtype;
  v_order public.mentor_orders%rowtype;
  v_mentor public.mentor_profiles%rowtype;
  v_quote jsonb;
begin
  if v_actor is null then raise exception 'authentication_required'; end if;
  if not public.account_is_active() then raise exception 'account_ineligible'; end if;
  if p_request_id is null then raise exception 'request_id_required'; end if;
  -- One lock per buyer/mentor also serializes the compatible legacy RPCs.
  select * into v_offer from public.mentor_offers where id = p_offer_id for share;
  if v_offer.id is null then raise exception 'offer_unavailable'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text || ':' || v_offer.mentor_id::text, 0));
  select * into v_order from public.mentor_orders where idempotency_key = p_request_id for update;
  if v_order.id is not null then
    if v_order.buyer_id <> v_actor or v_order.offer_id <> p_offer_id
      or v_order.payment_method_id is distinct from p_payment_method_id then
      raise exception 'request_conflict';
    end if;
    v_quote := jsonb_build_object('price_cents', v_order.amount_cents, 'currency', v_order.currency,
      'duration_days', v_order.duration_days_snapshot, 'weekly_questions', v_order.weekly_questions_snapshot);
    if p_expected_quote is not null and p_expected_quote is distinct from v_quote then raise exception 'request_conflict'; end if;
    return v_order.id;
  end if;
  select * into v_mentor from public.mentor_profiles where id = v_offer.mentor_id for share;
  if not coalesce(v_mentor.active, false) or v_mentor.owner_id is null then raise exception 'mentor_unavailable'; end if;
  if v_mentor.owner_id = v_actor then raise exception 'mentor_self_purchase'; end if;
  select * into v_offer from public.mentor_offers where id = p_offer_id for share;
  if not v_offer.active then raise exception 'offer_unavailable'; end if;
  v_quote := jsonb_build_object('price_cents', v_offer.price_cents, 'currency', upper(v_offer.currency),
    'duration_days', v_offer.duration_days, 'weekly_questions', v_offer.weekly_questions);
  if p_expected_quote is not null and p_expected_quote is distinct from v_quote then raise exception 'offer_changed'; end if;
  select * into v_method from public.mentor_payment_methods where id = p_payment_method_id for share;
  if v_method.id is null or not v_method.active or v_method.mentor_id <> v_offer.mentor_id then
    raise exception 'payment_method_unavailable';
  end if;
  if exists (select 1 from public.mentor_entitlements where student_id = v_actor
      and mentor_id = v_offer.mentor_id and status = 'active' and ends_at > now()) then
    raise exception 'mentor_access_active';
  end if;
  if exists (select 1 from public.mentor_orders orders where buyer_id = v_actor
      and mentor_id = v_offer.mentor_id and status = 'pending'
      and not exists (select 1 from public.mentor_payment_claims claims where claims.order_id = orders.id and claims.status in ('rejected', 'cancelled'))) then
    raise exception 'checkout_pending_exists';
  end if;
  insert into public.mentor_orders(buyer_id, mentor_id, offer_id, amount_cents, currency,
    payment_provider, payment_method_id, idempotency_key)
  values (v_actor, v_offer.mentor_id, v_offer.id, v_offer.price_cents, upper(v_offer.currency),
    'manual', v_method.id, p_request_id) returning * into v_order;
  return v_order.id;
end;
$$;
revoke all on function public.mentor_checkout_order(uuid, uuid, uuid, jsonb) from public, anon, authenticated;

-- Legacy callers retain their signatures. An existing identical pending order
-- is reused; incompatible pending work must be resolved before another purchase.
create or replace function public.create_manual_mentor_order(p_offer_id uuid, p_payment_method_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_mentor_id uuid; v_order_id uuid;
begin
  if v_actor is null then raise exception 'authentication_required'; end if;
  if not public.account_is_active() then raise exception 'account_ineligible'; end if;
  select mentor_id into v_mentor_id from public.mentor_offers where id = p_offer_id;
  if v_mentor_id is null then raise exception 'offer_unavailable'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text || ':' || v_mentor_id::text, 0));
  select orders.id into v_order_id from public.mentor_orders orders
    where buyer_id = v_actor and offer_id = p_offer_id and payment_method_id = p_payment_method_id and status = 'pending'
      and not exists (select 1 from public.mentor_payment_claims claims where claims.order_id = orders.id and claims.status in ('rejected', 'cancelled'))
    order by created_at limit 1 for update;
  if v_order_id is not null then return v_order_id; end if;
  return public.mentor_checkout_order(p_offer_id, p_payment_method_id, gen_random_uuid());
end;
$$;

-- The older hosted-payment checkout remains available, but it shares the same
-- purchase gates/lock. A provider order never guesses a manual payment method.
create or replace function public.create_mentor_order(p_offer_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_offer public.mentor_offers%rowtype;
  v_mentor public.mentor_profiles%rowtype; v_order public.mentor_orders%rowtype;
begin
  if v_actor is null then raise exception 'authentication_required'; end if;
  if not public.account_is_active() then raise exception 'account_ineligible'; end if;
  select * into v_offer from public.mentor_offers where id = p_offer_id for share;
  if v_offer.id is null or not v_offer.active then raise exception 'offer_unavailable'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text || ':' || v_offer.mentor_id::text, 0));
  select * into v_mentor from public.mentor_profiles where id = v_offer.mentor_id for share;
  if not coalesce(v_mentor.active, false) or v_mentor.owner_id is null then raise exception 'mentor_unavailable'; end if;
  if v_mentor.owner_id = v_actor then raise exception 'mentor_self_purchase'; end if;
  if exists (select 1 from public.mentor_entitlements where student_id = v_actor
      and mentor_id = v_offer.mentor_id and status = 'active' and ends_at > now()) then
    raise exception 'mentor_access_active';
  end if;
  select orders.* into v_order from public.mentor_orders orders where buyer_id = v_actor
    and mentor_id = v_offer.mentor_id and status = 'pending'
    and not exists (select 1 from public.mentor_payment_claims claims where claims.order_id = orders.id and claims.status in ('rejected', 'cancelled'))
    order by created_at limit 1 for update;
  if v_order.id is not null then
    if v_order.offer_id = p_offer_id and v_order.payment_method_id is null and v_order.payment_provider is distinct from 'manual' then
      return v_order.id;
    end if;
    raise exception 'checkout_pending_exists';
  end if;
  insert into public.mentor_orders(buyer_id, mentor_id, offer_id, amount_cents, currency)
  values(v_actor, v_offer.mentor_id, v_offer.id, v_offer.price_cents, upper(v_offer.currency)) returning id into v_order.id;
  return v_order.id;
end;
$$;

-- Idempotent resume also repairs legacy orders whose second request was lost.
-- Never re-submit a reviewed declaration or change its original timestamp.
create or replace function public.submit_mentor_payment_claim(p_order_id uuid, p_buyer_note text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_order public.mentor_orders%rowtype; v_claim public.mentor_payment_claims%rowtype; v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'authentication_required'; end if;
  if not public.account_is_active() then raise exception 'account_ineligible'; end if;
  select * into v_order from public.mentor_orders where id = p_order_id and buyer_id = v_actor;
  if v_order.id is null then raise exception 'order_access_denied'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text || ':' || v_order.mentor_id::text, 0));
  select * into v_order from public.mentor_orders where id = p_order_id for update;
  if v_order.payment_method_id is null then raise exception 'payment_method_required'; end if;
  if v_order.payment_provider is distinct from 'manual' then raise exception 'order_payment_route_invalid'; end if;
  select * into v_claim from public.mentor_payment_claims where order_id = p_order_id for update;
  if v_claim.id is not null and v_claim.status in ('submitted', 'confirmed') then return v_claim.id; end if;
  if v_order.status <> 'pending' or v_claim.id is not null then raise exception 'order_not_pending'; end if;
  if exists (select 1 from public.mentor_payment_claims where buyer_id = v_actor and mentor_id = v_order.mentor_id
      and status = 'submitted' and order_id <> p_order_id) then raise exception 'checkout_pending_exists'; end if;
  insert into public.mentor_payment_claims(order_id, buyer_id, mentor_id, payment_method_id, buyer_note)
    values (v_order.id, v_order.buyer_id, v_order.mentor_id, v_order.payment_method_id, left(btrim(coalesce(p_buyer_note, '')), 1000))
    returning id into v_claim.id;
  return v_claim.id;
end;
$$;

create or replace function public.submit_manual_mentor_payment(
  p_offer_id uuid, p_payment_method_id uuid, p_buyer_note text, p_request_id uuid, p_expected_quote jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_order_id uuid; v_claim_id uuid; v_note text;
begin
  if p_expected_quote is null or jsonb_typeof(p_expected_quote) <> 'object' then raise exception 'offer_quote_required'; end if;
  v_order_id := public.mentor_checkout_order(p_offer_id, p_payment_method_id, p_request_id, p_expected_quote);
  select buyer_note into v_note from public.mentor_payment_claims where order_id = v_order_id;
  if found and v_note is distinct from left(btrim(coalesce(p_buyer_note, '')), 1000) then
    raise exception 'request_conflict';
  end if;
  v_claim_id := public.submit_mentor_payment_claim(v_order_id, p_buyer_note);
  return jsonb_build_object('order_id', v_order_id, 'claim_id', v_claim_id);
end;
$$;

-- Cancellation is only for an unclaimed legacy order and requires an explicit
-- declaration that no transfer occurred. A submitted payment cannot be cancelled here.
create or replace function public.cancel_unsubmitted_mentor_order(p_order_id uuid, p_confirm_unpaid boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_order public.mentor_orders%rowtype; v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'authentication_required'; end if;
  if not public.account_is_active() then raise exception 'account_ineligible'; end if;
  if p_confirm_unpaid is distinct from true then raise exception 'unpaid_confirmation_required'; end if;
  select * into v_order from public.mentor_orders where id = p_order_id and buyer_id = v_actor;
  if v_order.id is null then raise exception 'order_access_denied'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text || ':' || v_order.mentor_id::text, 0));
  select * into v_order from public.mentor_orders where id = p_order_id for update;
  if v_order.status = 'cancelled' then return v_order.id; end if;
  if v_order.payment_method_id is null or v_order.payment_provider is distinct from 'manual' then raise exception 'order_payment_route_invalid'; end if;
  if v_order.status <> 'pending' or exists (select 1 from public.mentor_payment_claims where order_id = p_order_id) then
    raise exception 'order_not_cancellable';
  end if;
  update public.mentor_orders set status = 'cancelled', updated_at = now() where id = p_order_id;
  return p_order_id;
end;
$$;

create or replace function public.review_mentor_payment_claim(p_claim_id uuid, p_confirm boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_claim public.mentor_payment_claims%rowtype; v_order public.mentor_orders%rowtype; v_thread_id uuid; v_owner uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not public.account_is_active() then raise exception 'account_ineligible'; end if;
  select claims.* into v_claim from public.mentor_payment_claims claims
    join public.mentor_profiles mentors on mentors.id = claims.mentor_id
    where claims.id = p_claim_id and mentors.owner_id = auth.uid();
  if v_claim.id is null then raise exception 'claim_access_denied'; end if;
  select owner_id into v_owner from public.mentor_profiles where id = v_claim.mentor_id and owner_id = auth.uid() for share;
  if v_owner is null then raise exception 'claim_access_denied'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_claim.buyer_id::text || ':' || v_claim.mentor_id::text, 0));
  select * into v_order from public.mentor_orders where id = v_claim.order_id for update;
  select * into v_claim from public.mentor_payment_claims where id = p_claim_id for update;
  if v_claim.status <> 'submitted' then raise exception 'claim_already_reviewed'; end if;
  if v_order.status <> 'pending' then raise exception 'order_not_pending'; end if;
  if p_confirm is null then raise exception 'review_confirmation_required'; end if;
  update public.mentor_payment_claims set status = case when p_confirm then 'confirmed' else 'rejected' end,
    reviewed_at = now(), reviewer_id = auth.uid() where id = p_claim_id;
  update public.mentor_orders set status = case when p_confirm then 'paid' else 'failed' end,
    paid_at = case when p_confirm then now() else paid_at end, updated_at = now() where id = v_order.id;
  if p_confirm then
    select threads.id into v_thread_id from public.mentor_threads threads
      join public.mentor_entitlements rights on rights.id = threads.entitlement_id where rights.order_id = v_order.id;
  end if;
  return v_thread_id;
end;
$$;

create or replace function public.activate_paid_mentor_order()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_offer public.mentor_offers%rowtype; v_entitlement_id uuid;
begin
  if new.status = 'paid' and old.status is distinct from 'paid' then
    select * into v_offer from public.mentor_offers where id = new.offer_id;
    insert into public.mentor_entitlements(order_id, student_id, mentor_id, weekly_question_limit, starts_at, ends_at, status)
    values (new.id, new.buyer_id, new.mentor_id, coalesce(new.weekly_questions_snapshot, v_offer.weekly_questions),
      coalesce(new.paid_at, now()), coalesce(new.paid_at, now()) + make_interval(days => coalesce(new.duration_days_snapshot, v_offer.duration_days)), 'active')
    on conflict (order_id) do update set status = excluded.status, starts_at = excluded.starts_at, ends_at = excluded.ends_at
    returning id into v_entitlement_id;
    insert into public.mentor_threads(entitlement_id, student_id, mentor_id)
    values (v_entitlement_id, new.buyer_id, new.mentor_id) on conflict (entitlement_id) do nothing;
  elsif new.status in ('refunded', 'cancelled') and old.status = 'paid' then
    update public.mentor_entitlements set status = case when new.status = 'refunded' then 'refunded' else 'revoked' end where order_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.create_manual_mentor_order(uuid, uuid) from public, anon;
revoke all on function public.create_mentor_order(uuid) from public, anon;
revoke all on function public.submit_mentor_payment_claim(uuid, text) from public, anon;
revoke all on function public.submit_manual_mentor_payment(uuid, uuid, text, uuid, jsonb) from public, anon;
revoke all on function public.cancel_unsubmitted_mentor_order(uuid, boolean) from public, anon;
revoke all on function public.review_mentor_payment_claim(uuid, boolean) from public, anon;
grant execute on function public.create_manual_mentor_order(uuid, uuid) to authenticated;
grant execute on function public.create_mentor_order(uuid) to authenticated;
grant execute on function public.submit_mentor_payment_claim(uuid, text) to authenticated;
grant execute on function public.submit_manual_mentor_payment(uuid, uuid, text, uuid, jsonb) to authenticated;
grant execute on function public.cancel_unsubmitted_mentor_order(uuid, boolean) to authenticated;
grant execute on function public.review_mentor_payment_claim(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
commit;
