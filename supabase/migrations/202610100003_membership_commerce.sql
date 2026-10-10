-- Independent, one-time membership commerce. Confirmed prices may be public;
-- billing remains disabled. No subscriptions or changes to public-content access.
begin;

alter table public.membership_plans
  add column ai_daily_limit integer not null default 0 check (ai_daily_limit between 0 and 10000),
  add column mentor_discount_bps integer not null default 0 check (mentor_discount_bps between 0 and 9900);

create table public.membership_commerce_settings (
  singleton boolean primary key default true check (singleton),
  billing_enabled boolean not null default false,
  payment_mode text not null default 'test' check (payment_mode in ('test','live')),
  revision integer not null default 1 check (revision>0),
  updated_at timestamptz not null default now()
);
insert into public.membership_commerce_settings(singleton) values(true);
create table public.membership_prices (
  id uuid primary key default gen_random_uuid(),
  plan_key text not null references public.membership_plans(key) on delete restrict,
  term_months integer not null check (term_months in (1,12)),
  amount_minor bigint not null check (amount_minor between 1 and 100000000),
  currency text not null check (currency in ('USD','CNY','HKD')),
  published boolean not null default false,
  revision integer not null default 1 check (revision>0),
  updated_at timestamptz not null default now(),
  unique(plan_key,term_months,currency)
);
-- Publish the confirmed product only when the operator has not changed the
-- original disabled foundation seed. Existing custom plans remain untouched.
do $$
declare v_pristine boolean;
begin
  update public.membership_plans set enabled=true,ai_daily_limit=50,mentor_discount_bps=1000,
    description='月度或年度单次购买，不自动续费；价格与权益可由后台调整，支付开放前不可购买。',
    benefits='{"ai_daily_analysis":"平台每日额度以方案数值为准（平台服务开放后可用；不限制自带 Key）","mentor_discount":"导师会员优惠以服务端结算报价为准"}',
    revision=revision+1,updated_at=now()
    where key='vip' and revision=1 and not enabled and title='VIP 会员'
      and description='会员方案待确认；未开放购买，不影响现有公开内容。' and benefits='{}'::jsonb;
  v_pristine:=found;
  insert into public.membership_prices(plan_key,term_months,amount_minor,currency,published) values
    ('vip',1,5200,'USD',v_pristine),('vip',12,52000,'USD',v_pristine);
end;
$$;

create table public.membership_orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles(id) on delete restrict,
  request_id uuid not null unique,
  price_id uuid not null references public.membership_prices(id) on delete restrict,
  plan_key text not null references public.membership_plans(key) on delete restrict,
  price_revision integer not null check (price_revision>0),
  plan_revision integer not null check (plan_revision>0),
  amount_minor bigint not null check (amount_minor between 1 and 100000000),
  currency text not null check (currency in ('USD','CNY','HKD')),
  term_months integer not null check (term_months in (1,12)),
  payment_mode text not null check (payment_mode in ('test','live')),
  status text not null default 'pending' check (status in ('pending','paid','expired','failed','refunded')),
  title_snapshot text not null,
  description_snapshot text not null,
  benefits_snapshot jsonb not null,
  ai_daily_limit_snapshot integer not null check (ai_daily_limit_snapshot between 0 and 10000),
  mentor_discount_bps_snapshot integer not null check (mentor_discount_bps_snapshot between 0 and 10000),
  expected_quote jsonb not null,
  provider_session_id text unique check (provider_session_id ~ '^cs_[A-Za-z0-9_]+$'),
  provider_payment_intent_id text unique check (provider_payment_intent_id ~ '^pi_[A-Za-z0-9_]+$'),
  checkout_url text,
  checkout_expires_at timestamptz check (isfinite(checkout_expires_at)),
  paid_at timestamptz check (isfinite(paid_at)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index membership_one_pending_plan on public.membership_orders(buyer_id,plan_key) where status='pending';
create index membership_orders_buyer_time on public.membership_orders(buyer_id,created_at desc);
create table public.membership_purchase_grants (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.membership_orders(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  plan_key text not null references public.membership_plans(key) on delete restrict,
  status text not null default 'active' check (status in ('active','revoked')),
  starts_at timestamptz not null check (isfinite(starts_at)),
  ends_at timestamptz not null check (isfinite(ends_at) and ends_at>starts_at),
  title_snapshot text not null,
  benefits_snapshot jsonb not null,
  ai_daily_limit_snapshot integer not null check (ai_daily_limit_snapshot between 0 and 10000),
  mentor_discount_bps_snapshot integer not null check (mentor_discount_bps_snapshot between 0 and 10000),
  created_at timestamptz not null default now()
);
create index membership_purchase_grants_user on public.membership_purchase_grants(user_id,plan_key,ends_at);
create table public.membership_payment_events (
  event_id text primary key check (event_id ~ '^evt_[A-Za-z0-9_]+$'),
  order_id uuid not null references public.membership_orders(id) on delete restrict,
  event_type text not null,
  request jsonb not null,
  outcome text not null,
  created_at timestamptz not null default now()
);
create table public.membership_refunds (
  refund_id text primary key check (refund_id ~ '^re_[A-Za-z0-9_]+$'),
  order_id uuid not null references public.membership_orders(id) on delete restrict,
  payment_intent_id text not null,
  amount_minor bigint not null check (amount_minor>0),
  currency text not null check (currency in ('USD','CNY','HKD')),
  status text not null check (status in ('pending','succeeded','failed','canceled')),
  updated_at timestamptz not null default now()
);
create table public.membership_commerce_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  action text not null check (action in ('price_updated','entitlements_updated','settings_updated')),
  reason text not null check (length(public.membership_trim_text(reason)) between 3 and 500),
  request jsonb not null,
  before_state jsonb,
  after_state jsonb not null,
  created_at timestamptz not null default now()
);
-- Even a service JWT cannot bypass the transaction RPCs with a direct table write.
alter table public.membership_commerce_settings enable row level security;
alter table public.membership_prices enable row level security;
alter table public.membership_orders enable row level security;
alter table public.membership_purchase_grants enable row level security;
alter table public.membership_payment_events enable row level security;
alter table public.membership_refunds enable row level security;
alter table public.membership_commerce_events enable row level security;
revoke all on public.membership_commerce_settings,public.membership_prices,public.membership_orders,
  public.membership_purchase_grants,public.membership_payment_events,public.membership_refunds,
  public.membership_commerce_events from public,anon,authenticated,service_role;

create function public.membership_user_is_eligible(p_user_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p join auth.users u on u.id=p.id
    where p.id=p_user_id and p.account_status='active' and p.public_uid is not null and u.email_confirmed_at is not null);
$$;
create function public.membership_commerce_plan(p_key text)
returns jsonb language sql stable security definer set search_path='' as $$
  select to_jsonb(p)||jsonb_build_object('prices',coalesce((select jsonb_agg(to_jsonb(x) order by x.term_months,x.currency)
    from public.membership_prices x where x.plan_key=p.key),'[]'::jsonb)) from public.membership_plans p where p.key=p_key;
$$;
create function public.membership_order_receipt(p_order_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select (to_jsonb(o)-'expected_quote'-'provider_payment_intent_id')||jsonb_build_object('livemode',o.payment_mode='live')
    from public.membership_orders o where o.id=p_order_id;
$$;
create function public.get_membership_payment_route(p_order_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',o.id,'buyer_id',o.buyer_id,'provider_session_id',o.provider_session_id,
    'payment_intent_id',o.provider_payment_intent_id,'payment_mode',o.payment_mode,'livemode',o.payment_mode='live',
    'amount_minor',o.amount_minor,'currency',o.currency) from public.membership_orders o where o.id=p_order_id;
$$;
create function public.membership_effective_entitlements(p_user_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  with eligible as (select public.membership_user_is_eligible(p_user_id) as value), sources as (
    select g.plan_key,p.ai_daily_limit,p.mentor_discount_bps
    from public.membership_grants g join public.membership_plans p on p.key=g.plan_key
    where g.user_id=p_user_id and g.status='active' and p.enabled and g.starts_at<=now() and g.ends_at>now()
    union all
    select g.plan_key,g.ai_daily_limit_snapshot,g.mentor_discount_bps_snapshot
    from public.membership_purchase_grants g join public.membership_plans p on p.key=g.plan_key
      join public.membership_orders o on o.id=g.order_id
    where g.user_id=p_user_id and g.status='active' and p.enabled and g.starts_at<=now() and g.ends_at>now()
      and o.status='paid' and o.payment_mode='live'
  ) select jsonb_build_object('user_id',p_user_id,'eligible',e.value,
      'has_vip',e.value and exists(select 1 from sources where plan_key='vip'),
      'ai_daily_limit',case when e.value then coalesce((select max(ai_daily_limit) from sources),0) else 0 end,
      'mentor_discount_bps',case when e.value then coalesce((select max(mentor_discount_bps) from sources),0) else 0 end)
    from eligible e;
$$;
create function public.get_effective_membership_entitlements(p_actor_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if p_actor_id is null or p_actor_id is distinct from auth.uid() then raise exception 'authentication_required'; end if;
  return public.membership_effective_entitlements(p_actor_id);
end;
$$;
create function public.get_effective_membership_entitlements_for_user(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if p_user_id is null then raise exception 'membership_input_invalid'; end if;
  return public.membership_effective_entitlements(p_user_id);
end;
$$;
-- Preserve the original manual-label API; paid labels are immutable purchase snapshots.
create or replace function public.has_membership_entitlement(p_key text)
returns boolean language sql stable security definer set search_path='' as $$
  select public.membership_user_is_eligible(auth.uid()) and (
    exists(select 1 from public.membership_grants g join public.membership_plans p on p.key=g.plan_key
      where g.user_id=auth.uid() and g.status='active' and p.enabled and g.starts_at<=now() and g.ends_at>now() and p.benefits ? p_key)
    or exists(select 1 from public.membership_purchase_grants g join public.membership_plans p on p.key=g.plan_key
      join public.membership_orders o on o.id=g.order_id where g.user_id=auth.uid() and g.status='active' and p.enabled
        and g.starts_at<=now() and g.ends_at>now() and o.status='paid' and o.payment_mode='live' and g.benefits_snapshot ? p_key));
$$;
create function public.list_membership_catalog()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('billing_enabled',s.billing_enabled,'payment_mode',s.payment_mode,'settings_revision',s.revision,
    'purchase_available',s.billing_enabled and exists(select 1 from public.membership_prices x join public.membership_plans p on p.key=x.plan_key where x.published and p.enabled),
    'plans',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('prices',coalesce((select jsonb_agg(to_jsonb(x) order by x.term_months,x.currency)
      from public.membership_prices x where x.plan_key=p.key and x.published),'[]'::jsonb)) order by p.key)
      from public.membership_plans p where p.enabled),'[]'::jsonb)) from public.membership_commerce_settings s;
$$;
create function public.get_my_membership_commerce(p_actor_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if p_actor_id is distinct from auth.uid() or not public.membership_user_is_eligible(p_actor_id) then raise exception 'account_ineligible'; end if;
  return jsonb_build_object('catalog',public.list_membership_catalog(),'effective',public.membership_effective_entitlements(p_actor_id),
    'orders',coalesce((select jsonb_agg(public.membership_order_receipt(o.id) order by o.created_at desc)
      from (select * from public.membership_orders where buyer_id=p_actor_id order by created_at desc limit 50) o),'[]'::jsonb),
    'purchase_grants',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'order_id',g.order_id,'plan_key',g.plan_key,
      'title',g.title_snapshot,'benefits',g.benefits_snapshot,'ai_daily_limit',g.ai_daily_limit_snapshot,'mentor_discount_bps',g.mentor_discount_bps_snapshot,
      'starts_at',g.starts_at,'ends_at',g.ends_at,'status',case when g.status='revoked' or o.status='refunded' then 'revoked'
        when o.payment_mode='test' then 'test' when not p.enabled then 'disabled' when g.starts_at>now() then 'scheduled'
        when g.ends_at<=now() then 'expired' else 'active' end) order by g.ends_at desc)
      from public.membership_purchase_grants g join public.membership_plans p on p.key=g.plan_key join public.membership_orders o on o.id=g.order_id
      where g.user_id=p_actor_id),'[]'::jsonb));
end;
$$;
create function public.admin_membership_commerce_store(p_actor_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_admin() or p_actor_id is distinct from auth.uid() then raise exception 'admin_required'; end if;
  return jsonb_build_object('settings',(select to_jsonb(s)-'singleton' from public.membership_commerce_settings s),
    'plans',coalesce((select jsonb_agg(public.membership_commerce_plan(p.key) order by p.key) from public.membership_plans p),'[]'::jsonb),
    'history',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'reason',e.reason,'created_at',e.created_at) order by e.created_at desc)
      from (select * from public.membership_commerce_events order by created_at desc limit 50) e),'[]'::jsonb));
end;
$$;

create function public.admin_save_membership_price(p_price_id uuid,p_plan_key text,p_term_months integer,p_amount_minor bigint,p_currency text,
  p_published boolean,p_expected_revision integer,p_reason text,p_request_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_before public.membership_prices; v_after public.membership_prices; v_event public.membership_commerce_events; v_request jsonb;
begin
  if not public.is_admin() or p_actor_id is distinct from auth.uid() then raise exception 'admin_required'; end if;
  if p_price_id is null or p_plan_key is null or p_term_months is null or p_term_months not in (1,12) or p_amount_minor is null or p_amount_minor not between 1 and 100000000
    or p_currency is null or p_currency not in ('USD','CNY','HKD') or p_published is null or p_expected_revision is null or p_expected_revision<0
    or p_request_id is null or p_reason is null or length(public.membership_trim_text(p_reason)) not between 3 and 500 then raise exception 'membership_input_invalid'; end if;
  v_request:=jsonb_build_object('id',p_price_id,'plan_key',p_plan_key,'term_months',p_term_months,'amount_minor',p_amount_minor,'currency',p_currency,'published',p_published,'revision',p_expected_revision,'reason',p_reason);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('commerce_request:'||p_request_id::text,0));
  select * into v_event from public.membership_commerce_events where request_id=p_request_id;
  if found then
    if v_event.actor_id is distinct from p_actor_id or v_event.action<>'price_updated' or v_event.request<>v_request then raise exception 'request_conflict'; end if;
    return v_event.after_state;
  end if;
  perform 1 from public.membership_plans where key=p_plan_key for share;
  if not found then raise exception 'membership_plan_not_found'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('membership_price:'||p_price_id::text,0));
  select * into v_before from public.membership_prices where id=p_price_id for update;
  if coalesce(v_before.revision,0)<>p_expected_revision then raise exception 'membership_changed_concurrently'; end if;
  if v_before.id is not null and (v_before.plan_key<>p_plan_key or v_before.term_months<>p_term_months or v_before.currency<>p_currency) then raise exception 'membership_price_identity_immutable'; end if;
  insert into public.membership_prices(id,plan_key,term_months,amount_minor,currency,published) values(p_price_id,p_plan_key,p_term_months,p_amount_minor,p_currency,p_published)
    on conflict(id) do update set amount_minor=excluded.amount_minor,published=excluded.published,revision=membership_prices.revision+1,updated_at=now() returning * into v_after;
  insert into public.membership_commerce_events(request_id,actor_id,action,reason,request,before_state,after_state)
    values(p_request_id,p_actor_id,'price_updated',public.membership_trim_text(p_reason),v_request,case when v_before.id is null then null else to_jsonb(v_before) end,to_jsonb(v_after));
  return to_jsonb(v_after);
end;
$$;
create function public.admin_save_membership_entitlements(p_plan_key text,p_ai_daily_limit integer,p_mentor_discount_bps integer,
  p_expected_revision integer,p_reason text,p_request_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_before public.membership_plans; v_after jsonb; v_event public.membership_commerce_events; v_request jsonb;
begin
  if not public.is_admin() or p_actor_id is distinct from auth.uid() then raise exception 'admin_required'; end if;
  if p_plan_key is null or p_ai_daily_limit is null or p_ai_daily_limit not between 0 and 10000 or p_mentor_discount_bps is null or p_mentor_discount_bps not between 0 and 9900
    or p_expected_revision is null or p_expected_revision<1 or p_request_id is null or p_reason is null or length(public.membership_trim_text(p_reason)) not between 3 and 500 then raise exception 'membership_input_invalid'; end if;
  v_request:=jsonb_build_object('plan_key',p_plan_key,'ai_daily_limit',p_ai_daily_limit,'mentor_discount_bps',p_mentor_discount_bps,'revision',p_expected_revision,'reason',p_reason);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('commerce_request:'||p_request_id::text,0));
  select * into v_event from public.membership_commerce_events where request_id=p_request_id;
  if found then
    if v_event.actor_id is distinct from p_actor_id or v_event.action<>'entitlements_updated' or v_event.request<>v_request then raise exception 'request_conflict'; end if;
    return v_event.after_state;
  end if;
  select * into v_before from public.membership_plans where key=p_plan_key for update;
  if v_before.key is null then raise exception 'membership_plan_not_found'; end if;
  if v_before.revision<>p_expected_revision then raise exception 'membership_changed_concurrently'; end if;
  update public.membership_plans set ai_daily_limit=p_ai_daily_limit,mentor_discount_bps=p_mentor_discount_bps,revision=revision+1,updated_at=now() where key=p_plan_key;
  v_after:=public.membership_commerce_plan(p_plan_key);
  insert into public.membership_commerce_events(request_id,actor_id,action,reason,request,before_state,after_state)
    values(p_request_id,p_actor_id,'entitlements_updated',public.membership_trim_text(p_reason),v_request,to_jsonb(v_before),v_after);
  return v_after;
end;
$$;
create function public.admin_save_membership_commerce_settings(p_billing_enabled boolean,p_payment_mode text,p_expected_revision integer,p_reason text,p_request_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_before public.membership_commerce_settings; v_after public.membership_commerce_settings; v_event public.membership_commerce_events; v_request jsonb;
begin
  if not public.is_admin() or p_actor_id is distinct from auth.uid() then raise exception 'admin_required'; end if;
  if p_billing_enabled is null or p_payment_mode is null or p_payment_mode not in ('test','live') or p_expected_revision is null or p_expected_revision<1
    or p_request_id is null or p_reason is null or length(public.membership_trim_text(p_reason)) not between 3 and 500 then raise exception 'membership_input_invalid'; end if;
  v_request:=jsonb_build_object('billing_enabled',p_billing_enabled,'payment_mode',p_payment_mode,'revision',p_expected_revision,'reason',p_reason);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('commerce_request:'||p_request_id::text,0));
  select * into v_event from public.membership_commerce_events where request_id=p_request_id;
  if found then
    if v_event.actor_id is distinct from p_actor_id or v_event.action<>'settings_updated' or v_event.request<>v_request then raise exception 'request_conflict'; end if;
    return v_event.after_state;
  end if;
  select * into v_before from public.membership_commerce_settings where singleton for update;
  if v_before.revision<>p_expected_revision then raise exception 'membership_changed_concurrently'; end if;
  if p_payment_mode<>v_before.payment_mode and (
    exists(select 1 from public.membership_orders where status='pending')
    or (v_before.payment_mode='live' and p_payment_mode='test' and exists(select 1 from public.membership_orders where payment_mode='live' and status='paid'))
  ) then raise exception 'membership_payment_mode_locked'; end if;
  update public.membership_commerce_settings set billing_enabled=p_billing_enabled,payment_mode=p_payment_mode,revision=revision+1,updated_at=now() where singleton returning * into v_after;
  insert into public.membership_commerce_events(request_id,actor_id,action,reason,request,before_state,after_state)
    values(p_request_id,p_actor_id,'settings_updated',public.membership_trim_text(p_reason),v_request,to_jsonb(v_before),to_jsonb(v_after)-'singleton');
  return to_jsonb(v_after)-'singleton';
end;
$$;

create function public.prepare_membership_order(p_actor_id uuid,p_price_id uuid,p_request_id uuid,p_expected_quote jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_order public.membership_orders; v_price public.membership_prices; v_plan public.membership_plans; v_settings public.membership_commerce_settings; v_quote jsonb;
begin
  if p_actor_id is null or p_price_id is null or p_request_id is null or p_expected_quote is null or jsonb_typeof(p_expected_quote)<>'object' then raise exception 'membership_input_invalid'; end if;
  perform 1 from public.profiles where id=p_actor_id for no key update;
  if not public.membership_user_is_eligible(p_actor_id) then raise exception 'account_ineligible'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('membership_order_request:'||p_request_id::text,0));
  select * into v_order from public.membership_orders where request_id=p_request_id for update;
  if found then
    if v_order.buyer_id<>p_actor_id or v_order.price_id<>p_price_id or v_order.expected_quote<>p_expected_quote then raise exception 'request_conflict'; end if;
    if v_order.status='pending' then
      select * into v_settings from public.membership_commerce_settings where singleton for share;
      if not v_settings.billing_enabled then raise exception 'membership_billing_unavailable'; end if;
      if v_settings.payment_mode<>v_order.payment_mode then raise exception 'payment_mode_mismatch'; end if;
      select * into v_plan from public.membership_plans where key=v_order.plan_key for share;
      if v_plan.key is null or not v_plan.enabled then raise exception 'membership_plan_disabled'; end if;
    end if;
    return public.membership_order_receipt(v_order.id);
  end if;
  select * into v_settings from public.membership_commerce_settings where singleton for share;
  if not v_settings.billing_enabled then raise exception 'membership_billing_unavailable'; end if;
  select * into v_price from public.membership_prices where id=p_price_id for share;
  if v_price.id is null or not v_price.published then raise exception 'membership_price_unavailable'; end if;
  select * into v_plan from public.membership_plans where key=v_price.plan_key for share;
  if not v_plan.enabled then raise exception 'membership_plan_disabled'; end if;
  v_quote:=jsonb_build_object('price_id',v_price.id,'plan_key',v_plan.key,'price_revision',v_price.revision,'plan_revision',v_plan.revision,
    'amount_minor',v_price.amount_minor,'currency',v_price.currency,'term_months',v_price.term_months);
  if p_expected_quote<>v_quote then raise exception 'membership_quote_changed'; end if;
  if exists(select 1 from public.membership_orders where buyer_id=p_actor_id and plan_key=v_plan.key and status='pending') then raise exception 'membership_pending_order_exists'; end if;
  insert into public.membership_orders(buyer_id,request_id,price_id,plan_key,price_revision,plan_revision,amount_minor,currency,term_months,payment_mode,
    title_snapshot,description_snapshot,benefits_snapshot,ai_daily_limit_snapshot,mentor_discount_bps_snapshot,expected_quote)
    values(p_actor_id,p_request_id,v_price.id,v_plan.key,v_price.revision,v_plan.revision,v_price.amount_minor,v_price.currency,v_price.term_months,v_settings.payment_mode,
      v_plan.title,v_plan.description,v_plan.benefits,v_plan.ai_daily_limit,v_plan.mentor_discount_bps,v_quote) returning * into v_order;
  return public.membership_order_receipt(v_order.id);
end;
$$;
create function public.register_membership_checkout_session(p_actor_id uuid,p_order_id uuid,p_session_id text,p_checkout_url text,p_expires_at timestamptz,p_livemode boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_order public.membership_orders;
begin
  perform 1 from public.profiles where id=p_actor_id for no key update;
  if p_actor_id is null or not public.membership_user_is_eligible(p_actor_id) then raise exception 'account_ineligible'; end if;
  if p_session_id is null or p_session_id !~ '^cs_[A-Za-z0-9_]+$' or p_checkout_url is null
    or p_checkout_url !~ '^https://checkout\.stripe\.com/[A-Za-z0-9_/?#=.%:+-]+$'
    or p_expires_at is null or not isfinite(p_expires_at) or p_livemode is null then raise exception 'payment_session_invalid'; end if;
  select * into v_order from public.membership_orders where id=p_order_id for update;
  if v_order.id is null or v_order.buyer_id<>p_actor_id then raise exception 'order_access_denied'; end if;
  if (v_order.payment_mode='live') is distinct from p_livemode then raise exception 'payment_mode_mismatch'; end if;
  if v_order.provider_session_id is not null then
    if v_order.provider_session_id<>p_session_id or v_order.checkout_url<>p_checkout_url or v_order.checkout_expires_at<>p_expires_at then raise exception 'order_payment_route_invalid'; end if;
    return public.membership_order_receipt(v_order.id);
  end if;
  if v_order.status<>'pending' then raise exception 'order_not_payable'; end if;
  if p_expires_at<=now() then raise exception 'payment_session_invalid'; end if;
  update public.membership_orders set provider_session_id=p_session_id,checkout_url=p_checkout_url,checkout_expires_at=p_expires_at,updated_at=now() where id=p_order_id;
  return public.membership_order_receipt(p_order_id);
end;
$$;

create function public.apply_verified_membership_payment_event(p_event_id text,p_event_type text,p_order_id uuid,p_buyer_id uuid,p_session_id text,
  p_payment_intent_id text,p_amount_minor bigint,p_currency text,p_payment_status text,p_livemode boolean,p_paid_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_order public.membership_orders; v_event public.membership_payment_events; v_request jsonb; v_outcome text; v_grant uuid; v_start timestamptz;
begin
  if p_event_id is null or p_event_id !~ '^evt_[A-Za-z0-9_]+$' or p_session_id is null or p_session_id !~ '^cs_[A-Za-z0-9_]+$'
    or p_event_type is null or p_event_type not in ('checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired')
    or p_livemode is null or p_payment_status is null or p_payment_status not in ('paid','unpaid','no_payment_required')
    or (p_payment_intent_id is not null and p_payment_intent_id !~ '^pi_[A-Za-z0-9_]+$') then raise exception 'payment_event_invalid'; end if;
  -- Account/plan advisory lock serializes independent renewals without merging grants.
  select * into v_order from public.membership_orders where id=p_order_id;
  if v_order.id is null then raise exception 'order_not_found'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('membership_purchase:'||v_order.buyer_id::text||':'||v_order.plan_key,0));
  select * into v_order from public.membership_orders where id=p_order_id for update;
  if v_order.buyer_id is distinct from p_buyer_id or (v_order.provider_session_id is not null and v_order.provider_session_id<>p_session_id) then raise exception 'order_payment_route_invalid'; end if;
  if p_amount_minor is distinct from v_order.amount_minor or upper(coalesce(p_currency,''))<>v_order.currency then raise exception 'payment_amount_mismatch'; end if;
  if (v_order.payment_mode='live') is distinct from p_livemode then raise exception 'payment_mode_mismatch'; end if;
  if v_order.provider_payment_intent_id is not null and p_payment_intent_id is not null and v_order.provider_payment_intent_id<>p_payment_intent_id then raise exception 'order_payment_route_invalid'; end if;
  if p_event_type<>'checkout.session.expired' and p_payment_status='paid' and
    (p_payment_intent_id is null or p_paid_at is null or not isfinite(p_paid_at) or p_paid_at>now()+interval '5 minutes') then raise exception 'payment_event_invalid'; end if;
  if p_event_type='checkout.session.async_payment_failed' and (p_payment_status<>'unpaid' or p_payment_intent_id is null) then raise exception 'payment_event_invalid'; end if;
  v_request:=jsonb_build_object('type',p_event_type,'buyer_id',p_buyer_id,'session_id',p_session_id,'intent_id',p_payment_intent_id,
    'amount_minor',p_amount_minor,'currency',upper(p_currency),'payment_status',p_payment_status,'livemode',p_livemode,'paid_at',p_paid_at);
  select * into v_event from public.membership_payment_events where event_id=p_event_id;
  if found then
    if v_event.order_id<>p_order_id or v_event.request<>v_request then raise exception 'payment_event_conflict'; end if;
    return jsonb_build_object('duplicate',true,'applied',false,'order_id',p_order_id,'order_status',v_order.status,'grant_id',(select id from public.membership_purchase_grants where order_id=p_order_id),'outcome',v_event.outcome);
  end if;
  if v_order.provider_session_id is null then
    -- A signed + provider-verified terminal callback can recover a session whose
    -- original registration was not committed. No URL is reconstructed, no new
    -- checkout is created, and all immutable quote/owner/mode/event checks precede it.
    if v_order.status<>'pending' or (p_event_type not in ('checkout.session.expired','checkout.session.async_payment_failed') and p_payment_status<>'paid') then raise exception 'order_payment_route_invalid'; end if;
    update public.membership_orders set provider_session_id=p_session_id,updated_at=now() where id=p_order_id returning * into v_order;
  end if;
  if v_order.status in ('paid','expired','failed','refunded') then v_outcome:='ignored_order_state';
  elsif p_event_type='checkout.session.expired' then
    update public.membership_orders set status='expired',updated_at=now() where id=p_order_id; v_outcome:='expired';
  elsif p_event_type='checkout.session.async_payment_failed' then
    update public.membership_orders set status='failed',provider_payment_intent_id=p_payment_intent_id,updated_at=now() where id=p_order_id; v_outcome:='failed';
  elsif p_payment_status<>'paid' then v_outcome:='ignored_unpaid';
  else
    -- Test purchases are retained for payment integration tests, never executable VIP.
    select greatest(p_paid_at,coalesce(max(g.ends_at),p_paid_at)) into v_start from public.membership_purchase_grants g
      join public.membership_orders o on o.id=g.order_id where g.user_id=v_order.buyer_id and g.plan_key=v_order.plan_key
      and g.status='active' and o.status='paid' and o.payment_mode=v_order.payment_mode;
    update public.membership_orders set status='paid',paid_at=p_paid_at,provider_payment_intent_id=p_payment_intent_id,updated_at=now() where id=p_order_id;
    insert into public.membership_purchase_grants(order_id,user_id,plan_key,starts_at,ends_at,title_snapshot,benefits_snapshot,ai_daily_limit_snapshot,mentor_discount_bps_snapshot)
      values(p_order_id,v_order.buyer_id,v_order.plan_key,v_start,v_start+pg_catalog.make_interval(months=>v_order.term_months),v_order.title_snapshot,v_order.benefits_snapshot,
        v_order.ai_daily_limit_snapshot,v_order.mentor_discount_bps_snapshot) returning id into v_grant;
    v_outcome:='paid';
  end if;
  insert into public.membership_payment_events(event_id,order_id,event_type,request,outcome) values(p_event_id,p_order_id,p_event_type,v_request,v_outcome);
  return jsonb_build_object('duplicate',false,'applied',v_outcome in ('paid','expired','failed'),'order_id',p_order_id,
    'order_status',case when v_outcome in ('paid','expired','failed') then v_outcome else v_order.status end,'grant_id',v_grant,'outcome',v_outcome);
end;
$$;
create function public.apply_verified_membership_refund_event(p_event_id text,p_order_id uuid,p_buyer_id uuid,p_payment_intent_id text,p_refund_id text,
  p_amount_minor bigint,p_currency text,p_refund_status text,p_livemode boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_order public.membership_orders; v_refund public.membership_refunds; v_event public.membership_payment_events; v_request jsonb; v_total bigint; v_outcome text;
begin
  if p_event_id is null or p_event_id !~ '^evt_[A-Za-z0-9_]+$' or p_payment_intent_id is null or p_payment_intent_id !~ '^pi_[A-Za-z0-9_]+$'
    or p_refund_id is null or p_refund_id !~ '^re_[A-Za-z0-9_]+$' or p_amount_minor is null or p_amount_minor<=0
    or p_refund_status is null or p_refund_status not in ('pending','succeeded','failed','canceled') or p_livemode is null then raise exception 'payment_event_invalid'; end if;
  select * into v_order from public.membership_orders where id=p_order_id for update;
  if v_order.id is null then raise exception 'order_not_found'; end if;
  if v_order.buyer_id is distinct from p_buyer_id or v_order.provider_session_id is null
    or (v_order.provider_payment_intent_id is not null and v_order.provider_payment_intent_id<>p_payment_intent_id) then raise exception 'order_payment_route_invalid'; end if;
  if upper(coalesce(p_currency,''))<>v_order.currency or p_amount_minor>v_order.amount_minor then raise exception 'payment_amount_mismatch'; end if;
  if (v_order.payment_mode='live') is distinct from p_livemode then raise exception 'payment_mode_mismatch'; end if;
  v_request:=jsonb_build_object('buyer_id',p_buyer_id,'intent_id',p_payment_intent_id,'refund_id',p_refund_id,'amount_minor',p_amount_minor,'currency',upper(p_currency),'status',p_refund_status,'livemode',p_livemode);
  select * into v_event from public.membership_payment_events where event_id=p_event_id;
  if found then
    if v_event.order_id<>p_order_id or v_event.event_type<>'refund' or v_event.request<>v_request then raise exception 'payment_event_conflict'; end if;
    return jsonb_build_object('duplicate',true,'applied',false,'order_id',p_order_id,'order_status',v_order.status,'grant_id',(select id from public.membership_purchase_grants where order_id=p_order_id),'outcome',v_event.outcome);
  end if;
  select * into v_refund from public.membership_refunds where refund_id=p_refund_id for update;
  if found and (v_refund.order_id<>p_order_id or v_refund.payment_intent_id<>p_payment_intent_id or v_refund.amount_minor<>p_amount_minor or v_refund.currency<>upper(p_currency)) then raise exception 'payment_event_conflict'; end if;
  if v_refund.status in ('succeeded','failed','canceled') then v_outcome:='ignored_refund_state';
  else
    insert into public.membership_refunds(refund_id,order_id,payment_intent_id,amount_minor,currency,status)
      values(p_refund_id,p_order_id,p_payment_intent_id,p_amount_minor,upper(p_currency),p_refund_status)
      on conflict(refund_id) do update set status=excluded.status,updated_at=now();
    select coalesce(sum(amount_minor),0) into v_total from public.membership_refunds where order_id=p_order_id and status='succeeded';
    if v_total>v_order.amount_minor then raise exception 'payment_amount_mismatch'; end if;
    if v_order.provider_payment_intent_id is null then update public.membership_orders set provider_payment_intent_id=p_payment_intent_id where id=p_order_id; end if;
    if v_total=v_order.amount_minor then
      update public.membership_orders set status='refunded',updated_at=now() where id=p_order_id;
      update public.membership_purchase_grants set status='revoked' where order_id=p_order_id;
      v_outcome:='refunded';
    else v_outcome:='refund_recorded'; end if;
  end if;
  insert into public.membership_payment_events(event_id,order_id,event_type,request,outcome) values(p_event_id,p_order_id,'refund',v_request,v_outcome);
  return jsonb_build_object('duplicate',false,'applied',v_outcome in ('refunded','refund_recorded'),'order_id',p_order_id,
    'order_status',case when v_outcome='refunded' then 'refunded' else v_order.status end,'grant_id',(select id from public.membership_purchase_grants where order_id=p_order_id),'outcome',v_outcome);
end;
$$;

-- Defense in depth: identity/quote/snapshots are never repriced or reassigned.
create function public.membership_order_guard()
returns trigger language plpgsql set search_path='' as $$
begin
  if (to_jsonb(new)-array['status','provider_session_id','provider_payment_intent_id','checkout_url','checkout_expires_at','paid_at','updated_at'])
    is distinct from (to_jsonb(old)-array['status','provider_session_id','provider_payment_intent_id','checkout_url','checkout_expires_at','paid_at','updated_at']) then raise exception 'membership_order_immutable'; end if;
  if (old.status='refunded' and new.status<>'refunded') or (old.status in ('expired','failed') and new.status not in (old.status,'refunded'))
    or (old.status='paid' and new.status not in ('paid','refunded')) then raise exception 'membership_order_terminal'; end if;
  if (old.provider_session_id is not null and new.provider_session_id is distinct from old.provider_session_id)
    or (old.provider_payment_intent_id is not null and new.provider_payment_intent_id is distinct from old.provider_payment_intent_id)
    or (old.checkout_url is not null and new.checkout_url is distinct from old.checkout_url)
    or (old.checkout_expires_at is not null and new.checkout_expires_at is distinct from old.checkout_expires_at)
    or (old.paid_at is not null and new.paid_at is distinct from old.paid_at) then raise exception 'membership_order_immutable'; end if;
  return new;
end;
$$;
create trigger membership_order_immutable_guard before update on public.membership_orders for each row execute function public.membership_order_guard();
create function public.membership_purchase_grant_guard()
returns trigger language plpgsql set search_path='' as $$
begin
  if (to_jsonb(new)-'status') is distinct from (to_jsonb(old)-'status') or (old.status='revoked' and new.status<>'revoked') then raise exception 'membership_purchase_grant_immutable'; end if;
  return new;
end;
$$;
create trigger membership_purchase_grant_immutable_guard before update on public.membership_purchase_grants for each row execute function public.membership_purchase_grant_guard();

revoke all on function public.membership_user_is_eligible(uuid),public.membership_commerce_plan(text),public.membership_order_receipt(uuid),
  public.membership_effective_entitlements(uuid),public.membership_order_guard(),public.membership_purchase_grant_guard() from public,anon,authenticated,service_role;
revoke all on function public.list_membership_catalog(),public.get_my_membership_commerce(uuid),public.get_effective_membership_entitlements(uuid),
  public.get_effective_membership_entitlements_for_user(uuid),public.admin_membership_commerce_store(uuid),
  public.admin_save_membership_price(uuid,text,integer,bigint,text,boolean,integer,text,uuid,uuid),
  public.admin_save_membership_entitlements(text,integer,integer,integer,text,uuid,uuid),
  public.admin_save_membership_commerce_settings(boolean,text,integer,text,uuid,uuid),public.prepare_membership_order(uuid,uuid,uuid,jsonb),
  public.register_membership_checkout_session(uuid,uuid,text,text,timestamptz,boolean),
  public.apply_verified_membership_payment_event(text,text,uuid,uuid,text,text,bigint,text,text,boolean,timestamptz),
  public.apply_verified_membership_refund_event(text,uuid,uuid,text,text,bigint,text,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.get_membership_payment_route(uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_membership_catalog() to anon,authenticated,service_role;
grant execute on function public.get_my_membership_commerce(uuid),public.get_effective_membership_entitlements(uuid),public.admin_membership_commerce_store(uuid),
  public.admin_save_membership_price(uuid,text,integer,bigint,text,boolean,integer,text,uuid,uuid),
  public.admin_save_membership_entitlements(text,integer,integer,integer,text,uuid,uuid),
  public.admin_save_membership_commerce_settings(boolean,text,integer,text,uuid,uuid) to authenticated;
grant execute on function public.get_effective_membership_entitlements_for_user(uuid),public.prepare_membership_order(uuid,uuid,uuid,jsonb),
  public.register_membership_checkout_session(uuid,uuid,text,text,timestamptz,boolean),
  public.apply_verified_membership_payment_event(text,text,uuid,uuid,text,text,bigint,text,text,boolean,timestamptz),
  public.apply_verified_membership_refund_event(text,uuid,uuid,text,text,bigint,text,text,boolean) to service_role;
grant execute on function public.get_membership_payment_route(uuid) to service_role;
create or replace function public.wavekb_schema_version() returns text language sql stable as $$ select '202610100003'::text $$;
grant execute on function public.wavekb_schema_version() to anon,authenticated;
notify pgrst,'reload schema';
commit;
