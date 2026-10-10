import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createCheckoutDatabase, checkoutMigration, checkoutIds as ids, checkoutQuote, submitCheckout } from './helpers/mentor-checkout-database.mjs';

const analysis='99999999-9999-4999-8999-999999999999';
const connection='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const model='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const provider='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const value=async(db,sql,args=[]) => (await db.query(`select ${sql} as value`,args)).rows[0].value;
async function actor(db,id,role='authenticated') {
  await db.exec(`reset role; set role ${role};`);
  await db.query("select set_config('test.actor',$1,false)",[id||'']);
}
async function fixture(run) {
  const db=await createCheckoutDatabase();
  try {
    await db.exec(`grant usage on schema auth to authenticated,anon,service_role;
      create function public.is_admin() returns boolean language sql stable security definer as $$
        select exists(select 1 from profiles where id=auth.uid() and role='admin' and account_status='active') $$;
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
      grant select,insert,update on ai_jobs to authenticated;
      insert into workbench_analyses values('${analysis}','${ids.buyer}','workbench-v1');
      insert into user_ai_connections values('${connection}','${ids.buyer}',true);
      insert into ai_providers values('${provider}',true); insert into ai_models values('${model}','${provider}',true);
      insert into ai_task_routes values('wave_analysis','${model}',true); insert into ai_provider_secrets(provider_id) values('${provider}');`);
    await db.exec(await checkoutMigration('202610100002_membership_foundation.sql'));
    await db.exec(await checkoutMigration('202610100003_membership_commerce.sql'));
    // A real pre-004 order must remain historical, with no invented discount.
    const historical=await value(db,'create_mentor_order($1)',[ids.offer]);
    await db.query("update mentor_orders set status='cancelled' where id=$1",[historical]);
    await db.exec(await checkoutMigration('202610100004_membership_benefits.sql'));
    await run(db,historical);
  } finally { await db.close(); }
}
async function vip(db,{limit=50,bps=1000,status='active'}={}) {
  await db.exec('reset role');
  await db.query("update membership_plans set enabled=true,ai_daily_limit=$1,mentor_discount_bps=$2 where key='vip'",[limit,bps]);
  await db.query("insert into membership_grants(user_id,plan_key,status,ends_at) values($1,'vip',$2,now()+interval '1 year') on conflict(user_id,plan_key) do update set status=excluded.status,ends_at=excluded.ends_at",[ids.buyer,status]);
}
async function enqueue(db,{key=randomUUID(),source='managed',owner=ids.buyer,input={step:5},conn=source==='byok'?connection:null}={}) {
  await actor(db,null,'service_role');
  return value(db,"to_jsonb(enqueue_membership_ai_job($1,$2,$3,'wave_analysis',$4::jsonb,'test-only',$5,$6,$7,'{}'))",[owner,analysis,key,JSON.stringify(input),source,conn,source==='managed'?model:null]);
}
async function usage(db) { await actor(db,ids.buyer); return value(db,'get_my_membership_ai_usage(auth.uid())'); }
async function paidVip(db,mode='live') {
  await db.exec('reset role'); await db.query('update membership_commerce_settings set billing_enabled=true,payment_mode=$1',[mode]);
  const price=(await db.query("select x.*,p.revision as plan_revision from membership_prices x join membership_plans p on p.key=x.plan_key where term_months=1")).rows[0];
  const quote={price_id:price.id,plan_key:'vip',price_revision:price.revision,plan_revision:price.plan_revision,amount_minor:price.amount_minor,currency:price.currency,term_months:1};
  await actor(db,null,'service_role');
  let order=await value(db,'prepare_membership_order($1,$2,$3,$4::jsonb)',[ids.buyer,price.id,randomUUID(),JSON.stringify(quote)]);
  order=await value(db,'register_membership_checkout_session($1,$2,$3,$4,now()+interval \'1 day\',$5)',[ids.buyer,order.id,'cs_benefits','https://checkout.stripe.com/c/pay/benefits',mode==='live']);
  await value(db,"apply_verified_membership_payment_event($1,'checkout.session.completed',$2,$3,'cs_benefits','pi_benefits',$4,'USD','paid',$5,now())",[`evt_${randomUUID().replaceAll('-','')}`,order.id,ids.buyer,price.amount_minor,mode==='live']);
  return order;
}

test('004 exposes exact schema marker and keeps internal quote/checkout helpers private',()=>fixture(async(db)=>{
  await actor(db,ids.buyer);
  assert.equal(await value(db,'wavekb_schema_version()'),'202610100004');
  for(const call of ['membership_effective_entitlements(auth.uid())','membership_ai_usage(auth.uid())',`membership_mentor_offer_quote(auth.uid(),'${ids.offer}')`,
    `mentor_checkout_order('${ids.offer}','${ids.method}','${randomUUID()}')`,`release_failed_membership_ai_job('${randomUUID()}')`]) {
    await assert.rejects(value(db,call),/permission denied/);
  }
  await assert.rejects(value(db,'get_my_membership_ai_usage($1)',[ids.other]),/authentication_required/);
  await assert.rejects(value(db,'get_my_mentor_offer_quote($1,$2)',[ids.other,ids.offer]),/authentication_required/);
}));
test('free BYOK accepts jobs without a membership reservation; non-VIP managed rejects atomically',()=>fixture(async(db)=>{
  const job=await enqueue(db,{source:'byok'}); assert.equal(job.execution_source,'byok');
  assert.equal((await usage(db)).used,0);
  await assert.rejects(enqueue(db),/membership_ai_vip_required/);
  await db.exec('reset role'); assert.equal(await value(db,'(select count(*)::integer from ai_jobs)'),1);
  assert.equal(await value(db,'(select count(*)::integer from membership_ai_reservations)'),0);
}));
test('50 accepted unique jobs exhaust the Beijing day; retries reserve once and changed requests conflict',()=>fixture(async(db)=>{
  await vip(db); const key=randomUUID(); const first=await enqueue(db,{key});
  const retries=await Promise.all(Array.from({length:5},()=>enqueue(db,{key})));
  assert.ok(retries.every(job=>job.id===first.id)); assert.equal((await usage(db)).used,1);
  await assert.rejects(enqueue(db,{key,input:{step:6}}),/ai_request_conflict/);
  await assert.rejects(enqueue(db,{key,source:'byok'}),/ai_request_conflict/);
  for(let i=1;i<50;i++) await enqueue(db);
  assert.deepEqual(Object.fromEntries(Object.entries(await usage(db)).filter(([key])=>['daily_limit','used','remaining','timezone'].includes(key))),{used:50,timezone:'Asia/Shanghai',remaining:0,daily_limit:50});
  await assert.rejects(enqueue(db),/membership_ai_quota_exceeded/);
  assert.equal((await enqueue(db,{key})).id,first.id);
  await db.exec('reset role'); assert.equal(await value(db,'(select count(*)::integer from ai_jobs)'),50);
}));
test('database day uses Asia/Shanghai rather than caller time and prior-day reservations do not consume today',()=>fixture(async(db)=>{
  await vip(db); const job=await enqueue(db); const current=await usage(db);
  await db.exec('reset role');
  assert.equal(current.usage_day,await value(db,"(now() at time zone 'Asia/Shanghai')::date::text"));
  assert.notEqual(await value(db,"('2026-10-10 16:01+00'::timestamptz at time zone 'Asia/Shanghai')::date::text"),'2026-10-10');
  await db.query("update membership_ai_reservations set usage_day=usage_day-1 where job_id=$1",[job.id]);
  assert.equal((await usage(db)).remaining,50);
}));
test('only server-confirmed final failure refunds once; retry and cancellation retain accepted count',()=>fixture(async(db)=>{
  await vip(db); const job=await enqueue(db);
  await db.exec('reset role'); await db.query("update ai_jobs set status='waiting_retry' where id=$1",[job.id]);
  assert.equal((await usage(db)).used,1);
  await actor(db,null,'service_role'); await assert.rejects(value(db,'release_failed_membership_ai_job($1)',[job.id]),/ai_job_failure_not_confirmed/);
  await db.exec('reset role'); await db.query("update ai_jobs set status='failed',finished_at=now() where id=$1",[job.id]);
  assert.equal((await usage(db)).used,0);
  await actor(db,null,'service_role'); assert.equal(await value(db,'release_failed_membership_ai_job($1)',[job.id]),false);
  await db.exec('reset role'); await assert.rejects(db.query("update ai_jobs set status='queued' where id=$1",[job.id]),/ai_job_terminal/);
  const cancelled=await enqueue(db); await actor(db,ids.buyer); await db.query("update ai_jobs set status='cancelled' where id=$1",[cancelled.id]);
  assert.equal((await usage(db)).used,1);
}));
test('clients cannot spoof source, model, owner, payload identity, terminal state or quota release',()=>fixture(async(db)=>{
  await vip(db); const job=await enqueue(db); await actor(db,ids.buyer);
  await assert.rejects(db.query("insert into ai_jobs(owner_id,analysis_id,task_type,idempotency_key,execution_source,managed_model_id) values($1,$2,'wave_analysis',$3,'managed',$4)",[ids.buyer,analysis,randomUUID(),model]),/permission denied/);
  for(const assignment of ["execution_source='byok'",`owner_id='${ids.other}'`,"finished_at=now()", "input_payload='{}'"]) {
    await assert.rejects(db.query(`update ai_jobs set ${assignment} where id=$1`,[job.id]),/permission denied/);
  }
  for(const status of ['succeeded','failed','running','waiting_retry']) await assert.rejects(db.query('update ai_jobs set status=$1 where id=$2',[status,job.id]),/row-level security/);
  await assert.rejects(db.query("update membership_ai_reservations set status='released',released_at=now()"),/permission denied/);
  await assert.rejects(value(db,'authorize_membership_ai_job($1,$2)',[job.id,ids.buyer]),/permission denied/);
  assert.equal((await usage(db)).used,1);
}));
test('worker authorization rechecks current rights and configuration errors roll back the accepted job',()=>fixture(async(db)=>{
  await vip(db); const job=await enqueue(db);
  await db.exec('reset role'); await db.query("update ai_jobs set status='running' where id=$1",[job.id]);
  await actor(db,null,'service_role'); assert.equal(await value(db,'authorize_membership_ai_job($1,$2)',[job.id,ids.buyer]),true);
  await db.exec('reset role'); await db.exec("update membership_grants set status='revoked'");
  await actor(db,null,'service_role'); await assert.rejects(value(db,'authorize_membership_ai_job($1,$2)',[job.id,ids.buyer]),/membership_ai_vip_required/);
  await vip(db); await db.exec("update ai_task_routes set enabled=false");
  await assert.rejects(enqueue(db),/managed_ai_configuration_required/);
  await db.exec('reset role'); assert.equal(await value(db,'(select count(*)::integer from ai_jobs)'),1);
}));
test('deleting an accepted job cannot reset its daily allowance or erase the durable quota tombstone',()=>fixture(async(db)=>{
  await vip(db); const job=await enqueue(db); await db.exec('reset role'); await db.query('delete from ai_jobs where id=$1',[job.id]);
  assert.equal((await usage(db)).used,1);
  await db.exec('reset role'); const row=(await db.query('select accepted_job_id,job_id from membership_ai_reservations')).rows[0];
  assert.equal(row.accepted_job_id,job.id); assert.equal(row.job_id,null);
}));
test('live paid refund immediately blocks new jobs/discount and queued execution; late paid callback cannot revive it',()=>fixture(async(db)=>{
  const order=await paidVip(db); const job=await enqueue(db); await actor(db,ids.buyer);
  assert.equal((await value(db,'get_my_mentor_offer_quote(auth.uid(),$1)',[ids.offer])).price_cents,9000);
  await db.exec('reset role'); await db.query("update ai_jobs set status='running' where id=$1",[job.id]); await actor(db,null,'service_role');
  await value(db,"apply_verified_membership_refund_event('evt_benefits_refund',$1,$2,'pi_benefits','re_benefits',$3,'USD','succeeded',true)",[order.id,ids.buyer,order.amount_minor]);
  await assert.rejects(enqueue(db),/membership_ai_vip_required/);
  await assert.rejects(value(db,'authorize_membership_ai_job($1,$2)',[job.id,ids.buyer]),/membership_ai_vip_required/);
  await value(db,"apply_verified_membership_payment_event('evt_benefits_late','checkout.session.completed',$1,$2,'cs_benefits','pi_benefits',$3,'USD','paid',true,now())",[order.id,ids.buyer,order.amount_minor]);
  assert.equal((await usage(db)).has_vip,false);
  assert.equal((await value(db,'get_my_mentor_offer_quote(auth.uid(),$1)',[ids.offer])).price_cents,10000);
}));
test('test-mode paid ledger never supplies executable platform AI or mentor discounts',()=>fixture(async(db)=>{
  await paidVip(db,'test'); await assert.rejects(enqueue(db),/membership_ai_vip_required/);
  assert.equal((await usage(db)).daily_limit,0);
  assert.equal((await value(db,'get_my_mentor_offer_quote(auth.uid(),$1)',[ids.offer])).price_cents,10000);
}));
test('mentor authenticated quote and manual checkout freeze nine-fold price while legacy history stays untouched',()=>fixture(async(db,historical)=>{
  await vip(db); await actor(db,ids.buyer);
  const quote=await value(db,'get_my_mentor_offer_quote(auth.uid(),$1)',[ids.offer]);
  assert.deepEqual(quote,{...checkoutQuote,price_cents:9000,base_price_cents:10000,discount_bps:1000});
  const expected={...checkoutQuote,price_cents:9000}; const receipt=await submitCheckout(db,ids.request,'test-only declaration',expected);
  await db.exec('reset role'); const order=(await db.query('select * from mentor_orders where id=$1',[receipt.order_id])).rows[0];
  assert.equal(order.amount_cents,9000); assert.equal(order.base_price_cents_snapshot,10000); assert.equal(order.discount_bps_snapshot,1000);
  assert.equal((await db.query('select base_price_cents_snapshot from mentor_orders where id=$1',[historical])).rows[0].base_price_cents_snapshot,null);
  await db.exec("update membership_grants set status='revoked'; update mentor_offers set price_cents=12000");
  await actor(db,ids.buyer); assert.deepEqual(await submitCheckout(db,ids.request,'test-only declaration',expected),receipt);
  await assert.rejects(submitCheckout(db,ids.request2,'test-only declaration',expected),/offer_changed/);
}));
test('membership change between confirmation and insert cannot return a differently priced manual order',()=>fixture(async(db)=>{
  // Deterministically exercise both SPI quote reads. A real multi-connection
  // PostgreSQL refund/plan race is a separate deployment acceptance gate.
  await vip(db); await db.exec(`create table test_quote_reads(count integer); insert into test_quote_reads values(0);
    create or replace function public.membership_mentor_offer_quote(p_user_id uuid,p_offer_id uuid)
    returns jsonb language plpgsql volatile security definer set search_path='' as $$ declare v_count integer;
    begin update public.test_quote_reads set count=count+1 returning count into v_count;
      return jsonb_build_object('price_cents',case when v_count=1 then 9000 else 10000 end,'base_price_cents',10000,
        'discount_bps',case when v_count=1 then 1000 else 0 end,'currency','USDT','duration_days',30,'weekly_questions',3);
    end; $$;`);
  await actor(db,ids.buyer); await assert.rejects(submitCheckout(db,ids.request,'test-only declaration',{...checkoutQuote,price_cents:9000}),/offer_changed/);
  await db.exec('reset role'); assert.equal(await value(db,'(select count(*)::integer from mentor_payment_claims)'),0);
  assert.equal(await value(db,"(select count(*)::integer from mentor_orders where status='pending')"),0);
}));
test('hosted and legacy manual orders share discount snapshots; account/plan/expiry revoke future quotes',()=>fixture(async(db)=>{
  await vip(db); await actor(db,ids.buyer); const hosted=await value(db,'create_mentor_order($1)',[ids.offer]);
  await db.exec('reset role'); assert.equal((await db.query('select amount_cents from mentor_orders where id=$1',[hosted])).rows[0].amount_cents,9000);
  await db.query("update mentor_orders set status='cancelled' where id=$1",[hosted]); await actor(db,ids.buyer);
  const manual=await value(db,'create_manual_mentor_order($1,$2)',[ids.offer,ids.method]);
  await db.exec('reset role'); assert.equal((await db.query('select amount_cents from mentor_orders where id=$1',[manual])).rows[0].amount_cents,9000);
  await assert.rejects(db.query('update mentor_orders set discount_bps_snapshot=0 where id=$1',[manual]),/mentor_order_terms_immutable/);
  await db.exec("update membership_plans set enabled=false"); await actor(db,ids.buyer);
  assert.equal((await value(db,'get_my_mentor_offer_quote(auth.uid(),$1)',[ids.offer])).price_cents,10000);
  await db.exec('reset role'); await db.exec("update membership_plans set enabled=true; update membership_grants set starts_at=now()-interval '2 days',ends_at=now()-interval '1 day'");
  await actor(db,ids.buyer); assert.equal((await value(db,'get_my_mentor_offer_quote(auth.uid(),$1)',[ids.offer])).price_cents,10000);
  await db.exec('reset role'); await db.query("update profiles set account_status='banned' where id=$1",[ids.buyer]); await actor(db,ids.buyer);
  await assert.rejects(value(db,'get_my_mentor_offer_quote(auth.uid(),$1)',[ids.offer]),/account_ineligible/);
}));
test('discount rounds once in minor units and zero-price promotion fails explicitly, never charging a guessed cent',()=>fixture(async(db)=>{
  await vip(db); await db.query('update mentor_offers set price_cents=10001 where id=$1',[ids.offer]); await actor(db,ids.buyer);
  assert.equal((await value(db,'get_my_mentor_offer_quote(auth.uid(),$1)',[ids.offer])).price_cents,9001);
  await assert.rejects(vip(db,{bps:10000}),/check constraint/);
  await vip(db,{bps:9900}); await db.query('update mentor_offers set price_cents=1 where id=$1',[ids.offer]); await actor(db,ids.buyer);
  await assert.rejects(value(db,'get_my_mentor_offer_quote(auth.uid(),$1)',[ids.offer]),/mentor_discount_free_checkout_unsupported/);
  await assert.rejects(value(db,'create_mentor_order($1)',[ids.offer]),/mentor_discount_free_checkout_unsupported/);
}));
