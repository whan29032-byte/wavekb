-- Independent mainnet stablecoin invoices. No keys, funds movement or Stripe IDs.
-- Recipient addresses are intentionally absent and both payment gates default off.
begin;

create table public.membership_wallet_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  revision integer not null default 1 check (revision>0),
  updated_at timestamptz not null default now()
);
insert into public.membership_wallet_settings(singleton) values(true);
create table public.membership_wallet_routes (
  id text primary key,
  chain text not null,
  asset text not null,
  contract text not null,
  decimals integer not null default 6 check (decimals=6),
  recipient text,
  enabled boolean not null default false,
  revision integer not null default 1 check (revision>0),
  updated_at timestamptz not null default now(),
  check ((id='tron-usdt' and chain='tron' and asset='USDT' and contract='TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')
    or (id='ethereum-usdt' and chain='ethereum' and asset='USDT' and contract='0xdac17f958d2ee523a2206206994597c13d831ec7')
    or (id='ethereum-usdc' and chain='ethereum' and asset='USDC' and contract='0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')
    or (id='base-usdc' and chain='base' and asset='USDC' and contract='0x833589fcd6edb6e08f4c7c32d4f71b54bda02913')),
  check (not enabled or recipient is not null),
  check (recipient is null or (recipient<>contract and (
    (chain='tron' and recipient ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$')
    or (chain in ('ethereum','base') and recipient ~ '^0x[0-9a-f]{40}$' and recipient<>'0x0000000000000000000000000000000000000000'))))
);
insert into public.membership_wallet_routes(id,chain,asset,contract) values
  ('tron-usdt','tron','USDT','TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'),
  ('ethereum-usdt','ethereum','USDT','0xdac17f958d2ee523a2206206994597c13d831ec7'),
  ('ethereum-usdc','ethereum','USDC','0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'),
  ('base-usdc','base','USDC','0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
create table public.membership_wallet_orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles(id) on delete restrict,
  request_id uuid not null unique,
  price_id uuid not null references public.membership_prices(id) on delete restrict,
  plan_key text not null references public.membership_plans(key) on delete restrict,
  price_revision integer not null check (price_revision>0),
  plan_revision integer not null check (plan_revision>0),
  route_id text not null references public.membership_wallet_routes(id) on delete restrict,
  route_revision integer not null check (route_revision>0),
  chain text not null,
  asset text not null,
  contract text not null,
  recipient text not null,
  amount_minor bigint not null check (amount_minor between 1 and 100000000),
  currency text not null default 'USD' check (currency='USD'),
  term_months integer not null check (term_months in (1,12)),
  base_amount_units bigint not null check (base_amount_units=amount_minor*10000),
  amount_units bigint not null check (amount_units>base_amount_units and amount_units<base_amount_units+10000),
  title_snapshot text not null,
  description_snapshot text not null,
  benefits_snapshot jsonb not null,
  ai_daily_limit_snapshot integer not null check (ai_daily_limit_snapshot between 0 and 10000),
  mentor_discount_bps_snapshot integer not null check (mentor_discount_bps_snapshot between 0 and 10000),
  expected_quote jsonb not null,
  status text not null default 'pending' check (status in ('pending','expired','paid','review','revoked')),
  created_at timestamptz not null default now() check (isfinite(created_at)),
  expires_at timestamptz not null default now()+interval '30 minutes' check (isfinite(expires_at)),
  paid_at timestamptz check (isfinite(paid_at)),
  updated_at timestamptz not null default now(),
  check (expires_at=created_at+interval '30 minutes'),
  -- Permanent occupied amounts, including expired/review/revoked invoices and old addresses.
  unique(chain,contract,recipient,amount_units)
);
create unique index membership_wallet_one_pending_plan on public.membership_wallet_orders(buyer_id,plan_key) where status='pending';
create index membership_wallet_orders_owner on public.membership_wallet_orders(buyer_id,created_at desc);
create table public.membership_wallet_grants (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.membership_wallet_orders(id) on delete restrict,
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
create table public.membership_wallet_verifications (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.membership_wallet_orders(id) on delete restrict,
  tx_hash text not null,
  status text not null default 'queued' check (status in ('queued','leased','waiting','settled','review')),
  attempts integer not null default 0 check (attempts>=0),
  next_attempt_at timestamptz not null default now(),
  lease_id uuid,
  lease_expires_at timestamptz,
  worker_id text,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(order_id,tx_hash),
  check ((status='leased' and lease_id is not null and lease_expires_at is not null)
    or (status<>'leased' and lease_id is null and lease_expires_at is null))
);
create index membership_wallet_verifications_queue on public.membership_wallet_verifications(status,next_attempt_at);
create table public.membership_wallet_receipts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.membership_wallet_orders(id) on delete restrict,
  verification_id uuid not null references public.membership_wallet_verifications(id) on delete restrict,
  chain text not null,
  tx_hash text not null,
  event_index bigint not null check (event_index>=0),
  evidence jsonb not null,
  outcome text not null check (outcome in ('paid','review','ignored_order_state')),
  created_at timestamptz not null default now(),
  unique(chain,tx_hash,event_index)
);
create table public.membership_wallet_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  action text not null check (action in ('settings_updated','route_updated','wallet_order_revoked')),
  reason text not null check (length(public.membership_trim_text(reason)) between 3 and 500),
  request jsonb not null,
  before_state jsonb,
  after_state jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.membership_wallet_settings enable row level security;
alter table public.membership_wallet_routes enable row level security;
alter table public.membership_wallet_orders enable row level security;
alter table public.membership_wallet_grants enable row level security;
alter table public.membership_wallet_verifications enable row level security;
alter table public.membership_wallet_receipts enable row level security;
alter table public.membership_wallet_events enable row level security;
revoke all on public.membership_wallet_settings,public.membership_wallet_routes,public.membership_wallet_orders,
  public.membership_wallet_grants,public.membership_wallet_verifications,public.membership_wallet_receipts,
  public.membership_wallet_events from public,anon,authenticated,service_role;

-- TRON public addresses carry a four-byte double-SHA256 checksum. No private key is involved.
create function public.membership_wallet_tron_address_valid(p_address text)
returns boolean language plpgsql immutable set search_path='' as $$
declare v_alphabet constant text:='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  v_number numeric:=0; v_bytes bytea:=''::bytea; v_digit integer; v_byte integer;
begin
  if p_address is null or p_address !~ '^T[1-9A-HJ-NP-Za-km-z]{33}$' then return false; end if;
  for i in 1..length(p_address) loop
    v_digit:=strpos(v_alphabet,substring(p_address from i for 1))-1;
    if v_digit<0 then return false; end if;
    v_number:=v_number*58+v_digit;
  end loop;
  while v_number>0 loop
    v_byte:=mod(v_number,256)::integer;
    v_bytes:=decode(lpad(to_hex(v_byte),2,'0'),'hex')||v_bytes;
    -- Subtract the remainder before division: numeric division may round a
    -- huge fractional quotient before truncation, corrupting Base58 decoding.
    v_number:=(v_number-v_byte)/256;
  end loop;
  return octet_length(v_bytes)=25 and get_byte(v_bytes,0)=65
    and substring(v_bytes from 22 for 4)=substring(pg_catalog.sha256(pg_catalog.sha256(substring(v_bytes from 1 for 21))) from 1 for 4);
end;
$$;
create function public.membership_wallet_order_receipt(p_order_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select (to_jsonb(o)-'expected_quote'-'amount_units'-'base_amount_units')||jsonb_build_object(
    'amount_units',o.amount_units::text,'base_amount_units',o.base_amount_units::text,
    'amount_decimal',(o.amount_units/1000000)::text||'.'||lpad((o.amount_units%1000000)::text,6,'0'),
    'status',case when o.status='pending' and o.expires_at<=now() then 'expired' else o.status end)
  from public.membership_wallet_orders o where o.id=p_order_id;
$$;
create function public.membership_wallet_verification_receipt(p_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select (to_jsonb(v)-'worker_id'-'reason')||jsonb_build_object('reason_code',case
    when v.reason in ('payment_before_invoice','payment_after_expiry','payment_amount_mismatch','matching_transfer_missing',
      'multiple_matching_transfers','transaction_failed','invoice_invalid','verification_disabled','chain_rpc_unconfigured',
      'transaction_pending','finality_unavailable','finality_pending','solidification_pending','additional_transfer',
      'order_already_paid_reconciliation') then v.reason
    when v.status='review' then 'reconciliation_required' when v.reason is not null then 'verification_waiting' else null end)
  from public.membership_wallet_verifications v where id=p_id;
$$;
create function public.membership_wallet_grant_receipt(p_order_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',g.id,'order_id',g.order_id,'plan_key',g.plan_key,'title',g.title_snapshot,'benefits',g.benefits_snapshot,
    'ai_daily_limit',g.ai_daily_limit_snapshot,'mentor_discount_bps',g.mentor_discount_bps_snapshot,'starts_at',g.starts_at,'ends_at',g.ends_at,
    'status',case when g.status='revoked' or o.status='revoked' then 'revoked' when not p.enabled then 'disabled'
      when g.starts_at>now() then 'scheduled' when g.ends_at<=now() then 'expired' else 'active' end)
  from public.membership_wallet_grants g join public.membership_wallet_orders o on o.id=g.order_id
    join public.membership_plans p on p.key=g.plan_key where g.order_id=p_order_id;
$$;
create function public.list_membership_wallet_routes()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('settings',to_jsonb(s)-'singleton',
    'routes',(select jsonb_agg(to_jsonb(r) order by r.id) from public.membership_wallet_routes r),
    'purchase_available',s.enabled and exists(select 1 from public.membership_wallet_routes where enabled and recipient is not null))
  from public.membership_wallet_settings s;
$$;
create function public.admin_membership_wallet_store(p_actor_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if p_actor_id is null or p_actor_id is distinct from auth.uid() or not public.is_admin() then raise exception 'admin_required'; end if;
  return jsonb_build_object('settings',(select to_jsonb(s)-'singleton' from public.membership_wallet_settings s),
    'routes',(select jsonb_agg(to_jsonb(r) order by r.id) from public.membership_wallet_routes r),
    'orders',coalesce((select jsonb_agg(public.membership_wallet_order_receipt(o.id) order by o.created_at desc)
      from (select * from public.membership_wallet_orders order by created_at desc,id desc limit 50) o),'[]'::jsonb),
    'verifications',coalesce((select jsonb_agg(public.membership_wallet_verification_receipt(v.id) order by v.created_at desc)
      from (select * from public.membership_wallet_verifications where order_id in
        (select id from public.membership_wallet_orders order by created_at desc,id desc limit 50) order by created_at desc,id desc limit 50) v),'[]'::jsonb),
    'receipts',coalesce((select jsonb_agg((to_jsonb(r)-'evidence')||jsonb_build_object('reason_code',case
      when r.outcome='paid' then null
      when (r.evidence->>'amount_units')::bigint<>o.amount_units then 'payment_amount_mismatch'
      when (r.evidence->>'paid_at')::timestamptz<o.created_at then 'payment_before_invoice'
      when (r.evidence->>'paid_at')::timestamptz>o.expires_at then 'payment_after_expiry'
      else 'additional_transfer' end) order by r.created_at desc)
      from (select * from public.membership_wallet_receipts where order_id in
        (select id from public.membership_wallet_orders order by created_at desc,id desc limit 50) order by created_at desc,id desc limit 50) r
      join public.membership_wallet_orders o on o.id=r.order_id),'[]'::jsonb),
    'history',coalesce((select jsonb_agg(to_jsonb(e)-array['actor_id','request_id','request','before_state','after_state'] order by created_at desc)
      from (select * from public.membership_wallet_events order by created_at desc,id desc limit 50) e),'[]'::jsonb));
end;
$$;
create function public.admin_revoke_membership_wallet_order(p_order_id uuid,p_reason text,p_request_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_order public.membership_wallet_orders; v_grant public.membership_wallet_grants;
  v_event public.membership_wallet_events; v_request jsonb; v_before jsonb; v_after jsonb;
begin
  if p_actor_id is null or p_actor_id is distinct from auth.uid() or not public.is_admin() then raise exception 'admin_required'; end if;
  if p_order_id is null or p_request_id is null or p_reason is null
    or length(public.membership_trim_text(p_reason)) not between 3 and 500 then raise exception 'membership_input_invalid'; end if;
  v_request:=jsonb_build_object('order_id',p_order_id,'reason',p_reason);
  perform pg_advisory_xact_lock(hashtextextended('wallet_admin_request:'||p_request_id::text,0));
  select * into v_event from public.membership_wallet_events where request_id=p_request_id;
  if found then
    if v_event.actor_id<>p_actor_id or v_event.action<>'wallet_order_revoked' or v_event.request<>v_request then raise exception 'request_conflict'; end if;
    return v_event.after_state;
  end if;
  select * into v_order from public.membership_wallet_orders where id=p_order_id;
  if v_order.id is null then raise exception 'order_not_found'; end if;
  -- Same order as settlement and manual grants: member row, renewal lock, invoice, grant.
  perform 1 from public.profiles where id=v_order.buyer_id for no key update;
  perform pg_advisory_xact_lock(hashtextextended('membership_purchase:'||v_order.buyer_id::text||':'||v_order.plan_key,0));
  select * into v_order from public.membership_wallet_orders where id=p_order_id for update;
  select * into v_grant from public.membership_wallet_grants where order_id=p_order_id for update;
  if v_order.status<>'paid' or v_grant.id is null or v_grant.status<>'active' then raise exception 'membership_wallet_order_not_paid'; end if;
  v_before:=jsonb_build_object('order',public.membership_wallet_order_receipt(p_order_id),'grant',public.membership_wallet_grant_receipt(p_order_id));
  update public.membership_wallet_orders set status='revoked',updated_at=now() where id=p_order_id;
  update public.membership_wallet_grants set status='revoked' where order_id=p_order_id;
  v_after:=jsonb_build_object('order',public.membership_wallet_order_receipt(p_order_id),'grant',public.membership_wallet_grant_receipt(p_order_id));
  insert into public.membership_wallet_events(request_id,actor_id,action,reason,request,before_state,after_state)
    values(p_request_id,p_actor_id,'wallet_order_revoked',public.membership_trim_text(p_reason),v_request,v_before,v_after);
  return v_after;
end;
$$;
create function public.admin_save_membership_wallet_settings(p_enabled boolean,p_expected_revision integer,p_reason text,p_request_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_before public.membership_wallet_settings; v_after public.membership_wallet_settings; v_event public.membership_wallet_events; v_request jsonb;
begin
  if p_actor_id is null or p_actor_id is distinct from auth.uid() or not public.is_admin() then raise exception 'admin_required'; end if;
  if p_enabled is null or p_expected_revision is null or p_expected_revision<1 or p_request_id is null
    or p_reason is null or length(public.membership_trim_text(p_reason)) not between 3 and 500 then raise exception 'membership_input_invalid'; end if;
  v_request:=jsonb_build_object('enabled',p_enabled,'revision',p_expected_revision,'reason',p_reason);
  perform pg_advisory_xact_lock(hashtextextended('wallet_admin_request:'||p_request_id::text,0));
  select * into v_event from public.membership_wallet_events where request_id=p_request_id;
  if found then
    if v_event.actor_id<>p_actor_id or v_event.action<>'settings_updated' or v_event.request<>v_request then raise exception 'request_conflict'; end if;
    return v_event.after_state;
  end if;
  select * into v_before from public.membership_wallet_settings where singleton for update;
  if v_before.revision<>p_expected_revision then raise exception 'membership_changed_concurrently'; end if;
  if p_enabled then
    perform 1 from public.membership_wallet_routes where enabled and recipient is not null for share;
    if not found then raise exception 'membership_wallet_unavailable'; end if;
  end if;
  update public.membership_wallet_settings set enabled=p_enabled,revision=revision+1,updated_at=now() where singleton returning * into v_after;
  insert into public.membership_wallet_events(request_id,actor_id,action,reason,request,before_state,after_state)
    values(p_request_id,p_actor_id,'settings_updated',public.membership_trim_text(p_reason),v_request,to_jsonb(v_before),to_jsonb(v_after)-'singleton');
  return to_jsonb(v_after)-'singleton';
end;
$$;
create function public.admin_save_membership_wallet_route(p_route_id text,p_recipient text,p_enabled boolean,p_expected_revision integer,p_reason text,p_request_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_before public.membership_wallet_routes; v_after public.membership_wallet_routes; v_event public.membership_wallet_events; v_request jsonb; v_recipient text;
begin
  if p_actor_id is null or p_actor_id is distinct from auth.uid() or not public.is_admin() then raise exception 'admin_required'; end if;
  if p_route_id is null or p_enabled is null or p_expected_revision is null or p_expected_revision<1 or p_request_id is null
    or p_reason is null or length(public.membership_trim_text(p_reason)) not between 3 and 500 then raise exception 'membership_input_invalid'; end if;
  select * into v_before from public.membership_wallet_routes where id=p_route_id;
  if not found then raise exception 'membership_wallet_route_invalid'; end if;
  v_recipient:=nullif(public.membership_trim_text(p_recipient),'');
  if v_before.chain<>'tron' then v_recipient:=lower(v_recipient); end if;
  if (p_enabled and v_recipient is null) or (v_recipient is not null and (v_recipient=v_before.contract or
    (v_before.chain='tron' and not public.membership_wallet_tron_address_valid(v_recipient)) or
    (v_before.chain<>'tron' and (v_recipient !~ '^0x[0-9a-f]{40}$' or v_recipient='0x0000000000000000000000000000000000000000')))) then raise exception 'membership_input_invalid'; end if;
  v_request:=jsonb_build_object('id',p_route_id,'recipient',v_recipient,'enabled',p_enabled,'revision',p_expected_revision,'reason',p_reason);
  perform pg_advisory_xact_lock(hashtextextended('wallet_admin_request:'||p_request_id::text,0));
  select * into v_event from public.membership_wallet_events where request_id=p_request_id;
  if found then
    if v_event.actor_id<>p_actor_id or v_event.action<>'route_updated' or v_event.request<>v_request then raise exception 'request_conflict'; end if;
    return v_event.after_state;
  end if;
  select * into v_before from public.membership_wallet_routes where id=p_route_id for update;
  if v_before.revision<>p_expected_revision then raise exception 'membership_changed_concurrently'; end if;
  update public.membership_wallet_routes set recipient=v_recipient,enabled=p_enabled,revision=revision+1,updated_at=now() where id=p_route_id returning * into v_after;
  insert into public.membership_wallet_events(request_id,actor_id,action,reason,request,before_state,after_state)
    values(p_request_id,p_actor_id,'route_updated',public.membership_trim_text(p_reason),v_request,to_jsonb(v_before),to_jsonb(v_after));
  return to_jsonb(v_after);
end;
$$;

-- Both prepare paths already lock the buyer profile. The trigger closes the old
-- Stripe RPC's reverse cross-rail gap without changing its IDs, quote or payment trust.
create function public.guard_membership_cross_rail_pending()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.profiles where id=new.buyer_id for no key update;
  if exists(select 1 from public.membership_wallet_orders where buyer_id=new.buyer_id and plan_key=new.plan_key and status in ('pending','review') and expires_at>now()) then
    raise exception 'membership_pending_order_exists';
  end if;
  return new;
end;
$$;
create trigger membership_orders_wallet_pending_guard before insert on public.membership_orders for each row execute function public.guard_membership_cross_rail_pending();

create function public.prepare_membership_wallet_order(p_actor_id uuid,p_price_id uuid,p_route_id text,p_request_id uuid,p_expected_quote jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_order public.membership_wallet_orders; v_price public.membership_prices; v_plan public.membership_plans;
  v_route public.membership_wallet_routes; v_settings public.membership_wallet_settings; v_quote jsonb; v_base bigint; v_units bigint; v_seed integer; v_tail integer;
begin
  if p_actor_id is null or p_price_id is null or p_route_id is null or p_request_id is null or p_expected_quote is null or jsonb_typeof(p_expected_quote)<>'object' then raise exception 'membership_input_invalid'; end if;
  perform 1 from public.profiles where id=p_actor_id for no key update;
  if not public.membership_user_is_eligible(p_actor_id) then raise exception 'account_ineligible'; end if;
  perform pg_advisory_xact_lock(hashtextextended('wallet_order_request:'||p_request_id::text,0));
  select * into v_order from public.membership_wallet_orders where request_id=p_request_id for update;
  if found then
    if v_order.buyer_id<>p_actor_id or v_order.price_id<>p_price_id or v_order.route_id<>p_route_id or v_order.expected_quote<>p_expected_quote then raise exception 'request_conflict'; end if;
    if v_order.status='pending' and v_order.expires_at<=now() then
      update public.membership_wallet_orders set status='expired',updated_at=now() where id=v_order.id;
    elsif v_order.status in ('pending','review') and v_order.expires_at>now() then
      select * into v_settings from public.membership_wallet_settings where singleton for share;
      select * into v_route from public.membership_wallet_routes where id=p_route_id for share;
      if not v_settings.enabled or not v_route.enabled or v_route.recipient is distinct from v_order.recipient then raise exception 'membership_wallet_unavailable'; end if;
      select * into v_plan from public.membership_plans where key=v_order.plan_key for share;
      if not v_plan.enabled then raise exception 'membership_plan_disabled'; end if;
    end if;
    return public.membership_wallet_order_receipt(v_order.id);
  end if;
  select * into v_settings from public.membership_wallet_settings where singleton for share;
  select * into v_route from public.membership_wallet_routes where id=p_route_id for share;
  if not v_settings.enabled or v_route.id is null or not v_route.enabled or v_route.recipient is null then raise exception 'membership_wallet_unavailable'; end if;
  select * into v_price from public.membership_prices where id=p_price_id for share;
  if v_price.id is null or not v_price.published or v_price.currency<>'USD' then raise exception 'membership_price_unavailable'; end if;
  select * into v_plan from public.membership_plans where key=v_price.plan_key for share;
  if not v_plan.enabled then raise exception 'membership_plan_disabled'; end if;
  v_quote:=jsonb_build_object('price_id',v_price.id,'plan_key',v_plan.key,'price_revision',v_price.revision,'plan_revision',v_plan.revision,
    'amount_minor',v_price.amount_minor,'currency','USD','term_months',v_price.term_months,'route_revision',v_route.revision);
  if p_expected_quote<>v_quote then raise exception 'membership_wallet_quote_changed'; end if;
  update public.membership_wallet_orders set status='expired',updated_at=now() where buyer_id=p_actor_id and plan_key=v_plan.key and status='pending' and expires_at<=now();
  if exists(select 1 from public.membership_wallet_orders where buyer_id=p_actor_id and plan_key=v_plan.key and status in ('pending','review') and expires_at>now())
    or exists(select 1 from public.membership_orders where buyer_id=p_actor_id and plan_key=v_plan.key and status='pending') then raise exception 'membership_pending_order_exists'; end if;
  v_base:=v_price.amount_minor*10000;
  perform pg_advisory_xact_lock(hashtextextended('wallet_amount:'||v_route.chain||':'||v_route.contract||':'||v_route.recipient||':'||v_base::text,0));
  -- The UUID seed is unpredictable; uniqueness, not secrecy, is the allocation safety boundary.
  v_seed:=((hashtextextended(gen_random_uuid()::text,0)&9223372036854775807)%9999)::integer;
  for i in 0..9998 loop
    v_tail:=(v_seed+i)%9999+1; v_units:=v_base+v_tail;
    exit when not exists(select 1 from public.membership_wallet_orders where chain=v_route.chain and contract=v_route.contract and recipient=v_route.recipient and amount_units=v_units);
    v_units:=null;
  end loop;
  if v_units is null then raise exception 'membership_wallet_amount_pool_exhausted'; end if;
  insert into public.membership_wallet_orders(buyer_id,request_id,price_id,plan_key,price_revision,plan_revision,route_id,route_revision,chain,asset,contract,recipient,
    amount_minor,term_months,base_amount_units,amount_units,title_snapshot,description_snapshot,benefits_snapshot,ai_daily_limit_snapshot,mentor_discount_bps_snapshot,expected_quote)
    values(p_actor_id,p_request_id,v_price.id,v_plan.key,v_price.revision,v_plan.revision,v_route.id,v_route.revision,v_route.chain,v_route.asset,v_route.contract,v_route.recipient,
      v_price.amount_minor,v_price.term_months,v_base,v_units,v_plan.title,v_plan.description,v_plan.benefits,v_plan.ai_daily_limit,v_plan.mentor_discount_bps,v_quote) returning * into v_order;
  return public.membership_wallet_order_receipt(v_order.id);
end;
$$;
create function public.submit_membership_wallet_transfer(p_actor_id uuid,p_order_id uuid,p_tx_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_order public.membership_wallet_orders; v_verification public.membership_wallet_verifications; v_hash text;
begin
  if p_actor_id is null or p_actor_id is distinct from auth.uid() then raise exception 'account_ineligible'; end if;
  perform 1 from public.profiles where id=p_actor_id for no key update;
  if not public.membership_user_is_eligible(p_actor_id) then raise exception 'account_ineligible'; end if;
  select * into v_order from public.membership_wallet_orders where id=p_order_id for update;
  if v_order.id is null or v_order.buyer_id<>p_actor_id then raise exception 'order_access_denied'; end if;
  v_hash:=lower(public.membership_trim_text(p_tx_hash));
  if v_hash is null or (v_order.chain='tron' and v_hash !~ '^[0-9a-f]{64}$') or (v_order.chain<>'tron' and v_hash !~ '^0x[0-9a-f]{64}$') then raise exception 'membership_wallet_transfer_invalid'; end if;
  select * into v_verification from public.membership_wallet_verifications where order_id=p_order_id and tx_hash=v_hash;
  if not found then
    if (select count(*) from public.membership_wallet_verifications where order_id=p_order_id)>=20 then raise exception 'membership_wallet_transfer_order_limit'; end if;
    if (select count(*) from public.membership_wallet_verifications v join public.membership_wallet_orders o on o.id=v.order_id
      where o.buyer_id=p_actor_id and v.created_at>now()-interval '10 minutes')>=5 then raise exception 'membership_wallet_transfer_rate_limited'; end if;
    if (select count(*) from public.membership_wallet_verifications where order_id=p_order_id and status in ('queued','leased','waiting'))>=3 then raise exception 'membership_wallet_verification_pending_limit'; end if;
    insert into public.membership_wallet_verifications(order_id,tx_hash) values(p_order_id,v_hash) returning * into v_verification;
  end if;
  return jsonb_build_object('order',public.membership_wallet_order_receipt(p_order_id),'verification',public.membership_wallet_verification_receipt(v_verification.id));
end;
$$;
create function public.claim_membership_wallet_verifications(p_limit integer,p_worker_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_job public.membership_wallet_verifications; v_jobs jsonb:='[]';
begin
  if p_limit is null or p_limit not between 1 and 10 or p_worker_id is null or length(public.membership_trim_text(p_worker_id)) not between 1 and 100 then raise exception 'membership_input_invalid'; end if;
  for v_job in select v.* from public.membership_wallet_verifications v join public.membership_wallet_orders o on o.id=v.order_id
    where ((v.status in ('queued','waiting') and v.next_attempt_at<=now()) or (v.status='leased' and v.lease_expires_at<=now()))
    order by v.next_attempt_at,v.created_at for update of v skip locked limit p_limit
  loop
    update public.membership_wallet_verifications set status='leased',attempts=attempts+1,lease_id=gen_random_uuid(),lease_expires_at=now()+interval '2 minutes',worker_id=public.membership_trim_text(p_worker_id),updated_at=now()
      where id=v_job.id returning * into v_job;
    v_jobs:=v_jobs||jsonb_build_array(public.membership_wallet_verification_receipt(v_job.id)||jsonb_build_object('order',public.membership_wallet_order_receipt(v_job.order_id)));
  end loop;
  return v_jobs;
end;
$$;
create function public.settle_membership_wallet_verification(p_verification_id uuid,p_lease_id uuid,p_outcome text,p_reason text,p_retry_after_seconds integer default 60)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_job public.membership_wallet_verifications;
begin
  if p_outcome is null or p_outcome not in ('waiting','review') or p_reason is null or length(public.membership_trim_text(p_reason)) not between 1 and 500
    or p_retry_after_seconds is null or p_retry_after_seconds not between 5 and 3600 then raise exception 'membership_input_invalid'; end if;
  select * into v_job from public.membership_wallet_verifications where id=p_verification_id;
  if v_job.id is null then raise exception 'membership_wallet_lease_invalid'; end if;
  -- All paths that mutate an invoice lock it before its verification row.
  perform 1 from public.membership_wallet_orders where id=v_job.order_id for update;
  select * into v_job from public.membership_wallet_verifications where id=p_verification_id for update;
  if v_job.id is null or p_lease_id is null or v_job.status<>'leased' or v_job.lease_id is distinct from p_lease_id or v_job.lease_expires_at<=clock_timestamp() then raise exception 'membership_wallet_lease_invalid'; end if;
  update public.membership_wallet_verifications set status=p_outcome,lease_id=null,lease_expires_at=null,worker_id=null,reason=public.membership_trim_text(p_reason),
    next_attempt_at=now()+make_interval(secs=>p_retry_after_seconds),updated_at=now() where id=p_verification_id;
  if p_outcome='review' then update public.membership_wallet_orders set status='review',updated_at=now() where id=v_job.order_id and status in ('pending','expired','review'); end if;
  return public.membership_wallet_verification_receipt(p_verification_id);
end;
$$;

create function public.membership_wallet_renewal_start(p_user_id uuid,p_plan_key text,p_paid_at timestamptz,p_mode text)
returns timestamptz language sql stable security definer set search_path='' as $$
  select greatest(p_paid_at,coalesce(max(ends_at),p_paid_at)) from (
    select g.ends_at from public.membership_purchase_grants g join public.membership_orders o on o.id=g.order_id
      where g.user_id=p_user_id and g.plan_key=p_plan_key and g.status='active' and o.status='paid' and o.payment_mode=p_mode
    union all select g.ends_at from public.membership_wallet_grants g join public.membership_wallet_orders o on o.id=g.order_id
      where p_mode='live' and g.user_id=p_user_id and g.plan_key=p_plan_key and g.status='active' and o.status='paid'
    union all select g.ends_at from public.membership_grants g where p_mode='live' and g.user_id=p_user_id and g.plan_key=p_plan_key and g.status='active'
  ) sources;
$$;
create function public.apply_verified_membership_wallet_transfer(p_order_id uuid,p_lease_id uuid,p_evidence jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_order public.membership_wallet_orders; v_job public.membership_wallet_verifications; v_receipt public.membership_wallet_receipts;
  v_paid timestamptz; v_units bigint; v_event bigint; v_grant uuid; v_start timestamptz; v_outcome text;
begin
  if p_evidence is null or jsonb_typeof(p_evidence)<>'object' or p_evidence->'finalized' is distinct from 'true'::jsonb
    or jsonb_typeof(p_evidence->'chain') is distinct from 'string' or jsonb_typeof(p_evidence->'contract') is distinct from 'string'
    or jsonb_typeof(p_evidence->'recipient') is distinct from 'string' or jsonb_typeof(p_evidence->'amount_units') is distinct from 'string'
    or (p_evidence->>'amount_units') !~ '^[1-9][0-9]{0,18}$' or jsonb_typeof(p_evidence->'tx_hash') is distinct from 'string'
    or jsonb_typeof(p_evidence->'event_index') is distinct from 'number' or (p_evidence->>'event_index') !~ '^[0-9]+$'
    or jsonb_typeof(p_evidence->'block_number') is distinct from 'number' or (p_evidence->>'block_number') !~ '^[1-9][0-9]*$'
    or jsonb_typeof(p_evidence->'block_hash') is distinct from 'string'
    or jsonb_typeof(p_evidence->'paid_at') is distinct from 'string' or (select count(*) from jsonb_object_keys(p_evidence))<>10
    then raise exception 'membership_wallet_evidence_invalid'; end if;
  begin
    if (p_evidence->>'event_index')::numeric>9007199254740991 or (p_evidence->>'block_number')::numeric>9007199254740991 then raise exception 'membership_wallet_evidence_invalid'; end if;
    v_paid:=(p_evidence->>'paid_at')::timestamptz; v_units:=(p_evidence->>'amount_units')::bigint; v_event:=(p_evidence->>'event_index')::bigint;
  exception when others then raise exception 'membership_wallet_evidence_invalid'; end;
  if not isfinite(v_paid) or v_paid>now()+interval '5 minutes' then raise exception 'membership_wallet_evidence_invalid'; end if;
  select * into v_order from public.membership_wallet_orders where id=p_order_id;
  if v_order.id is null then raise exception 'order_not_found'; end if;
  perform 1 from public.profiles where id=v_order.buyer_id for no key update;
  perform pg_advisory_xact_lock(hashtextextended('membership_purchase:'||v_order.buyer_id::text||':'||v_order.plan_key,0));
  select * into v_order from public.membership_wallet_orders where id=p_order_id for update;
  if p_evidence->>'chain'<>v_order.chain or p_evidence->>'contract'<>v_order.contract or p_evidence->>'recipient'<>v_order.recipient
    or (v_order.chain='tron' and ((p_evidence->>'tx_hash') !~ '^[0-9a-f]{64}$' or (p_evidence->>'block_hash') !~ '^[0-9a-f]{64}$'))
    or (v_order.chain<>'tron' and ((p_evidence->>'tx_hash') !~ '^0x[0-9a-f]{64}$' or (p_evidence->>'block_hash') !~ '^0x[0-9a-f]{64}$')) then raise exception 'membership_wallet_evidence_invalid'; end if;
  -- Lock the global transfer identity before reading the receipt; independent invoices cannot spend one event twice.
  perform pg_advisory_xact_lock(hashtextextended('wallet_event:'||v_order.chain||':'||(p_evidence->>'tx_hash')||':'||v_event::text,0));
  select * into v_receipt from public.membership_wallet_receipts where chain=v_order.chain and tx_hash=p_evidence->>'tx_hash' and event_index=v_event;
  if found then
    if v_receipt.order_id<>p_order_id or v_receipt.evidence<>p_evidence then raise exception 'membership_wallet_receipt_conflict'; end if;
    return jsonb_build_object('duplicate',true,'applied',false,'order_id',p_order_id,'order_status',v_order.status,'grant_id',(select id from public.membership_wallet_grants where order_id=p_order_id),'outcome',v_receipt.outcome);
  end if;
  select * into v_job from public.membership_wallet_verifications where order_id=p_order_id and tx_hash=p_evidence->>'tx_hash' for update;
  if v_job.id is null or p_lease_id is null or v_job.status<>'leased' or v_job.lease_id is distinct from p_lease_id or v_job.lease_expires_at<=clock_timestamp() then raise exception 'membership_wallet_lease_invalid'; end if;
  -- A second real payment is a reconciliation item, not another membership or a status rollback.
  if v_order.status in ('paid','revoked') then v_outcome:='review';
  elsif v_units<>v_order.amount_units or v_paid<v_order.created_at or v_paid>v_order.expires_at then
    v_outcome:='review'; update public.membership_wallet_orders set status='review',updated_at=now() where id=p_order_id;
  else
    v_start:=public.membership_wallet_renewal_start(v_order.buyer_id,v_order.plan_key,v_paid,'live');
    update public.membership_wallet_orders set status='paid',paid_at=v_paid,updated_at=now() where id=p_order_id;
    insert into public.membership_wallet_grants(order_id,user_id,plan_key,starts_at,ends_at,title_snapshot,benefits_snapshot,ai_daily_limit_snapshot,mentor_discount_bps_snapshot)
      values(p_order_id,v_order.buyer_id,v_order.plan_key,v_start,v_start+make_interval(months=>v_order.term_months),v_order.title_snapshot,v_order.benefits_snapshot,v_order.ai_daily_limit_snapshot,v_order.mentor_discount_bps_snapshot) returning id into v_grant;
    -- Old speculative hashes no longer need endless network polling after one
    -- proven payment. Keep every hash for manual extra-payment reconciliation;
    -- never claim that an unverified hash paid, and fence any in-flight worker.
    perform 1 from public.membership_wallet_verifications where order_id=p_order_id and id<>v_job.id
      and status in ('queued','leased','waiting') order by id for update;
    update public.membership_wallet_verifications set status='review',lease_id=null,lease_expires_at=null,worker_id=null,
      reason='order_already_paid_reconciliation',updated_at=now() where order_id=p_order_id and id<>v_job.id and status in ('queued','leased','waiting');
    v_outcome:='paid';
  end if;
  insert into public.membership_wallet_receipts(order_id,verification_id,chain,tx_hash,event_index,evidence,outcome) values(p_order_id,v_job.id,v_order.chain,p_evidence->>'tx_hash',v_event,p_evidence,v_outcome);
  update public.membership_wallet_verifications set status=case when v_outcome='review' then 'review' else 'settled' end,lease_id=null,lease_expires_at=null,worker_id=null,updated_at=now() where id=v_job.id;
  return jsonb_build_object('duplicate',false,'applied',v_outcome='paid','order_id',p_order_id,'order_status',case when v_order.status in ('paid','revoked') then v_order.status when v_outcome='paid' then 'paid' when v_outcome='review' then 'review' else v_order.status end,'grant_id',v_grant,'outcome',v_outcome);
end;
$$;

create or replace function public.membership_effective_entitlements(p_user_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  with eligible as (select public.membership_user_is_eligible(p_user_id) as value), sources as (
    select g.plan_key,p.ai_daily_limit,p.mentor_discount_bps from public.membership_grants g join public.membership_plans p on p.key=g.plan_key
      where g.user_id=p_user_id and g.status='active' and p.enabled and g.starts_at<=now() and g.ends_at>now()
    union all select g.plan_key,g.ai_daily_limit_snapshot,g.mentor_discount_bps_snapshot from public.membership_purchase_grants g
      join public.membership_plans p on p.key=g.plan_key join public.membership_orders o on o.id=g.order_id
      where g.user_id=p_user_id and g.status='active' and p.enabled and g.starts_at<=now() and g.ends_at>now() and o.status='paid' and o.payment_mode='live'
    union all select g.plan_key,g.ai_daily_limit_snapshot,g.mentor_discount_bps_snapshot from public.membership_wallet_grants g
      join public.membership_plans p on p.key=g.plan_key join public.membership_wallet_orders o on o.id=g.order_id
      where g.user_id=p_user_id and g.status='active' and p.enabled and g.starts_at<=now() and g.ends_at>now() and o.status='paid'
  ) select jsonb_build_object('user_id',p_user_id,'eligible',e.value,'has_vip',e.value and exists(select 1 from sources where plan_key='vip'),
    'ai_daily_limit',case when e.value then coalesce((select max(ai_daily_limit) from sources),0) else 0 end,
    'mentor_discount_bps',case when e.value then coalesce((select max(mentor_discount_bps) from sources),0) else 0 end) from eligible e;
$$;
create or replace function public.has_membership_entitlement(p_key text)
returns boolean language sql stable security definer set search_path='' as $$
  select public.membership_user_is_eligible(auth.uid()) and (
    exists(select 1 from public.membership_grants g join public.membership_plans p on p.key=g.plan_key where g.user_id=auth.uid() and g.status='active' and p.enabled and g.starts_at<=now() and g.ends_at>now() and p.benefits ? p_key)
    or exists(select 1 from public.membership_purchase_grants g join public.membership_plans p on p.key=g.plan_key join public.membership_orders o on o.id=g.order_id where g.user_id=auth.uid() and g.status='active' and p.enabled and g.starts_at<=now() and g.ends_at>now() and o.status='paid' and o.payment_mode='live' and g.benefits_snapshot ? p_key)
    or exists(select 1 from public.membership_wallet_grants g join public.membership_plans p on p.key=g.plan_key join public.membership_wallet_orders o on o.id=g.order_id where g.user_id=auth.uid() and g.status='active' and p.enabled and g.starts_at<=now() and g.ends_at>now() and o.status='paid' and g.benefits_snapshot ? p_key));
$$;
create function public.get_my_membership_wallet(p_actor_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if p_actor_id is null or p_actor_id is distinct from auth.uid() or not public.membership_user_is_eligible(p_actor_id) then raise exception 'account_ineligible'; end if;
  return jsonb_build_object('catalog',public.list_membership_wallet_routes(),'effective',public.membership_effective_entitlements(p_actor_id),
    'orders',coalesce((select jsonb_agg(public.membership_wallet_order_receipt(o.id) order by o.created_at desc) from (select * from public.membership_wallet_orders where buyer_id=p_actor_id order by created_at desc,id desc limit 50) o),'[]'::jsonb),
    'verifications',coalesce((select jsonb_agg(public.membership_wallet_verification_receipt(v.id) order by v.created_at desc) from (select v.* from public.membership_wallet_verifications v
      where v.order_id in (select id from public.membership_wallet_orders where buyer_id=p_actor_id order by created_at desc,id desc limit 50) order by v.created_at desc,v.id desc limit 50) v),'[]'::jsonb),
    'purchase_grants',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'order_id',g.order_id,'plan_key',g.plan_key,'title',g.title_snapshot,'benefits',g.benefits_snapshot,
      'ai_daily_limit',g.ai_daily_limit_snapshot,'mentor_discount_bps',g.mentor_discount_bps_snapshot,'starts_at',g.starts_at,'ends_at',g.ends_at,
      'status',case when g.status='revoked' or o.status='revoked' then 'revoked' when not p.enabled then 'disabled' when g.starts_at>now() then 'scheduled' when g.ends_at<=now() then 'expired' else 'active' end) order by g.ends_at desc)
      from public.membership_wallet_grants g join public.membership_wallet_orders o on o.id=g.order_id join public.membership_plans p on p.key=g.plan_key where g.user_id=p_actor_id),'[]'::jsonb));
end;
$$;

create function public.guard_membership_wallet_order()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'membership_wallet_order_immutable'; end if;
  if (to_jsonb(new)-array['status','paid_at','updated_at']) is distinct from (to_jsonb(old)-array['status','paid_at','updated_at'])
    or (old.paid_at is not null and new.paid_at is distinct from old.paid_at) then raise exception 'membership_wallet_order_immutable'; end if;
  if (old.status='revoked' and new.status<>'revoked') or (old.status='paid' and new.status not in ('paid','revoked')) then raise exception 'membership_wallet_order_terminal'; end if;
  return new;
end;
$$;
create trigger membership_wallet_order_guard before update or delete on public.membership_wallet_orders for each row execute function public.guard_membership_wallet_order();
create trigger membership_wallet_grant_guard before update on public.membership_wallet_grants for each row execute function public.membership_purchase_grant_guard();
create function public.guard_membership_wallet_route()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'membership_wallet_route_immutable'; end if;
  if row(new.id,new.chain,new.asset,new.contract,new.decimals) is distinct from row(old.id,old.chain,old.asset,old.contract,old.decimals) then raise exception 'membership_wallet_route_immutable'; end if;
  return new;
end;
$$;
create trigger membership_wallet_route_guard before update or delete on public.membership_wallet_routes for each row execute function public.guard_membership_wallet_route();

-- Stripe replacement only changes the private renewal calculation and adds
-- the shared member row lock. Signature, validation, ledger and terminal guards stay intact.
create or replace function public.apply_verified_membership_payment_event(p_event_id text,p_event_type text,p_order_id uuid,p_buyer_id uuid,p_session_id text,
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
  perform 1 from public.profiles where id=v_order.buyer_id for no key update;
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
    v_start:=public.membership_wallet_renewal_start(v_order.buyer_id,v_order.plan_key,p_paid_at,v_order.payment_mode);
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

revoke all on function public.membership_wallet_tron_address_valid(text),public.membership_wallet_order_receipt(uuid),public.membership_wallet_verification_receipt(uuid),public.membership_wallet_grant_receipt(uuid),public.membership_wallet_renewal_start(uuid,text,timestamptz,text),
  public.guard_membership_cross_rail_pending(),public.guard_membership_wallet_order(),public.guard_membership_wallet_route() from public,anon,authenticated,service_role;
revoke all on function public.list_membership_wallet_routes(),public.get_my_membership_wallet(uuid),public.admin_membership_wallet_store(uuid),
  public.admin_save_membership_wallet_settings(boolean,integer,text,uuid,uuid),public.admin_save_membership_wallet_route(text,text,boolean,integer,text,uuid,uuid),
  public.admin_revoke_membership_wallet_order(uuid,text,uuid,uuid),
  public.prepare_membership_wallet_order(uuid,uuid,text,uuid,jsonb),public.submit_membership_wallet_transfer(uuid,uuid,text),
  public.claim_membership_wallet_verifications(integer,text),public.settle_membership_wallet_verification(uuid,uuid,text,text,integer),
  public.apply_verified_membership_wallet_transfer(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.list_membership_wallet_routes() to anon,authenticated,service_role;
grant execute on function public.get_my_membership_wallet(uuid),public.admin_membership_wallet_store(uuid),
  public.admin_save_membership_wallet_settings(boolean,integer,text,uuid,uuid),public.admin_save_membership_wallet_route(text,text,boolean,integer,text,uuid,uuid),
  public.admin_revoke_membership_wallet_order(uuid,text,uuid,uuid),
  public.submit_membership_wallet_transfer(uuid,uuid,text) to authenticated;
grant execute on function public.prepare_membership_wallet_order(uuid,uuid,text,uuid,jsonb),public.claim_membership_wallet_verifications(integer,text),
  public.settle_membership_wallet_verification(uuid,uuid,text,text,integer),public.apply_verified_membership_wallet_transfer(uuid,uuid,jsonb) to service_role;
create or replace function public.wavekb_schema_version()
returns text language sql stable as $$ select '202610100005'; $$;
revoke all on function public.wavekb_schema_version() from public,anon,authenticated,service_role;
grant execute on function public.wavekb_schema_version() to anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
