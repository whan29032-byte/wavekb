import assert from "node:assert/strict";
import test from "node:test";
import { createHmac,randomUUID,webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import vm from "node:vm";

const ids={admin:"11111111-1111-4111-8111-111111111111",member:"22222222-2222-4222-8222-222222222222",other:"33333333-3333-4333-8333-333333333333"};
const load=async(name)=>readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),"utf8");
async function actor(db,id,role="authenticated") { await db.exec(`reset role; set role ${role};`); await db.query("select set_config('test.actor',$1,false)",[id||""]); }
const value=async(db,sql,params=[]) => (await db.query(`select ${sql} as value`,params)).rows[0].value;
async function fixture(run,{customPlan=false}={}) {
  const db=new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor',true),'')::uuid $$;
      grant usage on schema auth to anon,authenticated,service_role;
      create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
      create table public.profiles(id uuid primary key,public_uid bigint,display_name text,account_status text,role text);
      insert into auth.users values('${ids.admin}',now()),('${ids.member}',now()),('${ids.other}',now());
      insert into profiles values('${ids.admin}',10001,'管理员','active','admin'),('${ids.member}',10002,'普通用户','active','user'),('${ids.other}',10003,'其他用户','active','user');`);
    await db.exec((await load("202608140001_account_enforcement.sql")).match(/create or replace function public\.account_is_active\(\)[\s\S]+?\$\$;/)[0]);
    await db.exec((await load("202610100001_admin_payment_hardening.sql")).match(/create or replace function public\.is_admin\(\)[\s\S]+?\$\$;/)[0]);
    await db.exec(await load("202610100002_membership_foundation.sql"));
    if(customPlan) await db.exec("update membership_plans set title='已配置的方案',description='保留操作员配置',revision=2,benefits='{\"custom_notes\":\"自定义权益\"}' where key='vip'");
    await db.exec(await load("202610100003_membership_commerce.sql"));
    await actor(db,ids.admin); await run(db);
  } finally { await db.close(); }
}
async function store(db) { return value(db,"admin_membership_commerce_store(auth.uid())"); }
async function setup(db,{mode="live",billing=true,published=true,enabled=true}={}) {
  let state=await store(db);
  await value(db,"admin_save_membership_plan('vip','VIP 会员','测试配置',$1::jsonb,$2,$3,'测试启用方案',$4,auth.uid())",[JSON.stringify({research_notes:"测试权益"}),enabled,state.plans[0].revision,randomUUID()]);
  const p=state.plans[0].prices.find((p)=>p.term_months===1);
  await value(db,"admin_save_membership_price($1,'vip',1,5200,'USD',$2,$3,'测试发布价格',$4,auth.uid())",[p.id,published,p.revision,randomUUID()]);
  await value(db,"admin_save_membership_commerce_settings($1,$2,1,'测试配置付款',$3,auth.uid())",[billing,mode,randomUUID()]);
  state=await store(db); const plan=state.plans[0],price=plan.prices.find((p)=>p.term_months===1);
  return {plan,price,quote:{price_id:price.id,plan_key:plan.key,price_revision:price.revision,plan_revision:plan.revision,amount_minor:price.amount_minor,currency:price.currency,term_months:price.term_months}};
}
async function prepare(db,config,{user=ids.member,request=randomUUID(),quote=config.quote}={}) {
  await actor(db,null,"service_role");
  return value(db,"prepare_membership_order($1,$2,$3,$4::jsonb)",[user,config.price.id,request,JSON.stringify(quote)]);
}
async function bind(db,order,{session=`cs_${order.id.replaceAll('-','')}`,mode=order.livemode,url="https://checkout.stripe.com/c/pay/cs_test",expires=new Date(Date.now()+864e5).toISOString()}={}) {
  await actor(db,null,"service_role");
  return value(db,"register_membership_checkout_session($1,$2,$3,$4,$5::timestamptz,$6)",[order.buyer_id,order.id,session,url,expires,mode]);
}
async function pay(db,order,{event=`evt_${randomUUID().replaceAll('-','')}`,type="checkout.session.completed",status="paid",amount=order.amount_minor,currency=order.currency,buyer=order.buyer_id,mode=order.livemode,intent=`pi_${order.id.replaceAll('-','')}`,paidAt="2026-10-10T00:00:00.000Z"}={}) {
  await actor(db,null,"service_role");
  return value(db,"apply_verified_membership_payment_event($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz)",[event,type,order.id,buyer,order.provider_session_id,intent,amount,currency,status,mode,paidAt]);
}
async function refund(db,order,{event=`evt_${randomUUID().replaceAll('-','')}`,id=`re_${randomUUID().replaceAll('-','')}`,status="succeeded",amount=order.amount_minor,buyer=order.buyer_id,intent=`pi_${order.id.replaceAll('-','')}`,mode=order.livemode}={}) {
  await actor(db,null,"service_role");
  return value(db,"apply_verified_membership_refund_event($1,$2,$3,$4,$5,$6,$7,$8,$9)",[event,order.id,buyer,intent,id,amount,order.currency,status,mode]);
}
async function effective(db,user=ids.member) { await actor(db,user); return value(db,"get_effective_membership_entitlements(auth.uid())"); }
async function mine(db,user=ids.member) { await actor(db,user); return value(db,"get_my_membership_commerce(auth.uid())"); }
let typesPromise;
async function commerceTypes() {
  if(!typesPromise) {
    const existing=stripTypeScriptTypes(await readFile(new URL("../apps/web/src/lib/membership/types.ts",import.meta.url),"utf8"));
    const existingUrl=`data:text/javascript;base64,${Buffer.from(existing).toString('base64')}`;
    const source=stripTypeScriptTypes((await readFile(new URL("../apps/web/src/lib/membership/commerce-types.ts",import.meta.url),"utf8")).replace('"./types"',JSON.stringify(existingUrl)));
    typesPromise=import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  }
  return typesPromise;
}

test("confirmed public USD52/520 product stays billing-disabled and does not grant rights",()=>fixture(async(db)=>{
  const state=await store(db); assert.equal(state.settings.billing_enabled,false); assert.equal(state.settings.payment_mode,"test");
  assert.deepEqual(state.plans[0].prices.map(p=>[p.term_months,p.amount_minor,p.currency,p.published]),[[1,5200,"USD",true],[12,52000,"USD",true]]);
  assert.equal(state.plans[0].ai_daily_limit,50); assert.equal(state.plans[0].mentor_discount_bps,1000);
  assert.doesNotMatch(state.plans[0].description,/52|520/); assert.doesNotMatch(JSON.stringify(state.plans[0].benefits),/50|9 折/);
  await actor(db,null,"anon"); const catalog=await value(db,"list_membership_catalog()"); assert.equal(catalog.plans.length,1); assert.equal(catalog.purchase_available,false);
  const p=state.plans[0].prices[0]; await assert.rejects(prepare(db,{price:p,quote:{}}),/membership_billing_unavailable/);
  assert.equal((await effective(db)).has_vip,false);
}));
test("commerce seed never replaces an operator's existing VIP configuration",()=>fixture(async(db)=>{
  const state=await store(db); assert.equal(state.plans[0].title,'已配置的方案'); assert.equal(state.plans[0].description,'保留操作员配置');
  assert.equal(state.plans[0].revision,2); assert.equal(state.plans[0].enabled,false); assert.deepEqual(state.plans[0].benefits,{custom_notes:'自定义权益'});
  assert.equal(state.plans[0].ai_daily_limit,0); assert.ok(state.plans[0].prices.every(p=>!p.published));
},{customPlan:true}));
test("ACLs prevent ordinary/admin/service direct writes, payment fabrication, cross-owner query and banned admin config",()=>fixture(async(db)=>{
  const c=await setup(db); await actor(db,ids.member);
  await assert.rejects(value(db,"admin_membership_commerce_store(auth.uid())"),/admin_required/);
  await assert.rejects(value(db,"get_my_membership_commerce($1)",[ids.other]),/account_ineligible/);
  await assert.rejects(value(db,"get_effective_membership_entitlements($1)",[ids.other]),/authentication_required/);
  await assert.rejects(value(db,"get_effective_membership_entitlements_for_user($1)",[ids.other]),/permission denied/);
  await assert.rejects(value(db,"get_membership_payment_route($1)",[randomUUID()]),/permission denied/);
  await assert.rejects(value(db,"prepare_membership_order($1,$2,$3,'{}')",[ids.member,c.price.id,randomUUID()]),/permission denied/);
  for (const role of ["authenticated","anon","service_role"]) { await actor(db,ids.admin,role); for(const table of ["membership_prices","membership_orders","membership_purchase_grants","membership_payment_events","membership_refunds","membership_commerce_settings"]) await assert.rejects(db.query(`select * from ${table}`),/permission denied/); }
  await db.exec("reset role"); await db.query("update profiles set account_status='banned' where id=$1",[ids.admin]); await actor(db,ids.admin);
  await assert.rejects(value(db,"admin_save_membership_commerce_settings(true,'live',2,'测试越权配置',$1,auth.uid())",[randomUUID()]),/admin_required/);
}));
test("CAS/audit/idempotency cover structured entitlements and settings; canonical Unicode reasons round-trip",()=>fixture(async(db)=>{
  const state=await store(db),request=randomUUID();
  const params=[state.plans[0].revision,"\u00a0😀😀😀\t",request];
  const sql="admin_save_membership_entitlements('vip',70,1500,$1,$2,$3,auth.uid())";
  const receipt=await value(db,sql,params); assert.equal(receipt.ai_daily_limit,70); assert.equal(receipt.revision,state.plans[0].revision+1);
  const catalog=await value(db,'list_membership_catalog()');assert.equal(catalog.plans[0].ai_daily_limit,70);assert.doesNotMatch(JSON.stringify(catalog.plans[0].benefits),/每日 50|9 折/);
  assert.deepEqual(await value(db,sql,params),receipt);
  await assert.rejects(value(db,sql,[state.plans[0].revision,"不同理由",request]),/request_conflict/);
  await assert.rejects(value(db,sql,[state.plans[0].revision,"测试过期版本",randomUUID()]),/membership_changed_concurrently/);
  for(const limit of [-1,10001,null]) await assert.rejects(value(db,"admin_save_membership_entitlements('vip',$1,1000,$2,'测试非法配置',$3,auth.uid())",[limit,receipt.revision,randomUUID()]),/membership_input_invalid/);
  await assert.rejects(value(db,"admin_save_membership_entitlements('vip',70,10000,$1,'测试禁止全免',$2,auth.uid())",[receipt.revision,randomUUID()]),/membership_input_invalid/);
  assert.equal((await store(db)).history[0].reason,"😀😀😀");
}));
test("quotes are server snapshots, idempotent recovery survives config changes, one pending plan excludes new requests",()=>fixture(async(db)=>{
  const c=await setup(db),request=randomUUID(); const orders=await Promise.all(Array.from({length:6},()=>prepare(db,c,{request})));
  assert.ok(orders.every(o=>o.id===orders[0].id)); const order=orders[0];
  await assert.rejects(prepare(db,c),/membership_pending_order_exists/);
  await assert.rejects(prepare(db,c,{request,quote:{...c.quote,amount_minor:1}}),/request_conflict/);
  await assert.rejects(prepare(db,c,{user:ids.other,quote:{...c.quote,plan_revision:1}}),/membership_quote_changed/);
  await actor(db,ids.admin); await value(db,"admin_save_membership_entitlements('vip',75,2000,$1,'测试更新配置',$2,auth.uid())",[c.plan.revision,randomUUID()]);
  const recovered=await prepare(db,c,{request}); assert.deepEqual(recovered,order); assert.equal(recovered.ai_daily_limit_snapshot,50);
  await actor(db,ids.admin); await value(db,"admin_save_membership_price($1,'vip',1,6000,'USD',false,$2,'测试停止新价格发布',$3,auth.uid())",[c.price.id,c.price.revision,randomUUID()]);
  assert.deepEqual(await prepare(db,c,{request}),order);
  await db.exec("reset role"); assert.equal((await db.query("select count(*)::int as n from membership_orders")).rows[0].n,1);
}));
test("prepare rejects unpublished/disabled/billing off, unverified and banned buyer even for retries",()=>fixture(async(db)=>{
  const c=await setup(db,{published:false}); await assert.rejects(prepare(db,c),/membership_price_unavailable/);
  await actor(db,ids.admin); await value(db,"admin_save_membership_price($1,'vip',1,5200,'USD',true,2,'测试发布价格',$2,auth.uid())",[c.price.id,randomUUID()]);
  const state=await store(db),p=state.plans[0]; c.quote.price_revision=3;
  await value(db,"admin_save_membership_plan('vip','VIP 会员','测试','{}',false,$1,'测试停用方案',$2,auth.uid())",[p.revision,randomUUID()]);
  await assert.rejects(prepare(db,c),/membership_plan_disabled/);
  await db.exec("reset role"); await db.query("update profiles set account_status='banned' where id=$1",[ids.member]); await assert.rejects(prepare(db,c),/account_ineligible/);
  await db.exec("reset role"); await db.query("update profiles set account_status='active' where id=$1",[ids.member]); await db.query("update auth.users set email_confirmed_at=null where id=$1",[ids.member]); await assert.rejects(prepare(db,c),/account_ineligible/);
}));
test("session binding recovers same acknowledgement but rejects mode, identity, unsafe URL and replacement",()=>fixture(async(db)=>{
  const c=await setup(db),order=await prepare(db,c),expires=new Date(Date.now()+864e5).toISOString();
  await assert.rejects(bind(db,order,{mode:false}),/payment_mode_mismatch/);
  await assert.rejects(bind(db,order,{url:"https://checkout.stripe.com.evil.test/pay/x"}),/payment_session_invalid/);
  const bound=await bind(db,order,{expires}); assert.deepEqual(await bind(db,order,{expires}),bound);
  await assert.rejects(bind(db,bound,{session:"cs_other",expires}),/order_payment_route_invalid/);
  await assert.rejects(bind(db,{...bound,buyer_id:ids.other},{expires}),/order_access_denied/);
}));
test("unpaid completion never grants; duplicate and distinct paid events apply once with immutable snapshots",()=>fixture(async(db)=>{
  const c=await setup(db),order=await bind(db,await prepare(db,c));
  assert.equal((await pay(db,order,{status:"unpaid",intent:null,paidAt:null})).applied,false); assert.equal((await effective(db)).has_vip,false);
  for(const args of [{amount:1},{currency:"CNY"},{buyer:ids.other},{mode:false}]) await assert.rejects(pay(db,order,args),/payment_amount_mismatch|order_payment_route_invalid|payment_mode_mismatch/);
  const event="evt_once"; const results=await Promise.all(Array.from({length:6},()=>pay(db,order,{event})));
  assert.equal(results.filter(x=>x.applied).length,1); assert.equal(results.filter(x=>x.duplicate).length,5);
  assert.equal((await pay(db,order,{event:"evt_distinct",type:"checkout.session.async_payment_succeeded"})).applied,false);
  const e=await effective(db); assert.equal(e.has_vip,true); assert.equal(e.ai_daily_limit,50); assert.equal(e.mentor_discount_bps,1000);
  const m=await mine(db); assert.equal(m.purchase_grants.length,1); assert.equal(m.orders[0].status,"paid");
  await db.exec("reset role"); await assert.rejects(db.query("update membership_orders set amount_minor=1 where id=$1",[order.id]),/membership_order_immutable/);
  await assert.rejects(db.query("update membership_purchase_grants set ends_at=ends_at+interval '1 day'"),/membership_purchase_grant_immutable/);
}));
test("full refunds revoke only their purchase; repeated and late payment cannot restore it or revoke manual rights",()=>fixture(async(db)=>{
  const c=await setup(db); await value(db,"admin_change_membership($1,'vip','grant',now()+interval '1 year',0,'测试手工授权',$2,auth.uid())",[ids.member,randomUUID()]);
  const order=await bind(db,await prepare(db,c)); await pay(db,order);
  const result=await refund(db,order,{event:"evt_refund",id:"re_once"}); assert.equal(result.order_status,"refunded");
  assert.equal((await refund(db,order,{event:"evt_refund",id:"re_once"})).duplicate,true);
  assert.equal((await pay(db,order,{event:"evt_late"})).applied,false);
  assert.equal((await effective(db)).has_vip,true); assert.equal((await mine(db)).purchase_grants[0].status,"revoked");
  await db.exec("reset role"); assert.equal((await db.query("select status from membership_grants")).rows[0].status,"active");
  await assert.rejects(db.query("update membership_orders set status='paid' where id=$1",[order.id]),/membership_order_terminal/);
}));
test("out-of-order full refund before payment is terminal and creates no grant",()=>fixture(async(db)=>{
  const c=await setup(db),order=await bind(db,await prepare(db,c));
  assert.equal((await refund(db,order)).order_status,"refunded"); assert.equal((await pay(db,order)).applied,false);
  assert.equal((await mine(db)).purchase_grants.length,0); assert.equal((await effective(db)).has_vip,false);
}));
test("partial/pending/failed refunds do not revoke and successful refund totals are counted once",()=>fixture(async(db)=>{
  const c=await setup(db),order=await bind(db,await prepare(db,c)); await pay(db,order);
  await refund(db,order,{id:"re_pending",status:"pending",amount:2600}); assert.equal((await effective(db)).has_vip,true);
  await refund(db,order,{id:"re_pending",status:"failed",amount:2600});
  await refund(db,order,{id:"re_part",amount:2600}); assert.equal((await effective(db)).has_vip,true);
  await refund(db,order,{id:"re_part",amount:2600}); assert.equal((await effective(db)).has_vip,true);
  await refund(db,order,{id:"re_rest",amount:2600}); assert.equal((await effective(db)).has_vip,false);
  assert.equal((await mine(db)).orders[0].status,"refunded");
}));
test("paid snapshots survive config edits; disable, ban, revoke, expiry and test mode fail closed",()=>fixture(async(db)=>{
  const c=await setup(db),order=await bind(db,await prepare(db,c)); await pay(db,order);
  await actor(db,ids.admin); const changed=await value(db,"admin_save_membership_entitlements('vip',10,0,$1,'测试修改权益',$2,auth.uid())",[c.plan.revision,randomUUID()]);
  assert.equal((await effective(db)).ai_daily_limit,50); assert.equal((await effective(db)).mentor_discount_bps,1000);
  await actor(db,ids.admin); await value(db,"admin_save_membership_plan('vip','VIP 会员','测试','{}',false,$1,'测试停用方案',$2,auth.uid())",[changed.revision,randomUUID()]);
  assert.equal((await effective(db)).has_vip,false); assert.equal((await mine(db)).purchase_grants[0].status,"disabled");
  await db.exec("reset role"); await db.query("update profiles set account_status='banned' where id=$1",[ids.member]); const e=await effective(db); assert.equal(e.eligible,false); assert.equal(e.ai_daily_limit,0);
}));
test("test payments are visible test ledger, not executable VIP; expired sessions stay terminal",()=>fixture(async(db)=>{
  const c=await setup(db,{mode:"test"}),order=await bind(db,await prepare(db,c)); await pay(db,order);
  assert.equal((await effective(db)).has_vip,false); assert.equal((await mine(db)).purchase_grants[0].status,"test");
  const another=await bind(db,await prepare(db,c,{user:ids.other})); await pay(db,another,{type:"checkout.session.expired",status:"unpaid",intent:null,paidAt:null});
  assert.equal((await pay(db,another)).applied,false); assert.equal((await mine(db,ids.other)).orders[0].status,"expired");
}));
test("verified async failure closes pending, seals intent, never grants/revives and allows a new request plus finance reconciliation",()=>fixture(async(db)=>{
  const c=await setup(db),order=await bind(db,await prepare(db,c)),failure={event:'evt_async_failure',type:'checkout.session.async_payment_failed',status:'unpaid',intent:'pi_async_failure',paidAt:null};
  await assert.rejects(pay(db,order,{...failure,intent:null}),/payment_event_invalid/);
  await assert.rejects(pay(db,order,{...failure,status:'paid'}),/payment_event_invalid/);
  const failed=await pay(db,order,failure); assert.equal(failed.order_status,'failed'); assert.equal(failed.applied,true); assert.equal(failed.grant_id,null);
  assert.equal((await pay(db,order,failure)).duplicate,true); assert.equal((await mine(db)).orders[0].status,'failed'); assert.equal((await effective(db)).has_vip,false);
  assert.equal((await pay(db,order,{intent:'pi_async_failure'})).applied,false);
  await assert.rejects(pay(db,order,{intent:'pi_other_route'}),/order_payment_route_invalid/);
  const another=await prepare(db,c); assert.notEqual(another.id,order.id);
  assert.equal((await refund(db,order,{intent:'pi_async_failure'})).order_status,'refunded');
  assert.equal((await mine(db)).purchase_grants.length,0);
}));
test("one-time renewal periods are separate and a refund neither shifts nor revokes another period",()=>fixture(async(db)=>{
  const c=await setup(db),first=await bind(db,await prepare(db,c)); await pay(db,first);
  const second=await bind(db,await prepare(db,c)); await pay(db,second,{paidAt:"2026-10-10T00:01:00.000Z"});
  const before=await mine(db); const g1=before.purchase_grants.find(g=>g.order_id===first.id),g2=before.purchase_grants.find(g=>g.order_id===second.id);
  assert.equal(g1.ends_at,g2.starts_at); assert.equal(g2.status,"scheduled");
  await refund(db,first); const after=await mine(db); assert.equal(after.purchase_grants.find(g=>g.id===g2.id).starts_at,g2.starts_at);
  assert.equal(after.purchase_grants.find(g=>g.id===g2.id).status,"scheduled"); assert.equal((await effective(db)).has_vip,false);
}));
test("real SQL catalog/admin/pending/paid/refund receipts pass the production parser including Unicode limits",()=>fixture(async(db)=>{
  const parsers=await commerceTypes(); let state=await store(db); parsers.parseMembershipCommerceAdminStore(state);
  await actor(db,null,'anon'); parsers.parseMembershipCatalog(await value(db,'list_membership_catalog()'));
  await actor(db,ids.admin);
  await value(db,"admin_save_membership_plan('vip',$1,$2,$3::jsonb,true,$4,'测试Unicode方案',$5,auth.uid())",['\u00a0'+'😀'.repeat(60)+'\t','中'.repeat(1000),JSON.stringify({ai_daily_analysis:'\t'+'😀'.repeat(240)+'\u00a0'}),state.plans[0].revision,randomUUID()]);
  state=await store(db); const price=state.plans[0].prices.find(p=>p.term_months===1);
  await value(db,"admin_save_membership_commerce_settings(true,'live',1,'测试开启隔离付款',$1,auth.uid())",[randomUUID()]);
  const config={price,quote:parsers.membershipQuote(state.plans[0],price)};
  const order=await prepare(db,config); parsers.parseMembershipOrder(order); const bound=await bind(db,order); parsers.parseMembershipOrder(bound);
  parsers.parseMyMembershipCommerce(await mine(db)); await pay(db,bound); parsers.parseMyMembershipCommerce(await mine(db));
  await refund(db,bound); parsers.parseMyMembershipCommerce(await mine(db));
}));
test("expired paid periods and revoked manual sources return zero; remaining active sources aggregate maximum not sum",()=>fixture(async(db)=>{
  const c=await setup(db),expired=await bind(db,await prepare(db,c)); await pay(db,expired,{paidAt:'2020-01-01T00:00:00Z'});
  assert.equal((await mine(db)).purchase_grants[0].status,'expired'); assert.equal((await effective(db)).has_vip,false);
  const live=await bind(db,await prepare(db,c)); await pay(db,live); await actor(db,ids.admin);
  await value(db,"admin_save_membership_entitlements('vip',80,500,$1,'测试改变手工权益',$2,auth.uid())",[c.plan.revision,randomUUID()]);
  await value(db,"admin_change_membership($1,'vip','grant',now()+interval '1 year',0,'测试手工叠加',$2,auth.uid())",[ids.member,randomUUID()]);
  let e=await effective(db); assert.equal(e.ai_daily_limit,80); assert.equal(e.mentor_discount_bps,1000);
  await actor(db,ids.admin); await value(db,"admin_change_membership($1,'vip','revoke',null,1,'测试撤销手工授权',$2,auth.uid())",[ids.member,randomUUID()]);
  e=await effective(db); assert.equal(e.ai_daily_limit,50); assert.equal(e.mentor_discount_bps,1000);
  await refund(db,live); e=await effective(db); assert.equal(e.ai_daily_limit,0); assert.equal(e.has_vip,false);
}));
test("billing/mode kill-switch blocks pending recovery without deleting its order; late finance still reconciles",()=>fixture(async(db)=>{
  const c=await setup(db),request=randomUUID(),order=await bind(db,await prepare(db,c,{request}));
  await actor(db,ids.admin); await value(db,"admin_save_membership_commerce_settings(false,'live',2,'测试关闭付款',$1,auth.uid())",[randomUUID()]);
  await assert.rejects(prepare(db,c,{request}),/membership_billing_unavailable/);
  assert.equal((await mine(db)).orders[0].id,order.id); assert.equal((await pay(db,order)).order_status,'paid');
  await refund(db,order); assert.equal((await mine(db)).orders[0].status,'refunded');
  await actor(db,ids.admin); await value(db,"admin_save_membership_commerce_settings(true,'test',3,'测试调整模式',$1,auth.uid())",[randomUUID()]);
  const testOrder=await prepare(db,c); await actor(db,ids.admin);
  await assert.rejects(value(db,"admin_save_membership_commerce_settings(true,'live',4,'测试切换模式',$1,auth.uid())",[randomUUID()]),/membership_payment_mode_locked/);
  // Even an out-of-band owner configuration change cannot reprice/re-mode recovery.
  await db.exec("reset role; update membership_commerce_settings set payment_mode='live'");
  await assert.rejects(prepare(db,c,{request:testOrder.request_id}),/payment_mode_mismatch/);
}));
test("mode changes preserve all pending routes and live refund windows; billing can always be closed",()=>fixture(async(db)=>{
  const c=await setup(db),order=await bind(db,await prepare(db,c)); await actor(db,ids.admin);
  await assert.rejects(value(db,"admin_save_membership_commerce_settings(false,'test',2,'测试跨环境关闭',$1,auth.uid())",[randomUUID()]),/membership_payment_mode_locked/);
  await value(db,"admin_save_membership_commerce_settings(false,'live',2,'测试关闭新购买',$1,auth.uid())",[randomUUID()]);
  await pay(db,order); await actor(db,ids.admin);
  await assert.rejects(value(db,"admin_save_membership_commerce_settings(false,'test',3,'测试存量退款窗口',$1,auth.uid())",[randomUUID()]),/membership_payment_mode_locked/);
  await refund(db,order); await actor(db,ids.admin);
  assert.equal((await value(db,"admin_save_membership_commerce_settings(false,'test',3,'测试结清后切换',$1,auth.uid())",[randomUUID()])).payment_mode,'test');
}));

// Network is completely synthetic. The production Edge handlers are executed
// unchanged in a VM, while every Supabase RPC uses the actual service-only SQL.
async function edgeDatabaseFixture(db,config) {
  const secret='whsec_synthetic_database_contract',sessions=new Map(),eventBodies=new Map(),calls=[];
  const environment={SITE_ORIGIN:'https://membership-contract.invalid',SUPABASE_URL:'https://sql-contract.invalid',SUPABASE_ANON_KEY:'synthetic-public',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',
    MEMBERSHIP_BILLING_ENABLED:'true',MEMBERSHIP_PAYMENT_MODE:'live',MEMBERSHIP_STRIPE_SECRET_KEY:'sk_live_synthetic_contract',MEMBERSHIP_STRIPE_WEBHOOK_SECRET:secret};
  let session,refundRecord,intentStatus='succeeded',registrationFailure=false;
  const response=(data,status=200)=>new Response(JSON.stringify(data),{status});
  const rpcNames=new Set(['prepare_membership_order','register_membership_checkout_session','apply_verified_membership_payment_event','apply_verified_membership_refund_event','get_membership_payment_route']);
  async function fetcher(url,options={}) {
    calls.push({url,options});
    if(url.endsWith('/auth/v1/user')) return response({id:ids.member,email_confirmed_at:'2026-10-10T00:00:00Z'});
    if(url.includes('/rest/v1/rpc/')) {
      const name=url.split('/').at(-1),params=JSON.parse(options.body); assert.ok(rpcNames.has(name));
      if(name==='register_membership_checkout_session'&&registrationFailure) return response({message:'synthetic_registration_not_committed'},503);
      const keys=Object.keys(params); assert.ok(keys.every(k=>/^p_[a-z_]+$/.test(k)));
      await actor(db,null,'service_role');
      try {
        const result=await value(db,`${name}(${keys.map((k,i)=>`${k}=>$${i+1}${k==='p_expected_quote'?'::jsonb':''}`).join(',')})`,keys.map(k=>k==='p_expected_quote'?JSON.stringify(params[k]):params[k]));
        return response(result);
      } catch(error) { return response({message:error.message},400); }
    }
    if(url==='https://api.stripe.com/v1/checkout/sessions') {
      const p=options.body,key=options.headers['idempotency-key'];
      if(!sessions.has(key)) sessions.set(key,{id:'cs_contract_'+randomUUID().replaceAll('-',''),mode:p.get('mode'),livemode:true,status:'open',payment_status:'unpaid',
        client_reference_id:p.get('client_reference_id'),metadata:{domain:p.get('metadata[domain]'),order_id:p.get('metadata[order_id]'),buyer_id:p.get('metadata[buyer_id]')},
        amount_total:Number(p.get('line_items[0][price_data][unit_amount]')),currency:p.get('line_items[0][price_data][currency]'),expires_at:Number(p.get('expires_at')),url:'https://checkout.stripe.com/c/pay/synthetic-contract'});
      session=sessions.get(key); return response(session);
    }
    if(url.includes('/checkout/sessions/')) return response(session);
    if(url.includes('/refunds/')) return response(refundRecord);
    if(url.includes('/payment_intents/')) return response({id:session.payment_intent,status:intentStatus,livemode:true,amount:session.amount_total,currency:session.currency,metadata:session.metadata});
    throw new Error('No real network is permitted by this fixture');
  }
  async function loadHandler(name) {
    let handler;
    vm.runInNewContext(stripTypeScriptTypes(await readFile(new URL(`../supabase/functions/${name}/index.ts`,import.meta.url),'utf8')),
      {Deno:{env:{get:key=>environment[key]},serve:fn=>{handler=fn;}},Response,URL,URLSearchParams,Date,TextEncoder,Uint8Array,AbortSignal,crypto:webcrypto,fetch:fetcher});
    return handler;
  }
  const checkout=await loadHandler('membership-checkout'),webhook=await loadHandler('membership-payment-webhook'),request=randomUUID();
  const checkoutRequest=()=>new Request('https://membership-contract.invalid',{method:'POST',headers:{authorization:'Bearer synthetic-owner'},body:JSON.stringify({actorId:ids.member,priceId:config.price.id,requestId:request,expectedQuote:config.quote})});
  function webhookRequest(object,type,eventId) {
    const timestamp=Math.floor(Date.now()/1000);
    if(!eventBodies.has(eventId)) eventBodies.set(eventId,JSON.stringify({id:eventId,type,created:timestamp,livemode:true,data:{object}}));
    const body=eventBodies.get(eventId);
    const signature=createHmac('sha256',secret).update(`${timestamp}.${body}`).digest('hex');
    return new Request('https://membership-contract.invalid',{method:'POST',body,headers:{'stripe-signature':`t=${timestamp},v1=${signature}`}});
  }
  return {checkout,webhook,checkoutRequest,webhookRequest,calls,session:()=>session,
    setIntentStatus:status=>{intentStatus=status;},
    failRegistration:()=>{registrationFailure=true;},
    setRefund:()=>{refundRecord={id:'re_contract',payment_intent:session.payment_intent,amount:session.amount_total,currency:session.currency,status:'succeeded'}; return refundRecord;}};
}
test("production checkout/webhook execute exact service-role SQL contracts through paid/refund/replay, even with billing off",()=>fixture(async(db)=>{
  const c=await setup(db),edge=await edgeDatabaseFixture(db,c);
  const first=await edge.checkout(edge.checkoutRequest()); assert.equal(first.status,200); const receipt=await first.json();
  const stored=await mine(db); assert.equal(stored.orders[0].id,receipt.orderId); assert.equal(stored.orders[0].provider_session_id,edge.session().id);
  assert.deepEqual(await (await edge.checkout(edge.checkoutRequest())).json(),receipt);
  assert.equal(edge.calls.filter(c=>c.url==='https://api.stripe.com/v1/checkout/sessions').length,1);
  await actor(db,ids.admin); await value(db,"admin_save_membership_commerce_settings(false,'live',2,'测试关闭线上付款',$1,auth.uid())",[randomUUID()]);
  const blocked=await edge.checkout(edge.checkoutRequest()); assert.equal(blocked.status,409); assert.deepEqual(await blocked.json(),{error:'membership_billing_unavailable'});
  const session=edge.session(); session.status='complete'; session.payment_status='paid'; session.payment_intent='pi_contract';
  const paidObject={...session},paidRequest=()=>edge.webhookRequest(paidObject,'checkout.session.completed','evt_contract_paid');
  assert.deepEqual(await (await edge.webhook(paidRequest())).json(),{received:true,duplicate:false,applied:true});
  assert.equal((await effective(db)).ai_daily_limit,50);
  assert.deepEqual(await (await edge.webhook(paidRequest())).json(),{received:true,duplicate:true,applied:false});
  const refund=edge.setRefund(); assert.deepEqual(await (await edge.webhook(edge.webhookRequest(refund,'refund.updated','evt_contract_refund'))).json(),{received:true,duplicate:false,applied:true});
  assert.equal((await effective(db)).has_vip,false);
  assert.deepEqual(await (await edge.webhook(paidRequest())).json(),{received:true,duplicate:true,applied:false});
  assert.equal((await mine(db)).orders[0].status,'refunded'); assert.equal((await mine(db)).purchase_grants[0].status,'revoked');
  assert.ok(edge.calls.every(c=>c.options.method!=='PATCH'&&!c.url.includes('mentor_')));
}));
test("production verified async-failure handler uses exact SQL terminal contract and unblocks a fresh one-time order",()=>fixture(async(db)=>{
  const c=await setup(db),edge=await edgeDatabaseFixture(db,c); assert.equal((await edge.checkout(edge.checkoutRequest())).status,200);
  const session=edge.session(); session.status='complete'; session.payment_status='unpaid'; session.payment_intent='pi_contract_failed'; edge.setIntentStatus('requires_payment_method');
  const failedObject={...session},request=()=>edge.webhookRequest(failedObject,'checkout.session.async_payment_failed','evt_contract_failed');
  assert.deepEqual(await (await edge.webhook(request())).json(),{received:true,duplicate:false,applied:true});
  assert.equal((await mine(db)).orders[0].status,'failed'); assert.equal((await effective(db)).has_vip,false);
  assert.deepEqual(await (await edge.webhook(request())).json(),{received:true,duplicate:true,applied:false});
  assert.equal((await edge.checkout(edge.checkoutRequest())).status,409);
  const next=await prepare(db,c); assert.equal(next.status,'pending');
  session.payment_status='paid'; edge.setIntentStatus('succeeded');
  const late=await edge.webhook(edge.webhookRequest({...session},'checkout.session.async_payment_succeeded','evt_failed_late_success'));
  assert.deepEqual(await late.json(),{received:true,duplicate:false,applied:false});
  const m=await mine(db); assert.equal(m.orders.find(o=>o.id===session.client_reference_id).status,'failed'); assert.equal(m.purchase_grants.length,0);
}));
test("verified callbacks recover unregistered sessions without reconstructing URLs or creating a new charge",()=>fixture(async(db)=>{
  const c=await setup(db),edge=await edgeDatabaseFixture(db,c); edge.failRegistration();
  assert.equal((await edge.checkout(edge.checkoutRequest())).status,503);
  assert.equal((await mine(db)).orders[0].provider_session_id,null);
  await actor(db,ids.admin); await value(db,"admin_save_membership_plan('vip','VIP 会员','停用计划','{}',false,$1,'测试停用方案',$2,auth.uid())",[c.plan.revision,randomUUID()]);
  const blocked=await edge.checkout(edge.checkoutRequest());assert.equal(blocked.status,409);assert.deepEqual(await blocked.json(),{error:'membership_plan_disabled'});
  assert.equal(edge.calls.filter(c=>c.url==='https://api.stripe.com/v1/checkout/sessions').length,1);
  const session=edge.session(); session.status='complete'; session.payment_status='paid'; session.payment_intent='pi_unregistered_paid';
  const mismatch={...session,amount_total:1};
  // Both signed and canonical provider records agree on 1, but not the frozen SQL quote.
  const savedAmount=session.amount_total;session.amount_total=1;
  const rejected=await edge.webhook(edge.webhookRequest(mismatch,'checkout.session.completed','evt_unregistered_bad_quote'));
  assert.equal(rejected.status,409); assert.equal((await mine(db)).orders[0].provider_session_id,null);
  session.amount_total=savedAmount;
  assert.deepEqual(await (await edge.webhook(edge.webhookRequest({...session},'checkout.session.completed','evt_unregistered_paid'))).json(),{received:true,duplicate:false,applied:true});
  const m=await mine(db);assert.equal(m.orders[0].provider_session_id,session.id);assert.equal(m.orders[0].checkout_url,null);assert.equal(m.orders[0].checkout_expires_at,null);assert.equal(m.orders[0].status,'paid');
  (await commerceTypes()).parseMyMembershipCommerce(m);
  assert.equal((await effective(db)).has_vip,false);assert.equal(m.purchase_grants[0].status,'disabled');const r=edge.setRefund();
  assert.equal((await edge.webhook(edge.webhookRequest(r,'refund.updated','evt_unregistered_refunded'))).status,200);
  assert.equal((await effective(db)).has_vip,false);
  assert.equal(edge.calls.filter(c=>c.url==='https://api.stripe.com/v1/checkout/sessions').length,1);
}));
test("unregistered route recovery rejects invalid buyer/mode/quote, unpaid completion and conflicting event before any binding",()=>fixture(async(db)=>{
  const c=await setup(db),first=await bind(db,await prepare(db,c));await pay(db,first,{event:'evt_existing_route'});
  const pending=await prepare(db,c),proof={...pending,provider_session_id:'cs_recover_proof'};
  for(const patch of [{buyer:ids.other},{mode:false},{amount:1},{currency:'CNY'},{status:'unpaid',intent:null,paidAt:null},{event:'evt_existing_route'}]) {
    await assert.rejects(pay(db,proof,patch),/order_payment_route_invalid|payment_mode_mismatch|payment_amount_mismatch|payment_event_conflict/);
    assert.equal((await mine(db)).orders.find(o=>o.id===pending.id).provider_session_id,null);
  }
  assert.equal((await pay(db,proof)).order_status,'paid');
  const recovered=(await mine(db)).orders.find(o=>o.id===pending.id);assert.equal(recovered.provider_session_id,proof.provider_session_id);assert.equal(recovered.checkout_url,null);
}));
test("verified expired and failed callbacks safely seal unregistered routes and unblock the pending slot",()=>fixture(async(db)=>{
  const c=await setup(db),expired=await edgeDatabaseFixture(db,c); expired.failRegistration();await expired.checkout(expired.checkoutRequest());
  const s=expired.session();s.status='expired';s.payment_status='unpaid';s.payment_intent=null;
  assert.deepEqual(await (await expired.webhook(expired.webhookRequest({...s},'checkout.session.expired','evt_missing_expired'))).json(),{received:true,duplicate:false,applied:true});
  let m=await mine(db);assert.equal(m.orders[0].status,'expired');assert.equal(m.orders[0].provider_session_id,s.id);(await commerceTypes()).parseMyMembershipCommerce(m);
  const failed=await edgeDatabaseFixture(db,c);failed.failRegistration();await failed.checkout(failed.checkoutRequest());
  const f=failed.session();f.status='complete';f.payment_status='unpaid';f.payment_intent='pi_unregistered_failed';failed.setIntentStatus('canceled');
  assert.deepEqual(await (await failed.webhook(failed.webhookRequest({...f},'checkout.session.async_payment_failed','evt_missing_failed'))).json(),{received:true,duplicate:false,applied:true});
  m=await mine(db);assert.equal(m.orders.find(o=>o.id===f.client_reference_id).status,'failed');assert.equal(m.purchase_grants.length,0);(await commerceTypes()).parseMyMembershipCommerce(m);
  assert.equal((await prepare(db,c)).status,'pending');
}));
