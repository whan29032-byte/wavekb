import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID, webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { createCheckoutDatabase } from './helpers/mentor-checkout-database.mjs';
import vm from 'node:vm';

const ids={admin:'11111111-1111-4111-8111-111111111111',member:'22222222-2222-4222-8222-222222222222',other:'33333333-3333-4333-8333-333333333333'};
const recipient='0x1111111111111111111111111111111111111111';
const tronRecipient='TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7';
const load=name=>readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8');
const value=async(db,sql,args=[]) => (await db.query(`select ${sql} as value`,args)).rows[0].value;
async function actor(db,id,role='authenticated') { await db.exec(`reset role; set role ${role};`); await db.query("select set_config('test.actor',$1,false)",[id||'']); }
async function fixture(run) {
  const db=await createCheckoutDatabase();
  try {
    await db.exec(`grant usage on schema auth to anon,authenticated,service_role;
      insert into auth.users values('${ids.admin}',now()),('${ids.member}',now()),('${ids.other}',now())
        on conflict(id) do update set email_confirmed_at=excluded.email_confirmed_at;
      insert into profiles(id,public_uid,display_name,account_status,role) values
        ('${ids.admin}',10001,'管理员','active','admin'),('${ids.member}',10002,'测试用户','active','user'),('${ids.other}',10003,'其他用户','active','user')
        on conflict(id) do update set public_uid=excluded.public_uid,display_name=excluded.display_name,account_status=excluded.account_status,role=excluded.role;
      create table public.workbench_analyses(id uuid primary key,owner_id uuid not null,schema_version text default 'workbench-v1');
      create table public.ai_providers(id uuid primary key,enabled boolean default true);
      create table public.ai_models(id uuid primary key,provider_id uuid references ai_providers,enabled boolean default true);
      create table public.ai_task_routes(task_type text primary key,primary_model_id uuid references ai_models,enabled boolean default true);
      create table public.ai_provider_secrets(id uuid primary key default gen_random_uuid(),provider_id uuid references ai_providers,active boolean default true);
      create table public.user_ai_connections(id uuid primary key,owner_id uuid not null,enabled boolean default true);
      create table public.ai_jobs(id uuid primary key default gen_random_uuid(),owner_id uuid not null,analysis_id uuid,
        task_type text not null,idempotency_key text unique not null,status text not null default 'queued',input_payload jsonb not null default '{}',
        knowledge_version text,user_connection_id uuid references user_ai_connections on delete set null,connection_snapshot jsonb not null default '{}',
        created_at timestamptz not null default now(),finished_at timestamptz);
      alter table ai_jobs enable row level security;
      create policy "owners create ai jobs" on ai_jobs for insert to authenticated with check(owner_id=auth.uid());
      create policy "owners read ai jobs" on ai_jobs for select to authenticated using(owner_id=auth.uid());
      grant select,insert,update on ai_jobs to authenticated;`);
    await db.exec((await load('202608140001_account_enforcement.sql')).match(/create or replace function public\.account_is_active\(\)[\s\S]+?\$\$;/)[0]);
    await db.exec((await load('202610100001_admin_payment_hardening.sql')).match(/create or replace function public\.is_admin\(\)[\s\S]+?\$\$;/)[0]);
    await db.exec(await load('202610100002_membership_foundation.sql'));
    await db.exec(await load('202610100003_membership_commerce.sql'));
    await db.exec(await load('202610100004_membership_benefits.sql'));
    assert.equal(await value(db,'wavekb_schema_version()'),'202610100004');
    await db.exec(await load('202610100005_membership_wallet_payments.sql'));
    await actor(db,ids.admin); await run(db);
  } finally { await db.close(); }
}
async function store(db) { await actor(db,ids.admin); return value(db,'admin_membership_wallet_store(auth.uid())'); }
async function setup(db,{route='ethereum-usdc',user=ids.member}={}) {
  let state=await store(db),r=state.routes.find(r=>r.id===route);
  await value(db,'admin_save_membership_wallet_route($1,$2,true,$3,\'测试公开地址配置\',$4,auth.uid())',[route,r.chain==='tron'?tronRecipient:recipient,r.revision,randomUUID()]);
  await value(db,'admin_save_membership_wallet_settings(true,1,\'测试钱包启用\',$1,auth.uid())',[randomUUID()]);
  const commerce=await value(db,'admin_membership_commerce_store(auth.uid())'),plan=commerce.plans[0],price=plan.prices.find(p=>p.term_months===1);
  state=await store(db);r=state.routes.find(r=>r.id===route);
  return {user,route:r,plan,price,quote:{price_id:price.id,plan_key:plan.key,price_revision:price.revision,plan_revision:plan.revision,amount_minor:price.amount_minor,currency:price.currency,term_months:price.term_months,route_revision:r.revision}};
}
async function prepare(db,c,{user=c.user,request=randomUUID(),quote=c.quote}={}) {
  await actor(db,null,'service_role');return value(db,'prepare_membership_wallet_order($1,$2,$3,$4,$5::jsonb)',[user,c.price.id,c.route.id,request,JSON.stringify(quote)]);
}
const tx=(chain='ethereum',digit='a')=>(chain==='tron'?'':'0x')+digit.repeat(64);
async function submit(db,order,hash=tx(order.chain),user=order.buyer_id) {
  await actor(db,user);return value(db,'submit_membership_wallet_transfer(auth.uid(),$1,$2)',[order.id,hash]);
}
async function claim(db) { await actor(db,null,'service_role');return value(db,"claim_membership_wallet_verifications(10,'isolated-test-worker')"); }
function proof(order,overrides={}) { return {chain:order.chain,contract:order.contract,recipient:order.recipient,amount_units:order.amount_units,
  tx_hash:tx(order.chain),event_index:0,block_number:100,block_hash:tx(order.chain,'b'),paid_at:order.created_at,finalized:true,...overrides}; }
async function apply(db,order,job,evidence=proof(order)) {
  await actor(db,null,'service_role');return value(db,'apply_verified_membership_wallet_transfer($1,$2,$3::jsonb)',[order.id,job.lease_id,JSON.stringify(evidence)]);
}
async function paid(db,c,{hash=tx(c.route.chain),proofOverrides={},request=randomUUID()}={}) {
  const order=await prepare(db,c,{request});await submit(db,order,hash);const job=(await claim(db)).find(j=>j.order_id===order.id);
  const receipt=await apply(db,order,job,proof(order,{tx_hash:hash,...proofOverrides}));return {order,job,receipt};
}
async function effective(db) { await actor(db,ids.member);return value(db,'get_effective_membership_entitlements(auth.uid())'); }
async function mine(db) { await actor(db,ids.member);return value(db,'get_my_membership_wallet(auth.uid())'); }
async function stripePrepare(db,c,request=randomUUID()) {
  await db.exec("reset role;update membership_commerce_settings set billing_enabled=true,payment_mode='live'");
  await actor(db,null,'service_role');const {route_revision,...quote}=c.quote;
  return value(db,'prepare_membership_order($1,$2,$3,$4::jsonb)',[ids.member,c.price.id,request,JSON.stringify(quote)]);
}
async function stripePay(db,order,at=new Date().toISOString()) {
  await actor(db,null,'service_role');
  const suffix=order.id.replaceAll('-','');
  await value(db,"register_membership_checkout_session($1,$2,$3,'https://checkout.stripe.com/c/pay/test',now()+interval '1 day',true)",[order.buyer_id,order.id,`cs_${suffix}`]);
  return value(db,"apply_verified_membership_payment_event($1,'checkout.session.completed',$2,$3,$4,$5,$6,'USD','paid',true,$7::timestamptz)",[`evt_${suffix}`,order.id,order.buyer_id,`cs_${suffix}`,`pi_${suffix}`,order.amount_minor,at]);
}
async function ageInvoice(db,o) {
  await db.exec('reset role;alter table membership_wallet_orders disable trigger membership_wallet_order_guard');
  await db.query("update membership_wallet_orders set created_at=now()-interval '31 minutes',expires_at=now()-interval '1 minute' where id=$1",[o.id]);
  await db.exec('alter table membership_wallet_orders enable trigger membership_wallet_order_guard');
}

test('wallet defaults closed with exactly four immutable issuer contracts, no recipient or executable rights',()=>fixture(async db=>{
  await actor(db,null,'anon');const c=await value(db,'list_membership_wallet_routes()');assert.equal(c.settings.enabled,false);assert.equal(c.purchase_available,false);
  assert.deepEqual(c.routes.map(r=>[r.id,r.chain,r.asset,r.contract,r.decimals]),[
    ['base-usdc','base','USDC','0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',6],
    ['ethereum-usdc','ethereum','USDC','0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',6],
    ['ethereum-usdt','ethereum','USDT','0xdac17f958d2ee523a2206206994597c13d831ec7',6],
    ['tron-usdt','tron','USDT','TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',6]]);
  assert.ok(c.routes.every(r=>r.recipient===null&&!r.enabled));assert.equal((await effective(db)).has_vip,false);
  await db.exec('reset role');await assert.rejects(db.query("update membership_wallet_routes set contract='fake'"),/membership_wallet_route_immutable/);
  await assert.rejects(db.query("delete from membership_wallet_routes"),/membership_wallet_route_immutable/);
}));
test('RLS and RPC grants deny fabrication, private reads, cross-account submit and banned admins',()=>fixture(async db=>{
  const c=await setup(db),o=await prepare(db,c);
  for(const role of ['anon','authenticated','service_role']) { await actor(db,ids.member,role);
    for(const table of ['membership_wallet_settings','membership_wallet_routes','membership_wallet_orders','membership_wallet_grants','membership_wallet_verifications','membership_wallet_receipts','membership_wallet_events']) {
      await assert.rejects(db.query(`select * from ${table}`),/permission denied/);await assert.rejects(db.query(`delete from ${table}`),/permission denied/);
    }
  }
  await actor(db,ids.member);await assert.rejects(value(db,'admin_membership_wallet_store(auth.uid())'),/admin_required/);
  await assert.rejects(value(db,'get_my_membership_wallet($1)',[ids.other]),/account_ineligible/);
  await assert.rejects(value(db,"claim_membership_wallet_verifications(1,'fake')"),/permission denied/);
  await assert.rejects(value(db,'apply_verified_membership_wallet_transfer($1,$2,\'{}\')',[o.id,randomUUID()]),/permission denied/);
  await assert.rejects(value(db,'membership_wallet_renewal_start(auth.uid(),\'vip\',now(),\'live\')'),/permission denied/);
  await assert.rejects(value(db,'membership_wallet_tron_address_valid($1)',[tronRecipient]),/permission denied/);
  await assert.rejects(submit(db,o,tx(),ids.other),/order_access_denied/);
  await db.exec('reset role');await db.query("update profiles set account_status='banned' where id=$1",[ids.admin]);await actor(db,ids.admin);
  await assert.rejects(value(db,"admin_save_membership_wallet_settings(false,2,'禁止失活越权',$1,auth.uid())",[randomUUID()]),/admin_required/);
}));
test('admin CAS audit normalizes EVM recipient and Unicode reason, rejects null recipient and conflicting replay',()=>fixture(async db=>{
  const request=randomUUID(),sql="admin_save_membership_wallet_route('ethereum-usdc',$1,true,1,$2,$3,auth.uid())";
  const args=[recipient.toUpperCase().replace('0X','0x'),'\u00a0😀😀😀\t',request];
  const saved=await value(db,sql,args);assert.equal(saved.recipient,recipient);assert.equal(saved.revision,2);assert.deepEqual(await value(db,sql,args),saved);
  await assert.rejects(value(db,sql,[recipient,'不同原因',request]),/request_conflict/);
  await assert.rejects(value(db,sql,[recipient,'失效版本',randomUUID()]),/membership_changed_concurrently/);
  await assert.rejects(value(db,"admin_save_membership_wallet_route('base-usdc',null,true,1,'不准空地址',$1,auth.uid())",[randomUUID()]),/membership_input_invalid/);
  await assert.rejects(value(db,"admin_save_membership_wallet_route('base-usdc','0x0000000000000000000000000000000000000000',true,1,'不准零地址',$1,auth.uid())",[randomUUID()]),/membership_input_invalid/);
  await assert.rejects(value(db,"admin_save_membership_wallet_route('tron-usdc',null,false,1,'不准新增资产',$1,auth.uid())",[randomUUID()]),/membership_wallet_route_invalid/);
  await assert.rejects(value(db,"admin_save_membership_wallet_route('tron-usdt',$1,true,1,'拒绝错误校验和',$2,auth.uid())",[tronRecipient.slice(0,-1)+'8',randomUUID()]),/membership_input_invalid/);
  assert.equal((await store(db)).history[0].reason,'😀😀😀');
}));
test('invoice exact six-decimal amount is USD cents*10000 plus permanent 1..9999 tail, never cents or floating point',()=>fixture(async db=>{
  const c=await setup(db),request=randomUUID(),orders=await Promise.all(Array.from({length:5},()=>prepare(db,c,{request})));const o=orders[0];
  assert.ok(orders.every(x=>x.id===o.id));assert.equal(o.base_amount_units,'52000000');const tail=BigInt(o.amount_units)-52000000n;assert.ok(tail>=1n&&tail<=9999n);
  assert.equal(o.amount_decimal,`${BigInt(o.amount_units)/1000000n}.${(BigInt(o.amount_units)%1000000n).toString().padStart(6,'0')}`);
  assert.equal(Date.parse(o.expires_at)-Date.parse(o.created_at),1800000);assert.equal(o.status,'pending');assert.equal((await effective(db)).has_vip,false);
  await assert.rejects(prepare(db,c,{request,quote:{...c.quote,amount_minor:1}}),/request_conflict/);
  await assert.rejects(prepare(db,c,{request,user:ids.other}),/request_conflict/);
  await db.exec('reset role');await assert.rejects(db.query('delete from membership_wallet_orders where id=$1',[o.id]),/membership_wallet_order_immutable/);
  await assert.rejects(db.query('update membership_wallet_orders set amount_units=amount_units+1 where id=$1',[o.id]),/membership_wallet_order_immutable/);
}));
test('full frozen quote, USD-only price, eligibility, route switches and pending recovery fail closed',()=>fixture(async db=>{
  const c=await setup(db);for(const quote of [{...c.quote,route_revision:1},{...c.quote,extra:true},{...c.quote,plan_revision:1}]) await assert.rejects(prepare(db,c,{quote}),/membership_wallet_quote_changed/);
  const o=await prepare(db,c);await actor(db,ids.admin);await value(db,"admin_save_membership_wallet_settings(false,2,'停止创建钱包单',$1,auth.uid())",[randomUUID()]);
  await assert.rejects(prepare(db,c,{request:o.request_id}),/membership_wallet_unavailable/);
  await db.exec('reset role');await db.query("update profiles set account_status='banned' where id=$1",[ids.member]);await assert.rejects(prepare(db,c,{request:o.request_id}),/account_ineligible/);
  await db.exec('reset role');await db.query("update profiles set account_status='active' where id=$1",[ids.member]);await db.exec('update membership_wallet_settings set enabled=true;update membership_plans set enabled=false');
  await assert.rejects(prepare(db,c,{request:o.request_id}),/membership_plan_disabled/);
}));
test('both rails atomically exclude another active pending invoice without changing old acknowledgements',()=>fixture(async db=>{
  const c=await setup(db),o=await prepare(db,c);await assert.rejects(prepare(db,c),/membership_pending_order_exists/);await assert.rejects(stripePrepare(db,c),/membership_pending_order_exists/);
  assert.equal((await prepare(db,c,{request:o.request_id})).id,o.id);
  await db.exec('reset role');await db.query("update membership_wallet_orders set status='review' where id=$1",[o.id]);
  await assert.rejects(prepare(db,c),/membership_pending_order_exists/);await assert.rejects(stripePrepare(db,c),/membership_pending_order_exists/);
  await ageInvoice(db,o);
  const stripe=await stripePrepare(db,c);await assert.rejects(prepare(db,c),/membership_pending_order_exists/);
  await db.exec('reset role');await db.query("update membership_orders set status='expired' where id=$1",[stripe.id]);assert.ok((await prepare(db,c)).id);
}));
test('all four routes retain canonical contract and owner tx submit is only a normalized idempotent queue',()=>fixture(async db=>{
  const c=await setup(db,{route:'tron-usdt'}),o=await prepare(db,c),hash=tx('tron').toUpperCase();const a=await submit(db,o,hash),b=await submit(db,o,hash);
  assert.deepEqual(a,b);assert.equal(a.verification.tx_hash,hash.toLowerCase());assert.equal(a.verification.status,'queued');assert.equal(a.order.status,'pending');assert.equal((await effective(db)).has_vip,false);
  await assert.rejects(submit(db,o,tx('ethereum')),/membership_wallet_transfer_invalid/);
  const my=await mine(db);assert.equal(my.verifications.length,1);assert.equal(my.orders.length,1);assert.equal(my.verifications[0].order_id,o.id);
}));
test('leases fence stale workers; network waiting keeps pending and grants nothing; review remains non-payment',()=>fixture(async db=>{
  const c=await setup(db),o=await prepare(db,c);await submit(db,o);const job=(await claim(db))[0];assert.equal(job.status,'leased');assert.equal(job.attempts,1);assert.equal(job.order.id,o.id);assert.equal((await claim(db)).length,0);
  await assert.rejects(apply(db,o,{...job,lease_id:randomUUID()}),/membership_wallet_lease_invalid/);
  await actor(db,null,'service_role');const waited=await value(db,"settle_membership_wallet_verification($1,$2,'waiting','未达到链最终性',5)",[job.id,job.lease_id]);assert.equal(waited.status,'waiting');assert.equal((await mine(db)).orders[0].status,'pending');
  await db.exec('reset role');await db.query('update membership_wallet_verifications set next_attempt_at=now()-interval \'1 second\' where id=$1',[job.id]);
  const retry=(await claim(db))[0];assert.notEqual(retry.lease_id,job.lease_id);await assert.rejects(apply(db,o,job),/membership_wallet_lease_invalid/);
  await actor(db,null,'service_role');await value(db,"settle_membership_wallet_verification($1,$2,'review','链上转账不符合订单',5)",[retry.id,retry.lease_id]);assert.equal((await mine(db)).orders[0].status,'review');assert.equal((await effective(db)).has_vip,false);
}));
test('canonical finalized transfer pays exactly once; receipt replay cannot duplicate or rebind another event',()=>fixture(async db=>{
  const c=await setup(db),{order,job,receipt}=await paid(db,c);assert.equal(receipt.applied,true);assert.equal(receipt.order_status,'paid');assert.equal((await effective(db)).has_vip,true);
  assert.equal((await apply(db,order,job)).duplicate,true);await assert.rejects(apply(db,order,job,proof(order,{block_hash:tx('ethereum','c')})),/membership_wallet_receipt_conflict/);
  const my=await mine(db);assert.equal(my.purchase_grants.length,1);assert.equal(my.orders[0].paid_at,proof(order).paid_at);assert.equal(my.verifications[0].status,'settled');
  await db.exec('reset role');await assert.rejects(db.query("update membership_wallet_orders set status='pending' where id=$1",[order.id]),/membership_wallet_order_terminal/);
  await assert.rejects(db.query('update membership_wallet_grants set ai_daily_limit_snapshot=999 where order_id=$1',[order.id]),/membership_purchase_grant_immutable/);
}));
test('wrong chain/token/recipient/finality or malformed evidence never records payment or consumes a lease',()=>fixture(async db=>{
  const c=await setup(db),o=await prepare(db,c);await submit(db,o);const job=(await claim(db))[0];
  for(const changes of [{chain:'base'},{contract:'0x'+'f'.repeat(40)},{recipient:'0x'+'f'.repeat(40)},{finalized:false},{amount_units:52000001},{event_index:-1},{block_number:0},{paid_at:'infinity'},{block_hash:'garbage'},{extra:true}]) await assert.rejects(apply(db,o,job,proof(o,changes)),/membership_wallet_evidence_invalid/);
  assert.equal((await effective(db)).has_vip,false);await db.exec('reset role');assert.equal(await value(db,'(select count(*)::int from membership_wallet_receipts)'),0);
  assert.equal((await apply(db,o,job)).applied,true);
}));
test('late, early, short and extra transfers become durable review receipts without refunds or authorizations',async()=>{
  const cases=[o=>({paid_at:new Date(Date.parse(o.created_at)-1000).toISOString()}),o=>({paid_at:new Date(Date.parse(o.expires_at)+1000).toISOString()}),o=>({amount_units:(BigInt(o.amount_units)-1n).toString()}),o=>({amount_units:(BigInt(o.amount_units)+1n).toString()})];
  for(let i=0;i<cases.length;i++) {
    await fixture(async db=>{
    const c=await setup(db);
    let o=await prepare(db,c);
    if(i===1) {
      await ageInvoice(db,o);
      o=await prepare(db,c,{request:o.request_id});
    }
    await submit(db,o,tx('ethereum',String(i+1)));const job=(await claim(db))[0];const r=await apply(db,o,job,proof(o,{tx_hash:job.tx_hash,...cases[i](o)}));assert.equal(r.outcome,'review');assert.equal(r.applied,false);
    const my=await mine(db);assert.ok(my.orders.every(o=>o.status==='review'));assert.equal(my.purchase_grants.length,0);assert.equal(my.effective.has_vip,false);
    });
  }
});
test('invoice expiry frees pending slot, never reuses amount, and in-window payment can be confirmed late while gates are off',()=>fixture(async db=>{
  const c=await setup(db),o=await prepare(db,c);
  // Move only this isolated fixture clock-relative invoice; production immutable guard remains tested elsewhere.
  await db.exec('reset role;alter table membership_wallet_orders disable trigger membership_wallet_order_guard');
  await db.query("update membership_wallet_orders set created_at=now()-interval '31 minutes',expires_at=now()-interval '1 minute' where id=$1",[o.id]);
  await db.exec('alter table membership_wallet_orders enable trigger membership_wallet_order_guard');
  const expired=await prepare(db,c,{request:o.request_id});assert.equal(expired.id,o.id);assert.equal(expired.status,'expired');
  const next=await prepare(db,c);assert.notEqual(next.amount_units,o.amount_units);
  await submit(db,expired);const job=(await claim(db))[0];await db.exec('reset role;update membership_wallet_settings set enabled=false;update membership_wallet_routes set enabled=false');
  const r=await apply(db,expired,job);assert.equal(r.applied,true);assert.equal((await effective(db)).has_vip,true);assert.equal((await mine(db)).orders.length,2);
}));
test('all 9999 occupied tails stay exhausted across terminal history rather than being reused',()=>fixture(async db=>{
  const c=await setup(db),o=await prepare(db,c);await db.exec('reset role');await db.query("update membership_wallet_orders set status='review' where id=$1",[o.id]);
  await ageInvoice(db,o);
  await db.query(`insert into membership_wallet_orders select (jsonb_populate_record(null::membership_wallet_orders,
    to_jsonb(o)||jsonb_build_object('id',gen_random_uuid(),'request_id',gen_random_uuid(),'status','expired','amount_units',o.base_amount_units+n))).*
    from membership_wallet_orders o cross join generate_series(1,9999) n where o.id=$1 and o.base_amount_units+n<>o.amount_units`,[o.id]);
  assert.equal(await value(db,'(select count(*)::int from membership_wallet_orders)'),9999);await assert.rejects(prepare(db,c),/membership_wallet_amount_pool_exhausted/);
}));
test('wallet snapshot survives edits, ban/disable/revoke fail closed, and effective entitlements aggregate max not sum',()=>fixture(async db=>{
  const c=await setup(db),{order}=await paid(db,c);
  await db.exec("reset role;update membership_plans set ai_daily_limit=80,mentor_discount_bps=2000;insert into membership_grants(user_id,plan_key,status,ends_at) values('"+ids.member+"','vip','active',now()+interval '1 year')");
  assert.equal((await effective(db)).ai_daily_limit,80);await db.exec("reset role;update membership_grants set status='revoked'");assert.equal((await effective(db)).ai_daily_limit,50);
  await actor(db,ids.member);assert.equal(await value(db,"has_membership_entitlement('ai_daily_analysis')"),true);
  await db.exec('reset role;update membership_plans set enabled=false');assert.equal((await effective(db)).has_vip,false);assert.equal((await mine(db)).purchase_grants[0].status,'disabled');
  await db.exec('reset role;update membership_plans set enabled=true');await db.query("update profiles set account_status='banned' where id=$1",[ids.member]);assert.equal((await effective(db)).has_vip,false);
  await db.exec('reset role');await db.query("update profiles set account_status='active' where id=$1",[ids.member]);await db.query("update membership_wallet_orders set status='revoked' where id=$1",[order.id]);await db.query("update membership_wallet_grants set status='revoked' where order_id=$1",[order.id]);
  assert.equal((await effective(db)).has_vip,false);await db.exec('reset role');await assert.rejects(db.query("update membership_wallet_grants set status='active' where order_id=$1",[order.id]),/membership_purchase_grant_immutable/);
}));
test('Stripe then wallet and wallet then Stripe extend separate periods; refund never retroactively shifts other grants',()=>fixture(async db=>{
  const c=await setup(db),stripe1=await stripePrepare(db,c);await stripePay(db,stripe1);
  const wallet=await paid(db,c),stripe2=await stripePrepare(db,c);await stripePay(db,stripe2);
  await db.exec('reset role');const sg=(await db.query('select order_id,starts_at,ends_at from membership_purchase_grants order by ends_at')).rows;
  const wg=(await db.query('select * from membership_wallet_grants')).rows[0];assert.equal(new Date(wg.starts_at).toISOString(),new Date(sg[0].ends_at).toISOString());assert.equal(new Date(sg[1].starts_at).toISOString(),new Date(wg.ends_at).toISOString());
  await actor(db,null,'service_role');const suffix=stripe1.id.replaceAll('-','');await value(db,"apply_verified_membership_refund_event($1,$2,$3,$4,$5,$6,'USD','succeeded',true)",[`evt_refund_${suffix}`,stripe1.id,ids.member,`pi_${suffix}`,`re_${suffix}`,stripe1.amount_minor]);
  await db.exec('reset role');assert.deepEqual((await db.query('select starts_at,ends_at from membership_wallet_grants where order_id=$1',[wallet.order.id])).rows[0],{starts_at:wg.starts_at,ends_at:wg.ends_at});
}));
test('Stripe replacement changes only renewal calculation and buyer lock; validation, errors, recovery and terminal guards remain identical',async()=>{
  const original=(await load('202610100003_membership_commerce.sql')).match(/create function public\.apply_verified_membership_payment_event\([\s\S]+?\n\$\$;/)[0];
  const replacement=(await load('202610100005_membership_wallet_payments.sql')).match(/create or replace function public\.apply_verified_membership_payment_event\([\s\S]+?\n\$\$;/)[0];
  const oldCalc=/    select greatest\(p_paid_at,coalesce\(max\(g\.ends_at\),p_paid_at\)\) into v_start[\s\S]+?o\.payment_mode=v_order\.payment_mode;/;
  assert.equal(replacement,original.replace('create function','create or replace function').replace(oldCalc,'    v_start:=public.membership_wallet_renewal_start(v_order.buyer_id,v_order.plan_key,p_paid_at,v_order.payment_mode);')
    .replace("  if v_order.id is null then raise exception 'order_not_found'; end if;","  if v_order.id is null then raise exception 'order_not_found'; end if;\n  perform 1 from public.profiles where id=v_order.buyer_id for no key update;"));
});

test('a globally claimed chain event cannot pay another buyer; a second real transfer is review without altering paid or granting twice',()=>fixture(async db=>{
  const c=await setup(db),first=await paid(db,c);const other=await prepare(db,c,{user:ids.other});await submit(db,other);const otherJob=(await claim(db))[0];
  await assert.rejects(apply(db,other,otherJob,proof(first.order)),/membership_wallet_receipt_conflict/);
  await submit(db,first.order,tx('ethereum','c'));const extra=(await claim(db)).find(j=>j.order_id===first.order.id);
  const r=await apply(db,first.order,extra,proof(first.order,{tx_hash:extra.tx_hash}));assert.equal(r.outcome,'review');assert.equal(r.applied,false);assert.equal(r.order_status,'paid');
  const my=await mine(db);assert.equal(my.purchase_grants.length,1);assert.equal(my.orders[0].status,'paid');assert.equal(my.verifications.find(v=>v.id===extra.id).status,'review');
  await db.exec('reset role');assert.equal(await value(db,'(select count(*)::int from membership_wallet_grants)'),1);
}));
test('a corrected hash on the same reviewed invoice can pay without permitting a new invoice to burn another nonce',()=>fixture(async db=>{
  const c=await setup(db),o=await prepare(db,c);await submit(db,o);const old=(await claim(db))[0];await apply(db,o,old,proof(o,{amount_units:(BigInt(o.amount_units)-1n).toString()}));
  await assert.rejects(prepare(db,c),/membership_pending_order_exists/);await assert.rejects(stripePrepare(db,c),/membership_pending_order_exists/);
  const s=await submit(db,o,tx('ethereum','d'));assert.equal(s.order.id,o.id);assert.equal(s.order.status,'review');assert.equal(s.verification.status,'queued');
  const job=(await claim(db))[0];assert.equal((await apply(db,o,job,proof(o,{tx_hash:job.tx_hash}))).applied,true);assert.equal((await effective(db)).has_vip,true);
}));
test('expired worker lease is reclaimed with a new token and neither old apply nor old settle can change it',()=>fixture(async db=>{
  const c=await setup(db),o=await prepare(db,c);await submit(db,o);const old=(await claim(db))[0];
  await db.exec('reset role');await db.query("update membership_wallet_verifications set lease_expires_at=now()-interval '1 second' where id=$1",[old.id]);
  await assert.rejects(apply(db,o,old),/membership_wallet_lease_invalid/);const current=(await claim(db))[0];assert.notEqual(current.lease_id,old.lease_id);assert.equal(current.attempts,2);
  await actor(db,null,'service_role');await assert.rejects(value(db,"settle_membership_wallet_verification($1,$2,'review','旧worker不能提交',30)",[old.id,old.lease_id]),/membership_wallet_lease_invalid/);
  assert.equal((await apply(db,o,current)).applied,true);
}));
test('unconfigured global enable, non-USD quotes, unverified buyers and historical route rotation all fail safely',()=>fixture(async db=>{
  await assert.rejects(value(db,"admin_save_membership_wallet_settings(true,1,'无地址不得开启',$1,auth.uid())",[randomUUID()]),/membership_wallet_unavailable/);
  const c=await setup(db),o=await prepare(db,c);await actor(db,ids.admin);
  await value(db,"admin_save_membership_wallet_route('ethereum-usdc',$1,true,2,'公开地址轮换测试',$2,auth.uid())",['0x2222222222222222222222222222222222222222',randomUUID()]);
  await assert.rejects(prepare(db,c,{request:o.request_id}),/membership_wallet_unavailable/);
  const original=(await mine(db)).orders[0];assert.equal(original.recipient,recipient);await submit(db,original);const job=(await claim(db))[0];assert.equal((await apply(db,original,job)).applied,true);
  await db.exec('reset role');await db.query('update auth.users set email_confirmed_at=null where id=$1',[ids.other]);await assert.rejects(prepare(db,c,{user:ids.other}),/account_ineligible/);
  await db.exec('reset role');await db.query('update auth.users set email_confirmed_at=now() where id=$1',[ids.other]);
  const foreignPrice=randomUUID();await actor(db,ids.admin);await value(db,"admin_save_membership_price($1,'vip',1,5200,'CNY',true,0,'非美元不做汇兑',$2,auth.uid())",[foreignPrice,randomUUID()]);
  const foreign={...c,price:{...c.price,id:foreignPrice,currency:'CNY'},quote:{...c.quote,price_id:foreignPrice,currency:'CNY',price_revision:1,route_revision:3}};
  await assert.rejects(prepare(db,foreign,{user:ids.other}),/membership_price_unavailable/);
}));

// Load production TS modules, replacing only their import URLs. No source/logic mocks.
const moduleUrls=new Map();
async function productionModuleUrl(relative) {
  const url=new URL(relative,import.meta.url);if(moduleUrls.has(url.href)) return moduleUrls.get(url.href);
  const pending=(async()=>{
    let source=stripTypeScriptTypes(await readFile(url,'utf8'));
    const imports=[...source.matchAll(/from\s+["'](\.[^"']+)["']/g)];
    for(const entry of imports) {
      const specifier=entry[1],target=new URL(specifier+(specifier.endsWith('.ts')?'':'.ts'),url);
      const converted=await productionModuleUrl(target.href);source=source.replace(entry[0],`from ${JSON.stringify(converted)}`);
    }
    return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  })();moduleUrls.set(url.href,pending);return pending;
}
async function productionModule(relative) { return import(await productionModuleUrl(relative)); }
async function checkoutEdge(db) {
  let handler;const source=stripTypeScriptTypes(await readFile(new URL('../supabase/functions/membership-wallet-checkout/index.ts',import.meta.url),'utf8'));
  const env={MEMBERSHIP_WALLET_ENABLED:'true',SUPABASE_URL:'https://isolated.example.com',SUPABASE_ANON_KEY:'synthetic-anon',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',SITE_ORIGIN:'https://wavekb.example.com'};
  vm.runInNewContext(source,{Deno:{env:{get:name=>env[name]},serve:fn=>{handler=fn;}},Response,Request,URL,TextEncoder,Uint8Array,AbortSignal,crypto:webcrypto,
    fetch:async(url,input={})=>{
      if(url==='https://isolated.example.com/auth/v1/user') return Response.json({id:ids.member,email_confirmed_at:'2026-01-01T00:00:00Z'});
      assert.equal(url,'https://isolated.example.com/rest/v1/rpc/prepare_membership_wallet_order');
      const p=JSON.parse(input.body);await actor(db,null,'service_role');
      try { return Response.json(await value(db,'prepare_membership_wallet_order($1,$2,$3,$4,$5::jsonb)',[p.p_actor_id,p.p_price_id,p.p_route_id,p.p_request_id,JSON.stringify(p.p_expected_quote)])); }
      catch(error) { return Response.json({message:error.message},{status:400}); }
    }});
  return handler;
}
async function sqlWorkerDatabase(db) {
  return {request:async(path,input)=>{
    const name=path.split('/').at(-1);assert.ok(['claim_membership_wallet_verifications','apply_verified_membership_wallet_transfer','settle_membership_wallet_verification'].includes(name));
    const keys=Object.keys(input.body);assert.ok(keys.every(key=>/^p_[a-z_]+$/.test(key)));await actor(db,null,'service_role');
    return value(db,`${name}(${keys.map((key,index)=>`${key}=>$${index+1}${key==='p_evidence'?'::jsonb':''}`).join(',')})`,keys.map(key=>key==='p_evidence'?JSON.stringify(input.body[key]):input.body[key]));
  }};
}
function canonicalNodeFetch(order,hash,addressModule) {
  const paidMs=Math.ceil(Date.parse(order.created_at)/1000)*1000,block=tx(order.chain,'b'),hex=BigInt(order.amount_units).toString(16).padStart(64,'0');
  const signature='ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',recipientHex=order.chain==='tron'?addressModule.tronAddressToHex(order.recipient).slice(2):order.recipient.slice(2);
  const log={address:order.chain==='tron'?addressModule.tronAddressToHex(order.contract).slice(2):order.contract,
    topics:[(order.chain==='tron'?'':'0x')+signature,(order.chain==='tron'?'':'0x')+'0'.repeat(24)+'2'.repeat(40),(order.chain==='tron'?'':'0x')+'0'.repeat(24)+recipientHex],
    data:(order.chain==='tron'?'':'0x')+hex,removed:false,transactionHash:hash,blockHash:block,blockNumber:'0x64',logIndex:'0x20'};
  const receipt={transactionHash:hash,blockHash:block,blockNumber:'0x64',status:'0x1',logs:[log]};
  return async(url,input)=>{
    const p=JSON.parse(input.body);
    if(order.chain==='tron') {
      const info={id:hash,blockNumber:100,blockTimeStamp:paidMs,receipt:{result:'SUCCESS'},log:[log]};
      if(url.endsWith('/gettransactioninfobyid')) return Response.json(info);
      if(url.endsWith('/getnowblock')) return Response.json({blockID:tx('tron','c'),block_header:{raw_data:{number:101,timestamp:paidMs+3000}}});
      assert.ok(url.endsWith('/getblockbynum'));assert.equal(p.num,100);return Response.json({blockID:block,block_header:{raw_data:{number:100,timestamp:paidMs}},transactions:[{txID:hash}]});
    }
    assert.equal(url,'https://rpc.example.com/');let result;
    if(p.method==='eth_chainId') result=order.chain==='base'?'0x2105':'0x1';
    else if(p.method==='eth_getTransactionReceipt') result=receipt;
    else { assert.equal(p.method,'eth_getBlockByNumber');result=p.params[0]==='finalized'?{number:'0x65',hash:tx(order.chain,'c')}:{number:'0x64',hash:block,timestamp:'0x'+(paidMs/1000).toString(16),transactions:[hash]}; }
    return Response.json({jsonrpc:'2.0',id:p.id,result});
  };
}
test('actual SQL receipts cross all four production Edge, web parser and worker/verifier routes without aliases or mocks of RPC contracts',async()=>{
  const web=await productionModule('../apps/web/src/lib/membership/wallet-types.ts'),contracts=await productionModule('../ai-gateway/src/membership-wallet/contracts.ts');
  const worker=await productionModule('../ai-gateway/src/membership-wallet/worker.ts'),address=await productionModule('../ai-gateway/src/membership-wallet/address.ts');
  for(const route of ['tron-usdt','ethereum-usdt','ethereum-usdc','base-usdc']) await fixture(async db=>{
    const c=await setup(db,{route});const definition=contracts.WALLET_ROUTES[route];assert.ok(definition);assert.deepEqual(web.walletRouteDefinitions[route],{chain:definition.chain,asset:definition.asset,contract:definition.contract});
    const edge=await checkoutEdge(db),request=randomUUID();const response=await edge(new Request('https://isolated.example.com/functions/v1/membership-wallet-checkout',{method:'POST',headers:{authorization:'Bearer synthetic-user'},body:JSON.stringify({actorId:ids.member,priceId:c.price.id,routeId:route,requestId:request,expectedQuote:c.quote})}));
    assert.equal(response.status,200);const {order}=await response.json();assert.equal(web.parseWalletOrder(order).route_id,route);assert.equal(order.contract,definition.contract);
    assert.equal((await edge(new Request('https://isolated.example.com/functions/v1/membership-wallet-checkout',{method:'POST',headers:{authorization:'Bearer synthetic-user'},body:JSON.stringify({actorId:ids.member,priceId:c.price.id,routeId:route,requestId:request,expectedQuote:c.quote})}))).status,200);
    await submit(db,order);await new Promise(resolve=>setTimeout(resolve,1100));
    const stats=await worker.runMembershipWalletVerificationCycle({database:await sqlWorkerDatabase(db),workerId:'sql-contract-worker',env:{MEMBERSHIP_WALLET_ENABLED:'true',MEMBERSHIP_WALLET_ETHEREUM_RPC_URL:'https://rpc.example.com',MEMBERSHIP_WALLET_BASE_RPC_URL:'https://rpc.example.com',MEMBERSHIP_WALLET_RPC_ALLOWED_HOSTS:'rpc.example.com'},fetch:canonicalNodeFetch(order,tx(order.chain),address)});
    assert.equal(stats.applied,1);assert.equal(stats.claimed,1);assert.equal(stats.review,0);assert.equal(stats.leaseLost,0);
    const my=web.parseMyMembershipWallet(await mine(db));assert.equal(my.orders[0].status,'paid');assert.equal(my.effective.has_vip,true);assert.equal(my.purchase_grants.length,1);assert.equal(my.verifications[0].status,'settled');
  });
});

test('005 atomically advances the actual 002→003→004 migration chain and grants the exact marker to every health-check role',()=>fixture(async db=>{
  for(const role of ['anon','authenticated','service_role']) {
    await actor(db,ids.member,role);assert.equal(await value(db,'wavekb_schema_version()'),'202610100005');
    await assert.rejects(value(db,'membership_wallet_tron_address_valid($1)',[tronRecipient]),/permission denied/);
  }
  await db.exec('reset role');assert.equal(await value(db,'membership_wallet_tron_address_valid($1)',[tronRecipient]),true);
  assert.equal(await value(db,'membership_wallet_tron_address_valid($1)',[tronRecipient.slice(0,-1)+'8']),false);
  assert.equal(await value(db,"membership_wallet_tron_address_valid('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')"),true);
}));

test('distinct-hash submissions are bounded per invoice and owner, but same-hash ACK recovery bypasses no-op limits',()=>fixture(async db=>{
  const c=await setup(db),o=await prepare(db,c),hash=n=>'0x'+n.toString(16).padStart(64,'0');
  const first=await submit(db,o,hash(1));await submit(db,o,hash(2));await submit(db,o,hash(3));
  await assert.rejects(submit(db,o,hash(4)),/membership_wallet_verification_pending_limit/);
  assert.equal((await submit(db,o,hash(1))).verification.id,first.verification.id);
  for(const j of await claim(db)) { await actor(db,null,'service_role');await value(db,"settle_membership_wallet_verification($1,$2,'review','错误哈希可纠正',5)",[j.id,j.lease_id]); }
  await submit(db,o,hash(4));await submit(db,o,hash(5));
  await assert.rejects(submit(db,o,hash(6)),/membership_wallet_transfer_rate_limited/);
  assert.equal((await submit(db,o,hash(1))).verification.id,first.verification.id);
  // Isolated clock/status fixtures avoid a ten-minute wall-clock test; no live DB is touched.
  for(let n=6;n<=20;n++) {
    await db.exec("reset role;update membership_wallet_verifications set status='review',lease_id=null,lease_expires_at=null,created_at=now()-interval '11 minutes'");
    assert.equal((await submit(db,o,hash(n))).verification.status,'queued');
  }
  await assert.rejects(submit(db,o,hash(21)),/membership_wallet_transfer_order_limit/);
  assert.equal((await submit(db,o,hash(1))).verification.id,first.verification.id);
  await db.exec('reset role');assert.equal(await value(db,'(select count(*)::int from membership_wallet_verifications)'),20);
  assert.equal(await value(db,'(select count(*)::int from membership_wallet_grants)'),0);
}));

test('waiting on a wrong first hash does not prevent a corrected second hash from paying the same invoice exactly once',()=>fixture(async db=>{
  const c=await setup(db),o=await prepare(db,c);await submit(db,o,tx(o.chain,'e'));const old=(await claim(db))[0];
  await actor(db,null,'service_role');await value(db,"settle_membership_wallet_verification($1,$2,'waiting','transaction_pending',300)",[old.id,old.lease_id]);
  const correction=await submit(db,o,tx(o.chain,'d'));assert.equal(correction.order.id,o.id);assert.equal(correction.verification.status,'queued');
  const job=(await claim(db))[0];assert.equal(job.id,correction.verification.id);
  const evidence=proof(o,{tx_hash:job.tx_hash});assert.equal((await apply(db,o,job,evidence)).applied,true);assert.equal((await apply(db,o,job,evidence)).duplicate,true);
  assert.equal((await submit(db,o,job.tx_hash)).verification.id,job.id);
  const my=await mine(db);assert.equal(my.orders.length,1);assert.equal(my.orders[0].status,'paid');assert.equal(my.purchase_grants.length,1);assert.equal(my.effective.has_vip,true);
  assert.equal(my.verifications.find(v=>v.id===old.id).status,'review');
  assert.equal(my.verifications.find(v=>v.id===old.id).reason_code,'order_already_paid_reconciliation');
  assert.equal((await claim(db)).length,0);
}));

test('admin operations expose bounded correlated receipts and safe reason codes, never raw provider diagnostics',()=>fixture(async db=>{
  const c=await setup(db),o=await prepare(db,c);await submit(db,o);const job=(await claim(db))[0];
  await actor(db,null,'service_role');await value(db,"settle_membership_wallet_verification($1,$2,'waiting','synthetic_private_provider_diagnostic',5)",[job.id,job.lease_id]);
  let state=await store(db);assert.equal(state.orders[0].id,o.id);assert.equal(state.verifications[0].reason_code,'verification_waiting');
  assert.equal(JSON.stringify(state).includes('synthetic_private_provider_diagnostic'),false);assert.equal(state.receipts.length,0);
  await db.exec('reset role');await db.query("update membership_wallet_verifications set next_attempt_at=now()-interval '1 second' where id=$1",[job.id]);
  const current=(await claim(db))[0];await apply(db,o,current,proof(o,{amount_units:(BigInt(o.amount_units)-1n).toString()}));
  state=await store(db);assert.equal(state.receipts.length,1);assert.equal(state.receipts[0].reason_code,'payment_amount_mismatch');assert.equal(state.receipts[0].evidence,undefined);
  await actor(db,ids.member);await assert.rejects(value(db,'admin_membership_wallet_store(auth.uid())'),/admin_required/);
}));

test('admin paid-only revocation is audited, actor-bound and retryable, with no refund or resurrection from receipt replay',()=>fixture(async db=>{
  const c=await setup(db),{order,job}=await paid(db,c),request=randomUUID();
  const sql='admin_revoke_membership_wallet_order($1,$2,$3,$4)',args=[order.id,'\u00a0人工核对后撤销\t',request,ids.admin];
  await actor(db,ids.member);await assert.rejects(value(db,sql,args),/admin_required/);
  await actor(db,null,'service_role');await assert.rejects(value(db,sql,args),/permission denied/);
  await db.exec('reset role');await db.query("update profiles set account_status='banned' where id=$1",[ids.admin]);
  await actor(db,ids.admin);await assert.rejects(value(db,sql,args),/admin_required/);
  await db.exec('reset role');await db.query("update profiles set account_status='active' where id=$1",[ids.admin]);
  await actor(db,ids.admin);const revoked=await value(db,sql,args);assert.equal(revoked.order.id,order.id);assert.equal(revoked.order.status,'revoked');assert.equal(revoked.grant.order_id,order.id);assert.equal(revoked.grant.status,'revoked');
  assert.deepEqual(await value(db,sql,args),revoked);await assert.rejects(value(db,sql,[order.id,'另一个原因',request,ids.admin]),/request_conflict/);
  await assert.rejects(value(db,sql,[order.id,'不得重复执行',randomUUID(),ids.admin]),/membership_wallet_order_not_paid/);
  const state=await store(db);assert.equal(state.history.filter(e=>e.action==='wallet_order_revoked').length,1);assert.equal(state.history.find(e=>e.action==='wallet_order_revoked').reason,'人工核对后撤销');
  assert.equal((await effective(db)).has_vip,false);assert.equal((await apply(db,order,job)).duplicate,true);assert.equal((await mine(db)).orders[0].status,'revoked');
  await submit(db,order,tx(order.chain,'f'));const extra=(await claim(db))[0];const result=await apply(db,order,extra,proof(order,{tx_hash:extra.tx_hash}));assert.equal(result.outcome,'review');assert.equal(result.order_status,'revoked');assert.equal((await effective(db)).has_vip,false);
  await db.exec('reset role');assert.equal(await value(db,'(select count(*)::int from membership_wallet_grants)'),1);
  assert.equal(await value(db,'(select count(*)::int from membership_refunds)'),0);
}));

test('revocation rejects pending orders and rolls back both state changes if the mandatory audit cannot be written',()=>fixture(async db=>{
  const c=await setup(db),pending=await prepare(db,c);await actor(db,ids.admin);
  await assert.rejects(value(db,'admin_revoke_membership_wallet_order($1,$2,$3,auth.uid())',[pending.id,'待付不能撤销',randomUUID()]),/membership_wallet_order_not_paid/);
  await submit(db,pending);const job=(await claim(db))[0];await apply(db,pending,job);
  await db.exec(`reset role;create function test_wallet_audit_failure() returns trigger language plpgsql as $$ begin
    if new.action='wallet_order_revoked' then raise exception 'test_audit_failure'; end if;return new;end $$;
    create trigger test_wallet_audit_failure before insert on membership_wallet_events for each row execute function test_wallet_audit_failure();`);
  const request=randomUUID();await actor(db,ids.admin);
  await assert.rejects(value(db,'admin_revoke_membership_wallet_order($1,$2,$3,auth.uid())',[pending.id,'必须审计回滚',request]),/test_audit_failure/);
  const my=await mine(db);assert.equal(my.orders[0].status,'paid');assert.equal(my.purchase_grants[0].status,'active');assert.equal(my.effective.has_vip,true);
  await db.exec('reset role');assert.equal(await value(db,'(select count(*)::int from membership_wallet_events where request_id=$1)',[request]),0);
}));

test('revoking one wallet purchase preserves every other wallet/Stripe/manual period and entitlement source',()=>fixture(async db=>{
  const c=await setup(db),first=await paid(db,c),second=await paid(db,c,{hash:tx('ethereum','d')}),stripe=await stripePrepare(db,c);await stripePay(db,stripe);
  await actor(db,ids.admin);await value(db,"admin_change_membership($1,'vip','grant',now()+interval '1 year',0,'独立手工授予',$2,auth.uid())",[ids.member,randomUUID()]);
  await db.exec('reset role');const periods=(await db.query('select id,starts_at,ends_at,status from membership_wallet_grants order by id')).rows;
  const stripeBefore=(await db.query('select * from membership_purchase_grants')).rows,manualBefore=(await db.query('select * from membership_grants')).rows;
  await actor(db,ids.admin);await value(db,'admin_revoke_membership_wallet_order($1,$2,$3,auth.uid())',[first.order.id,'只撤销这一笔',randomUUID()]);
  assert.equal((await effective(db)).has_vip,true);assert.equal((await effective(db)).ai_daily_limit,50);
  await db.exec('reset role');const after=(await db.query('select id,starts_at,ends_at,status from membership_wallet_grants order by id')).rows;
  assert.deepEqual(after,periods.map(g=>({...g,status:g.id===first.receipt.grant_id?'revoked':g.status})));
  assert.deepEqual((await db.query('select * from membership_purchase_grants')).rows,stripeBefore);assert.deepEqual((await db.query('select * from membership_grants')).rows,manualBefore);
  assert.equal((await db.query('select status from membership_wallet_orders where id=$1',[second.order.id])).rows[0].status,'paid');
}));

test('manual renewal and both payment handlers serialize on the profile before the shared purchase lock, without reperiod triggers',async()=>{
  const source=await load('202610100005_membership_wallet_payments.sql');
  for(const name of ['apply_verified_membership_wallet_transfer','apply_verified_membership_payment_event','admin_revoke_membership_wallet_order']) {
    const fn=source.match(new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]+?\\n\\$\\$;`))[0];
    assert.ok(fn.indexOf('for no key update')<fn.indexOf("'membership_purchase:'"));assert.ok(fn.indexOf("'membership_purchase:'")<fn.indexOf('for update'));
  }
  assert.equal(/create trigger[^;]+on public\.membership_purchase_grants/i.test(source),false);
  assert.match(await load('202610100002_membership_foundation.sql'),/Lock the member row[\s\S]+?for no key update/);
});

test('bounded admin and owner histories deterministically correlate only the same latest 50 invoices even when timestamps tie',()=>fixture(async db=>{
  const c=await setup(db),o=await prepare(db,c);await db.exec('reset role');
  await db.query(`insert into membership_wallet_orders select (jsonb_populate_record(null::membership_wallet_orders,
    to_jsonb(o)||jsonb_build_object('id',gen_random_uuid(),'request_id',gen_random_uuid(),'status','expired',
      'created_at',now()-interval '31 minutes','expires_at',now()-interval '1 minute','amount_units',o.base_amount_units+n))).*
    from membership_wallet_orders o cross join generate_series(1,70) n where o.id=$1 and o.base_amount_units+n<>o.amount_units`,[o.id]);
  await db.exec(`insert into membership_wallet_verifications(order_id,tx_hash,status,reason)
    select id,'0x'||repeat('a',64),'review','synthetic_provider_secret_not_for_ui' from membership_wallet_orders;
    insert into membership_wallet_receipts(order_id,verification_id,chain,tx_hash,event_index,evidence,outcome)
    select o.id,v.id,o.chain,v.tx_hash,row_number() over(order by o.id),
      jsonb_build_object('amount_units',o.amount_units::text,'paid_at',o.created_at),'review'
    from membership_wallet_orders o join membership_wallet_verifications v on v.order_id=o.id;`);
  const admin=await store(db),my=await mine(db);
  for(const state of [admin,my]) {
    assert.equal(state.orders.length,50);assert.equal(state.verifications.length,50);
    const selected=new Set(state.orders.map(o=>o.id));assert.ok(state.verifications.every(v=>selected.has(v.order_id)));
    assert.equal(JSON.stringify(state).includes('synthetic_provider_secret_not_for_ui'),false);
  }
  assert.equal(admin.receipts.length,50);assert.ok(admin.receipts.every(r=>admin.orders.some(o=>o.id===r.order_id)));
  const web=await productionModule('../apps/web/src/lib/membership/wallet-types.ts');assert.equal(web.parseMyMembershipWallet(my).orders.length,50);
}));

test('successful correction retires other leased hashes and fences their workers without treating the old hashes as payments',()=>fixture(async db=>{
  const c=await setup(db),o=await prepare(db,c);await submit(db,o,tx(o.chain,'e'));await submit(db,o,tx(o.chain,'d'));
  const jobs=await claim(db),old=jobs.find(j=>j.tx_hash===tx(o.chain,'e')),good=jobs.find(j=>j.tx_hash===tx(o.chain,'d'));
  assert.equal((await apply(db,o,good,proof(o,{tx_hash:good.tx_hash}))).applied,true);
  await assert.rejects(apply(db,o,old,proof(o,{tx_hash:old.tx_hash})),/membership_wallet_lease_invalid/);
  await actor(db,null,'service_role');await assert.rejects(value(db,"settle_membership_wallet_verification($1,$2,'waiting','transaction_pending',60)",[old.id,old.lease_id]),/membership_wallet_lease_invalid/);
  const my=await mine(db),retired=my.verifications.find(v=>v.id===old.id);assert.equal(retired.status,'review');assert.equal(retired.lease_id,null);assert.equal(retired.reason_code,'order_already_paid_reconciliation');
  await db.exec('reset role');assert.equal(await value(db,'(select count(*)::int from membership_wallet_receipts)'),1);assert.equal(await value(db,'(select count(*)::int from membership_wallet_grants)'),1);
}));

test('owner throttling spans separate expired invoices but never another buyer or same-hash replay',()=>fixture(async db=>{
  const c=await setup(db),first=await prepare(db,c),hash=n=>'0x'+n.toString(16).padStart(64,'0');
  const original=await submit(db,first,hash(1));await submit(db,first,hash(2));await submit(db,first,hash(3));await ageInvoice(db,first);
  const second=await prepare(db,c);await submit(db,second,hash(4));await submit(db,second,hash(5));
  await assert.rejects(submit(db,second,hash(6)),/membership_wallet_transfer_rate_limited/);
  assert.equal((await submit(db,first,hash(1))).verification.id,original.verification.id);
  const other=await prepare(db,c,{user:ids.other});assert.equal((await submit(db,other,hash(6))).verification.status,'queued');
}));

test('final lease checks use wall-clock time after row locks, not a transaction-start timestamp that can survive lock waits',async()=>{
  const source=await load('202610100005_membership_wallet_payments.sql');
  for(const name of ['apply_verified_membership_wallet_transfer','settle_membership_wallet_verification']) {
    const fn=source.match(new RegExp(`create function public\\.${name}\\([\\s\\S]+?\\n\\$\\$;`))[0];
    assert.match(fn,/select \* into v_job[^;]+for update;[\s\S]+?lease_expires_at<=clock_timestamp\(\)/);
  }
});
