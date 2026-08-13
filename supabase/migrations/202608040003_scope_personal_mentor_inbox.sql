-- Personal messenger hardening:
-- 1. Admin accounts do not inherit every mentor's students/payment notices.
-- 2. Avoid PL/pgSQL variable/column ambiguity when activating an entitlement.

create or replace function public.list_my_mentor_students()
returns table (
  thread_id uuid,
  student_id uuid,
  public_uid integer,
  display_name text,
  avatar_url text,
  bio text,
  display_title text,
  nameplate_style text,
  access_status text,
  last_message text,
  last_message_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    thread.id,
    student.id,
    student.public_uid,
    student.display_name,
    student.avatar_url,
    student.bio,
    student.display_title,
    student.nameplate_style,
    case
      when entitlement.status = 'active' and entitlement.ends_at > now() then 'active'
      when entitlement.status = 'active' then 'expired'
      else entitlement.status
    end,
    latest.body,
    latest.created_at
  from public.mentor_threads thread
  join public.mentor_profiles mentor on mentor.id = thread.mentor_id
  join public.mentor_entitlements entitlement on entitlement.id = thread.entitlement_id
  join public.profiles student on student.id = thread.student_id
  left join lateral (
    select message.body, message.created_at
    from public.mentor_messages message
    where message.thread_id = thread.id
    order by message.created_at desc
    limit 1
  ) latest on true
  where mentor.owner_id = auth.uid()
  order by coalesce(latest.created_at, thread.updated_at) desc;
$$;

create or replace function public.list_my_mentor_payment_claims()
returns table (
  claim_id uuid,
  order_id uuid,
  buyer_id uuid,
  public_uid integer,
  display_name text,
  avatar_url text,
  offer_name text,
  amount_cents integer,
  currency text,
  payment_label text,
  buyer_note text,
  status text,
  submitted_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select claim.id, claim.order_id, claim.buyer_id, buyer.public_uid,
    buyer.display_name, buyer.avatar_url, offer.name, order_row.amount_cents,
    order_row.currency, method.label, claim.buyer_note, claim.status, claim.submitted_at
  from public.mentor_payment_claims claim
  join public.mentor_profiles mentor on mentor.id = claim.mentor_id
  join public.mentor_orders order_row on order_row.id = claim.order_id
  join public.mentor_offers offer on offer.id = order_row.offer_id
  join public.profiles buyer on buyer.id = claim.buyer_id
  left join public.mentor_payment_methods method on method.id = claim.payment_method_id
  where mentor.owner_id = auth.uid()
  order by (claim.status = 'submitted') desc, claim.submitted_at desc;
$$;

create or replace function public.review_mentor_payment_claim(
  p_claim_id uuid,
  p_confirm boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_claim public.mentor_payment_claims%rowtype;
  v_thread_id uuid;
begin
  select claim.* into selected_claim
  from public.mentor_payment_claims claim
  join public.mentor_profiles mentor on mentor.id = claim.mentor_id
  where claim.id = p_claim_id
    and mentor.owner_id = auth.uid()
  for update;

  if selected_claim.id is null then raise exception 'claim_access_denied'; end if;
  if selected_claim.status <> 'submitted' then raise exception 'claim_already_reviewed'; end if;

  update public.mentor_payment_claims
  set status = case when p_confirm then 'confirmed' else 'rejected' end,
      reviewed_at = now(),
      reviewer_id = auth.uid()
  where id = selected_claim.id;

  if p_confirm then
    update public.mentor_orders
    set status = 'paid', paid_at = now(), updated_at = now()
    where id = selected_claim.order_id and status = 'pending';

    select thread.id into v_thread_id
    from public.mentor_threads thread
    join public.mentor_entitlements entitlement
      on entitlement.id = thread.entitlement_id
    where entitlement.order_id = selected_claim.order_id;
  end if;

  return v_thread_id;
end;
$$;

create or replace function public.activate_paid_mentor_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_offer public.mentor_offers%rowtype;
  v_entitlement_id uuid;
begin
  if new.status = 'paid' and old.status is distinct from 'paid' then
    select offer.* into selected_offer
    from public.mentor_offers offer
    where offer.id = new.offer_id;

    insert into public.mentor_entitlements (
      order_id, student_id, mentor_id, weekly_question_limit,
      starts_at, ends_at, status
    )
    values (
      new.id, new.buyer_id, new.mentor_id, selected_offer.weekly_questions,
      coalesce(new.paid_at, now()),
      coalesce(new.paid_at, now()) + make_interval(days => selected_offer.duration_days),
      'active'
    )
    on conflict (order_id) do update set
      status = excluded.status,
      starts_at = excluded.starts_at,
      ends_at = excluded.ends_at
    returning id into v_entitlement_id;

    insert into public.mentor_threads (entitlement_id, student_id, mentor_id)
    values (v_entitlement_id, new.buyer_id, new.mentor_id)
    on conflict (entitlement_id) do nothing;
  elsif new.status in ('refunded', 'cancelled') and old.status = 'paid' then
    update public.mentor_entitlements
    set status = case when new.status = 'refunded' then 'refunded' else 'revoked' end
    where order_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.list_my_mentor_students() from public;
revoke all on function public.list_my_mentor_payment_claims() from public;
revoke all on function public.review_mentor_payment_claim(uuid, boolean) from public;
grant execute on function public.list_my_mentor_students() to authenticated;
grant execute on function public.list_my_mentor_payment_claims() to authenticated;
grant execute on function public.review_mentor_payment_claim(uuid, boolean) to authenticated;
