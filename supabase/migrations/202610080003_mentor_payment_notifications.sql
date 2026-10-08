begin;

-- Private transactional outbox. No network operation belongs in the claim
-- transaction; an unconfigured or unavailable mail provider cannot undo it.
create table public.mentor_payment_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null unique references public.mentor_payment_claims(id) on delete cascade,
  order_id uuid not null references public.mentor_orders(id) on delete cascade,
  mentor_id uuid not null references public.mentor_profiles(id) on delete restrict,
  recipient_owner_id uuid references public.profiles(id) on delete set null,
  event_key text not null unique,
  offer_name text not null,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null,
  submitted_at timestamptz not null,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'waiting_retry', 'accepted', 'failed', 'skipped')),
  attempts integer not null default 0 check (attempts between 0 and 6),
  available_at timestamptz not null default now(),
  lease_token uuid,
  locked_until timestamptz,
  first_request_at timestamptz,
  -- Freeze the exact request before sending: provider retries must use the
  -- same recipient, from, and content even if catalog/configuration changes.
  email_payload jsonb,
  provider_message_id uuid,
  provider_accepted_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index mentor_payment_notification_queue_idx
  on public.mentor_payment_notification_outbox(available_at, created_at)
  where status in ('queued', 'waiting_retry', 'processing');

alter table public.mentor_payment_notification_outbox enable row level security;
revoke all on public.mentor_payment_notification_outbox from public, anon, authenticated;
grant select on public.mentor_payment_notification_outbox to service_role;

create function public.enqueue_mentor_payment_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'submitted' then
    insert into public.mentor_payment_notification_outbox (
      claim_id, order_id, mentor_id, recipient_owner_id, event_key,
      offer_name, amount_cents, currency, submitted_at
    )
    select new.id, order_row.id, mentor.id, mentor.owner_id,
      'mentor-payment-claim:' || new.id::text,
      coalesce(order_row.offer_name_snapshot, offer.name), order_row.amount_cents, order_row.currency, new.submitted_at
    from public.mentor_orders order_row
    join public.mentor_profiles mentor on mentor.id = order_row.mentor_id
    join public.mentor_offers offer on offer.id = order_row.offer_id
    where order_row.id = new.order_id
      and order_row.buyer_id = new.buyer_id
      and order_row.mentor_id = new.mentor_id
      and order_row.status = 'pending'
    on conflict (claim_id) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.enqueue_mentor_payment_notification() from public, anon, authenticated;

create trigger mentor_payment_claim_notification_after_insert
after insert on public.mentor_payment_claims
for each row execute function public.enqueue_mentor_payment_notification();

-- No backfill: installing this migration must not send historical reminders.
create function public.claim_mentor_payment_notifications(p_batch_size integer default 5)
returns setof public.mentor_payment_notification_outbox
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.mentor_payment_notification_outbox
  set status = 'failed', last_error_code = 'retry_exhausted',
      lease_token = null, locked_until = null, updated_at = now()
  where status = 'processing' and locked_until <= now() and attempts >= 6;

  return query
  with candidates as (
    select outbox.id
    from public.mentor_payment_notification_outbox outbox
    where outbox.attempts < 6 and (
      (outbox.status in ('queued', 'waiting_retry') and outbox.available_at <= now())
      or (outbox.status = 'processing' and outbox.locked_until <= now())
    )
    order by outbox.created_at, outbox.id
    for update skip locked
    limit least(greatest(coalesce(p_batch_size, 5), 1), 5)
  )
  update public.mentor_payment_notification_outbox outbox
  set status = 'processing', attempts = outbox.attempts + 1,
      lease_token = gen_random_uuid(), locked_until = now() + interval '5 minutes',
      updated_at = now()
  from candidates
  where outbox.id = candidates.id
  returning outbox.*;
end;
$$;

create function public.prepare_mentor_payment_notification(
  p_id uuid, p_lease_token uuid, p_from text, p_manage_url text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  notification public.mentor_payment_notification_outbox%rowtype;
  current_owner uuid;
  recipient_email text;
  recipient_confirmed_at timestamptz;
  pending boolean;
  prepared_payload jsonb;
begin
  select * into notification
  from public.mentor_payment_notification_outbox
  where id = p_id and status = 'processing'
    and lease_token = p_lease_token and locked_until > now()
  for update;
  if notification.id is null then return jsonb_build_object('state', 'lease_lost'); end if;

  select claim.status = 'submitted' and order_row.status = 'pending', mentor.owner_id
  into pending, current_owner
  from public.mentor_payment_claims claim
  join public.mentor_orders order_row on order_row.id = claim.order_id
  join public.mentor_profiles mentor on mentor.id = order_row.mentor_id
  where claim.id = notification.claim_id and order_row.id = notification.order_id;

  if pending is distinct from true then
    update public.mentor_payment_notification_outbox
    set status = 'skipped', last_error_code = 'claim_resolved',
        lease_token = null, locked_until = null, updated_at = now()
    where id = notification.id;
    return jsonb_build_object('state', 'skipped');
  end if;

  if current_owner is null or notification.recipient_owner_id is null then
    return jsonb_build_object('state', 'unavailable', 'code', 'recipient_unavailable');
  end if;
  if current_owner is distinct from notification.recipient_owner_id then
    return jsonb_build_object('state', 'unavailable', 'code', 'recipient_changed');
  end if;

  select email, email_confirmed_at into recipient_email, recipient_confirmed_at
  from auth.users where id = current_owner;
  if recipient_confirmed_at is null or recipient_email is null
    or recipient_email !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'
  then
    return jsonb_build_object('state', 'unavailable', 'code', 'recipient_unavailable');
  end if;

  -- Resend caches an idempotent request for 24h. A conservative 23h limit
  -- prevents an unresolved request from being resent after that protection.
  if notification.first_request_at < now() - interval '23 hours' then
    return jsonb_build_object('state', 'unavailable', 'code', 'idempotency_window_expired');
  end if;

  if notification.email_payload is not null then
    if notification.email_payload->'to'->>0 is distinct from recipient_email then
      return jsonb_build_object('state', 'unavailable', 'code', 'recipient_changed');
    end if;
    return jsonb_build_object('state', 'ready', 'payload', notification.email_payload);
  end if;

  if p_from is null or p_from ~ '[\r\n]' or length(p_from) > 320
    or p_manage_url is null or p_manage_url !~ '^https://[^[:space:]?#]+/mentor/manage$'
  then
    raise exception 'notification_configuration_invalid';
  end if;

  prepared_payload := jsonb_build_object(
    'from', p_from,
    'to', jsonb_build_array(recipient_email),
    'subject', 'WaveKB：学员声明已付款，待核实',
    'text', '学员已提交付款声明，请您核实是否实际到账。' || E'\n\n'
      || '订单编号：' || notification.order_id::text || E'\n'
      || '辅导方案：' || notification.offer_name || E'\n'
      || '声明金额：' || (notification.amount_cents::numeric / 100)::text
      || ' ' || notification.currency || E'\n'
      || '提交时间（UTC）：'
      || to_char(notification.submitted_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') || E'\n\n'
      || '这封邮件仅提醒您核对，不代表平台已确认到账。请在实际收款后登录确认；'
      || '确认后服务器才会发放辅导权益。' || E'\n'
      || '管理付款声明：' || p_manage_url
  );
  update public.mentor_payment_notification_outbox
  set email_payload = prepared_payload, first_request_at = now(), updated_at = now()
  where id = notification.id;
  return jsonb_build_object('state', 'ready', 'payload', prepared_payload);
end;
$$;

create function public.finish_mentor_payment_notification(
  p_id uuid, p_lease_token uuid, p_outcome text,
  p_provider_message_id uuid default null,
  p_error_code text default null, p_retryable boolean default false,
  p_retry_after_seconds integer default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  notification public.mentor_payment_notification_outbox%rowtype;
  safe_error text;
begin
  select * into notification
  from public.mentor_payment_notification_outbox
  where id = p_id and status = 'processing'
    and lease_token = p_lease_token and locked_until > now()
  for update;
  if notification.id is null then return false; end if;
  if p_outcome = 'accepted' then
    if p_provider_message_id is null or notification.email_payload is null then
      raise exception 'notification_acceptance_invalid';
    end if;
    update public.mentor_payment_notification_outbox
    set status = 'accepted', provider_message_id = p_provider_message_id,
        provider_accepted_at = now(), last_error_code = null,
        lease_token = null, locked_until = null, updated_at = now()
    where id = p_id;
  elsif p_outcome = 'failed' then
    safe_error := case when p_error_code in (
      'recipient_unavailable', 'recipient_changed', 'idempotency_window_expired',
      'provider_rate_limited', 'provider_unavailable', 'provider_unauthorized',
      'provider_rejected', 'provider_response_invalid', 'worker_request_failed'
    ) then p_error_code else 'worker_request_failed' end;
    update public.mentor_payment_notification_outbox
    set status = case when p_retryable and attempts < 6 then 'waiting_retry' else 'failed' end,
        available_at = now() + make_interval(secs => greatest(
          least(1800, (30 * power(2, attempts - 1))::integer),
          least(1800, greatest(0, coalesce(p_retry_after_seconds, 0)))
        )),
        last_error_code = safe_error,
        lease_token = null, locked_until = null, updated_at = now()
    where id = p_id;
  else
    raise exception 'notification_outcome_invalid';
  end if;
  return true;
end;
$$;

revoke all on function public.claim_mentor_payment_notifications(integer) from public, anon, authenticated;
revoke all on function public.prepare_mentor_payment_notification(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.finish_mentor_payment_notification(uuid, uuid, text, uuid, text, boolean, integer) from public, anon, authenticated;
grant execute on function public.claim_mentor_payment_notifications(integer) to service_role;
grant execute on function public.prepare_mentor_payment_notification(uuid, uuid, text, text) to service_role;
grant execute on function public.finish_mentor_payment_notification(uuid, uuid, text, uuid, text, boolean, integer) to service_role;

create or replace function public.wavekb_schema_version()
returns text language sql stable security definer set search_path = ''
as $$ select '202610080003'::text; $$;
revoke all on function public.wavekb_schema_version() from public;
grant execute on function public.wavekb_schema_version() to anon, authenticated;

notify pgrst, 'reload schema';
commit;
