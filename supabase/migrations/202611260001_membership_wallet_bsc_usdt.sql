-- Add canonical BSC USDT without invalidating historical Ethereum/Base invoices.
-- New checkout is restricted to TRC20/BEP20 USDT; legacy routes remain immutable
-- so already-created invoices and late finality can still be reconciled.
begin;

alter table public.membership_wallet_routes
  drop constraint if exists membership_wallet_routes_decimals_check,
  drop constraint if exists membership_wallet_routes_check,
  drop constraint if exists membership_wallet_routes_check1,
  drop constraint if exists membership_wallet_routes_check2,
  drop constraint if exists membership_wallet_routes_decimals_supported,
  drop constraint if exists membership_wallet_routes_canonical_identity,
  drop constraint if exists membership_wallet_routes_enabled_recipient,
  drop constraint if exists membership_wallet_routes_recipient_valid,
  drop constraint if exists membership_wallet_routes_new_purchase_policy;

insert into public.membership_wallet_routes(id,chain,asset,contract,decimals,recipient,enabled,revision)
values('bsc-usdt','bsc','USDT','0x55d398326f99059ff775485246999027b3197955',18,null,false,1)
on conflict(id) do nothing;

-- Increment only on the actual cutover. Replaying this hardening migration is
-- intentionally a no-op for route revisions.
update public.membership_wallet_routes
set enabled=false,revision=revision+1,updated_at=now()
where id in ('ethereum-usdt','ethereum-usdc','base-usdc') and enabled;

alter table public.membership_wallet_routes
  add constraint membership_wallet_routes_decimals_supported check(decimals in (6,18)),
  add constraint membership_wallet_routes_canonical_identity check(
    (id='tron-usdt' and chain='tron' and asset='USDT' and contract='TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' and decimals=6)
    or (id='bsc-usdt' and chain='bsc' and asset='USDT' and contract='0x55d398326f99059ff775485246999027b3197955' and decimals=18)
    or (id='ethereum-usdt' and chain='ethereum' and asset='USDT' and contract='0xdac17f958d2ee523a2206206994597c13d831ec7' and decimals=6)
    or (id='ethereum-usdc' and chain='ethereum' and asset='USDC' and contract='0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' and decimals=6)
    or (id='base-usdc' and chain='base' and asset='USDC' and contract='0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' and decimals=6)),
  add constraint membership_wallet_routes_enabled_recipient check(not enabled or recipient is not null),
  add constraint membership_wallet_routes_recipient_valid check(recipient is null or (recipient<>contract and (
    (chain='tron' and recipient ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$')
    or (chain in ('bsc','ethereum','base') and recipient ~ '^0x[0-9a-f]{40}$' and recipient<>'0x0000000000000000000000000000000000000000')))),
  add constraint membership_wallet_routes_new_purchase_policy check(not enabled or id in ('tron-usdt','bsc-usdt'));

alter table public.membership_wallet_orders
  drop constraint if exists membership_wallet_orders_check,
  drop constraint if exists membership_wallet_orders_check1,
  drop constraint if exists membership_wallet_orders_base_amount_units_check,
  drop constraint if exists membership_wallet_orders_amount_units_check,
  drop constraint if exists membership_wallet_orders_token_decimals_check,
  drop constraint if exists membership_wallet_orders_scaled_base_check,
  drop constraint if exists membership_wallet_orders_scaled_tail_check;
alter table public.membership_wallet_orders
  alter column base_amount_units type numeric(78,0) using base_amount_units::numeric,
  alter column amount_units type numeric(78,0) using amount_units::numeric,
  add column if not exists token_decimals integer not null default 6;
alter table public.membership_wallet_orders alter column token_decimals set default 6,alter column token_decimals set not null;
alter table public.membership_wallet_orders
  add constraint membership_wallet_orders_token_decimals_check check(token_decimals in (6,18)),
  add constraint membership_wallet_orders_scaled_base_check check(
    base_amount_units=amount_minor::numeric*10000::numeric*power(10::numeric,token_decimals-6)),
  add constraint membership_wallet_orders_scaled_tail_check check(
    amount_units-base_amount_units>=power(10::numeric,token_decimals-6)
    and amount_units-base_amount_units<=9999::numeric*power(10::numeric,token_decimals-6)
    and mod(amount_units-base_amount_units,power(10::numeric,token_decimals-6))=0);

create or replace function public.membership_wallet_order_receipt(p_order_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  with invoice as (
    select o.*,power(10::numeric,o.token_decimals-6) as token_scale
    from public.membership_wallet_orders o where o.id=p_order_id
  ), display as (
    select i.*,i.amount_units/i.token_scale as amount_micros
    from invoice i
  )
  select (to_jsonb(o)-'expected_quote'-'amount_units'-'base_amount_units')||jsonb_build_object(
    'amount_units',o.amount_units::text,'base_amount_units',o.base_amount_units::text,
    'amount_decimal',trunc(o.amount_micros/1000000)::bigint::text||'.'||lpad(trunc(mod(o.amount_micros,1000000))::bigint::text,6,'0'),
    'status',case when o.status='pending' and o.expires_at<=now() then 'expired' else o.status end)
  from display o;
$$;

create or replace function public.list_membership_wallet_routes()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('settings',to_jsonb(s)-'singleton',
    'routes',(select jsonb_agg(to_jsonb(r) order by r.id) from public.membership_wallet_routes r),
    'purchase_available',s.enabled and exists(select 1 from public.membership_wallet_routes where id in ('tron-usdt','bsc-usdt') and enabled and recipient is not null))
  from public.membership_wallet_settings s;
$$;

create or replace function public.admin_membership_wallet_store(p_actor_id uuid)
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
      when (r.evidence->>'amount_units')::numeric<>o.amount_units then 'payment_amount_mismatch'
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

create or replace function public.admin_save_membership_wallet_settings(p_enabled boolean,p_expected_revision integer,p_reason text,p_request_id uuid,p_actor_id uuid)
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
    perform 1 from public.membership_wallet_routes where id in ('tron-usdt','bsc-usdt') and enabled and recipient is not null for share;
    if not found then raise exception 'membership_wallet_unavailable'; end if;
  end if;
  update public.membership_wallet_settings set enabled=p_enabled,revision=revision+1,updated_at=now() where singleton returning * into v_after;
  insert into public.membership_wallet_events(request_id,actor_id,action,reason,request,before_state,after_state)
    values(p_request_id,p_actor_id,'settings_updated',public.membership_trim_text(p_reason),v_request,to_jsonb(v_before),to_jsonb(v_after)-'singleton');
  return to_jsonb(v_after)-'singleton';
end;
$$;

create or replace function public.admin_save_membership_wallet_route(p_route_id text,p_recipient text,p_enabled boolean,p_expected_revision integer,p_reason text,p_request_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_before public.membership_wallet_routes; v_after public.membership_wallet_routes; v_event public.membership_wallet_events; v_request jsonb; v_recipient text;
begin
  if p_actor_id is null or p_actor_id is distinct from auth.uid() or not public.is_admin() then raise exception 'admin_required'; end if;
  if p_route_id is null or p_enabled is null or p_expected_revision is null or p_expected_revision<1 or p_request_id is null
    or p_reason is null or length(public.membership_trim_text(p_reason)) not between 3 and 500 then raise exception 'membership_input_invalid'; end if;
  select * into v_before from public.membership_wallet_routes where id=p_route_id;
  if not found or p_route_id not in ('tron-usdt','bsc-usdt') then raise exception 'membership_wallet_route_invalid'; end if;
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

create or replace function public.prepare_membership_wallet_order(p_actor_id uuid,p_price_id uuid,p_route_id text,p_request_id uuid,p_expected_quote jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_order public.membership_wallet_orders; v_price public.membership_prices; v_plan public.membership_plans;
  v_route public.membership_wallet_routes; v_settings public.membership_wallet_settings; v_quote jsonb;
  v_base numeric(78,0); v_units numeric(78,0); v_scale numeric(78,0); v_seed integer; v_tail integer;
begin
  if p_actor_id is null or p_price_id is null or p_route_id is null or p_request_id is null or p_expected_quote is null or jsonb_typeof(p_expected_quote)<>'object' then raise exception 'membership_input_invalid'; end if;
  perform 1 from public.profiles where id=p_actor_id for no key update;
  if not public.membership_user_is_eligible(p_actor_id) then raise exception 'account_ineligible'; end if;
  perform pg_advisory_xact_lock(hashtextextended('wallet_order_request:'||p_request_id::text,0));
  select * into v_order from public.membership_wallet_orders where request_id=p_request_id for update;
  if found then
    if v_order.buyer_id<>p_actor_id or v_order.price_id<>p_price_id or v_order.route_id<>p_route_id or v_order.expected_quote<>p_expected_quote then raise exception 'request_conflict'; end if;
    if v_order.status='pending' and v_order.expires_at<=now() then update public.membership_wallet_orders set status='expired',updated_at=now() where id=v_order.id; end if;
    return public.membership_wallet_order_receipt(v_order.id);
  end if;
  select * into v_settings from public.membership_wallet_settings where singleton for share;
  select * into v_route from public.membership_wallet_routes where id=p_route_id for share;
  if not v_settings.enabled or v_route.id not in ('tron-usdt','bsc-usdt') or not v_route.enabled or v_route.recipient is null or v_route.asset<>'USDT' then raise exception 'membership_wallet_unavailable'; end if;
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
  v_scale:=power(10::numeric,v_route.decimals-6); v_base:=v_price.amount_minor::numeric*10000::numeric*v_scale;
  perform pg_advisory_xact_lock(hashtextextended('wallet_amount:'||v_route.chain||':'||v_route.contract||':'||v_route.recipient||':'||v_base::text,0));
  v_seed:=((hashtextextended(gen_random_uuid()::text,0)&9223372036854775807)%9999)::integer;
  for i in 0..9998 loop
    v_tail:=(v_seed+i)%9999+1; v_units:=v_base+v_tail::numeric*v_scale;
    exit when not exists(select 1 from public.membership_wallet_orders where chain=v_route.chain and contract=v_route.contract and recipient=v_route.recipient and amount_units=v_units);
    v_units:=null;
  end loop;
  if v_units is null then raise exception 'membership_wallet_amount_pool_exhausted'; end if;
  insert into public.membership_wallet_orders(buyer_id,request_id,price_id,plan_key,price_revision,plan_revision,route_id,route_revision,chain,asset,contract,recipient,
    amount_minor,term_months,token_decimals,base_amount_units,amount_units,title_snapshot,description_snapshot,benefits_snapshot,ai_daily_limit_snapshot,mentor_discount_bps_snapshot,expected_quote)
    values(p_actor_id,p_request_id,v_price.id,v_plan.key,v_price.revision,v_plan.revision,v_route.id,v_route.revision,v_route.chain,v_route.asset,v_route.contract,v_route.recipient,
      v_price.amount_minor,v_price.term_months,v_route.decimals,v_base,v_units,v_plan.title,v_plan.description,v_plan.benefits,v_plan.ai_daily_limit,v_plan.mentor_discount_bps,v_quote) returning * into v_order;
  return public.membership_wallet_order_receipt(v_order.id);
end;
$$;

create or replace function public.apply_verified_membership_wallet_transfer(p_order_id uuid,p_lease_id uuid,p_evidence jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_order public.membership_wallet_orders; v_job public.membership_wallet_verifications; v_receipt public.membership_wallet_receipts;
  v_paid timestamptz; v_units numeric(78,0); v_event bigint; v_grant uuid; v_start timestamptz; v_outcome text;
begin
  if p_evidence is null or jsonb_typeof(p_evidence)<>'object' or p_evidence->'finalized' is distinct from 'true'::jsonb
    or jsonb_typeof(p_evidence->'chain') is distinct from 'string' or jsonb_typeof(p_evidence->'contract') is distinct from 'string'
    or jsonb_typeof(p_evidence->'recipient') is distinct from 'string' or jsonb_typeof(p_evidence->'amount_units') is distinct from 'string'
    or (p_evidence->>'amount_units') !~ '^[1-9][0-9]{0,77}$' or jsonb_typeof(p_evidence->'tx_hash') is distinct from 'string'
    or jsonb_typeof(p_evidence->'event_index') is distinct from 'number' or (p_evidence->>'event_index') !~ '^[0-9]+$'
    or jsonb_typeof(p_evidence->'block_number') is distinct from 'number' or (p_evidence->>'block_number') !~ '^[1-9][0-9]*$'
    or jsonb_typeof(p_evidence->'block_hash') is distinct from 'string'
    or jsonb_typeof(p_evidence->'paid_at') is distinct from 'string' or (select count(*) from jsonb_object_keys(p_evidence))<>10
    then raise exception 'membership_wallet_evidence_invalid'; end if;
  begin
    if (p_evidence->>'event_index')::numeric>9007199254740991 or (p_evidence->>'block_number')::numeric>9007199254740991 then raise exception 'membership_wallet_evidence_invalid'; end if;
    v_paid:=(p_evidence->>'paid_at')::timestamptz; v_units:=(p_evidence->>'amount_units')::numeric(78,0); v_event:=(p_evidence->>'event_index')::bigint;
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
  perform pg_advisory_xact_lock(hashtextextended('wallet_event:'||v_order.chain||':'||(p_evidence->>'tx_hash')||':'||v_event::text,0));
  select * into v_receipt from public.membership_wallet_receipts where chain=v_order.chain and tx_hash=p_evidence->>'tx_hash' and event_index=v_event;
  if found then
    if v_receipt.order_id<>p_order_id or v_receipt.evidence<>p_evidence then raise exception 'membership_wallet_receipt_conflict'; end if;
    return jsonb_build_object('duplicate',true,'applied',false,'order_id',p_order_id,'order_status',v_order.status,'grant_id',(select id from public.membership_wallet_grants where order_id=p_order_id),'outcome',v_receipt.outcome);
  end if;
  select * into v_job from public.membership_wallet_verifications where order_id=p_order_id and tx_hash=p_evidence->>'tx_hash' for update;
  if v_job.id is null or p_lease_id is null or v_job.status<>'leased' or v_job.lease_id is distinct from p_lease_id or v_job.lease_expires_at<=clock_timestamp() then raise exception 'membership_wallet_lease_invalid'; end if;
  if v_order.status in ('paid','revoked') then v_outcome:='review';
  elsif v_units<>v_order.amount_units or v_paid<v_order.created_at or v_paid>v_order.expires_at then
    v_outcome:='review'; update public.membership_wallet_orders set status='review',updated_at=now() where id=p_order_id;
  else
    v_start:=public.membership_wallet_renewal_start(v_order.buyer_id,v_order.plan_key,v_paid,'live');
    update public.membership_wallet_orders set status='paid',paid_at=v_paid,updated_at=now() where id=p_order_id;
    insert into public.membership_wallet_grants(order_id,user_id,plan_key,starts_at,ends_at,title_snapshot,benefits_snapshot,ai_daily_limit_snapshot,mentor_discount_bps_snapshot)
      values(p_order_id,v_order.buyer_id,v_order.plan_key,v_start,v_start+make_interval(months=>v_order.term_months),v_order.title_snapshot,v_order.benefits_snapshot,v_order.ai_daily_limit_snapshot,v_order.mentor_discount_bps_snapshot) returning id into v_grant;
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

revoke all on function public.membership_wallet_order_receipt(uuid),public.list_membership_wallet_routes(),public.admin_membership_wallet_store(uuid),
  public.admin_save_membership_wallet_settings(boolean,integer,text,uuid,uuid),public.admin_save_membership_wallet_route(text,text,boolean,integer,text,uuid,uuid),
  public.prepare_membership_wallet_order(uuid,uuid,text,uuid,jsonb),public.apply_verified_membership_wallet_transfer(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.list_membership_wallet_routes() to anon,authenticated,service_role;
grant execute on function public.admin_membership_wallet_store(uuid),public.admin_save_membership_wallet_settings(boolean,integer,text,uuid,uuid),
  public.admin_save_membership_wallet_route(text,text,boolean,integer,text,uuid,uuid) to authenticated;
grant execute on function public.prepare_membership_wallet_order(uuid,uuid,text,uuid,jsonb),public.apply_verified_membership_wallet_transfer(uuid,uuid,jsonb) to service_role;

create or replace function public.wavekb_schema_version()
returns text language sql stable as $$ select '202611260001'; $$;
revoke all on function public.wavekb_schema_version() from public,anon,authenticated,service_role;
grant execute on function public.wavekb_schema_version() to anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
