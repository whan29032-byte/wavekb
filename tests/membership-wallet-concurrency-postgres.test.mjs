// Explicit, isolated real-PostgreSQL proof; the ordinary suite reports SKIP.
// Install outside this repository with:
//   task_dir=$(mktemp -d /tmp/wavekb-postgres-concurrency.XXXXXX)
//   npm install --prefix "$task_dir" embedded-postgres@18.4.0-beta.17 pg@8.16.3
//   WAVEKB_ISOLATED_POSTGRES_MODULE_ROOT="$task_dir" node --test tests/membership-wallet-concurrency-postgres.test.mjs
// No DATABASE_URL, PG*, project .env, persistent DB or live payment is read.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile, realpath, mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const moduleRoot = process.env.WAVEKB_ISOLATED_POSTGRES_MODULE_ROOT;
const ids = { admin:'11111111-1111-4111-8111-111111111111', member:'22222222-2222-4222-8222-222222222222', other:'33333333-3333-4333-8333-333333333333' };
const checkoutIds = { buyer:ids.admin, owner:ids.member, other:'77777777-7777-4777-8777-777777777777', mentor:'33333333-3333-4333-8333-333333333333', offer:'44444444-4444-4444-8444-444444444444', method:'55555555-5555-4555-8555-555555555555' };
const migration = name => readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8');
const value = async (db, sql, args=[]) => (await db.query(`select ${sql} as value`,args)).rows[0].value;
const hash = digit => '0x'+digit.repeat(64);
async function actor(db,id,role='authenticated') {
  assert.ok(['authenticated','service_role'].includes(role));
  await db.query(`reset role; set role ${role}`);
  await db.query("select set_config('test.actor',$1,false)",[id||'']);
}
function template(source,pattern,variables) {
  const match=source.match(pattern); assert.ok(match,'existing synthetic SQL fixture must be recognized');
  return match[1].replace(/\$\{(checkoutIds|ids)\.([a-z]+)\}/g,(_,group,key)=>{
    const result=variables[group][key]; assert.ok(result); return result;
  });
}
async function bootstrap(db) {
  // Reuse the exact existing checkout and wallet synthetic base tables, then
  // execute the production migrations in full, not copied RPC implementations.
  const helper=await readFile(new URL('./helpers/mentor-checkout-database.mjs',import.meta.url),'utf8');
  await db.query(template(helper,/await database\.exec\(`([\s\S]+?)`\);/,{checkoutIds})
    .replace('create role anon; create role authenticated; create role service_role;',''));
  for(const name of ['202607310002_mentor_tutoring.sql','202608040001_tv_mentor_manual_payments.sql','202608040002_mentor_usdt.sql','202608040003_scope_personal_mentor_inbox.sql']) await db.query(await migration(name));
  await db.query((await migration('202608140001_account_enforcement.sql')).match(/create or replace function public\.account_is_active\(\)[\s\S]+?\$\$;/)[0]);
  await db.query(await migration('202610080002_mentor_checkout_recovery.sql'));
  const wallet=await readFile(new URL('./membership-wallet-postgres.test.mjs',import.meta.url),'utf8');
  await db.query(template(wallet,/await db\.exec\(`(grant usage[\s\S]+?)`\);/,{ids}));
  await db.query((await migration('202610100001_admin_payment_hardening.sql')).match(/create or replace function public\.is_admin\(\)[\s\S]+?\$\$;/)[0]);
  for(const name of ['202610100002_membership_foundation.sql','202610100003_membership_commerce.sql','202610100004_membership_benefits.sql','202610100005_membership_wallet_payments.sql']) await db.query(await migration(name));
  assert.equal(await value(db,'wavekb_schema_version()'),'202610100005');
}
async function setup(db) {
  await actor(db,ids.admin);
  await value(db,"admin_save_membership_wallet_route('ethereum-usdc','0x1111111111111111111111111111111111111111',true,1,'隔离并发配置',$1,auth.uid())",[randomUUID()]);
  await value(db,"admin_save_membership_wallet_settings(true,1,'隔离并发配置',$1,auth.uid())",[randomUUID()]);
  const catalog=await value(db,'admin_membership_commerce_store(auth.uid())');
  const plan=catalog.plans[0],price=plan.prices.find(p=>p.term_months===1);
  const quote={price_id:price.id,plan_key:plan.key,price_revision:price.revision,plan_revision:plan.revision,amount_minor:price.amount_minor,currency:price.currency,term_months:price.term_months,route_revision:2};
  return {plan,price,quote};
}
async function prepare(db,c,user=ids.member,request=randomUUID()) {
  await actor(db,null,'service_role');
  return value(db,"prepare_membership_wallet_order($1,$2,'ethereum-usdc',$3,$4::jsonb)",[user,c.price.id,request,JSON.stringify(c.quote)]);
}
async function leased(db,c,user=ids.member,digit='a') {
  const order=await prepare(db,c,user);
  await actor(db,user);await value(db,'submit_membership_wallet_transfer(auth.uid(),$1,$2)',[order.id,hash(digit)]);
  await actor(db,null,'service_role');
  const job=(await value(db,"claim_membership_wallet_verifications(10,'isolated-real-pg')")).find(x=>x.order_id===order.id);
  assert.ok(job);return {order,job};
}
const evidence = ({order,job}) => ({chain:order.chain,contract:order.contract,recipient:order.recipient,amount_units:order.amount_units,tx_hash:job.tx_hash,event_index:0,block_number:100,block_hash:hash('b'),paid_at:order.created_at,finalized:true});
async function apply(db,p) {
  await actor(db,null,'service_role');return value(db,'apply_verified_membership_wallet_transfer($1,$2,$3::jsonb)',[p.order.id,p.job.lease_id,JSON.stringify(evidence(p))]);
}
async function blocked(control,pid) {
  // Poll pg_stat_activity, not a guessed delay, to prove a genuinely concurrent
  // backend is waiting on the lock held by the other independent session.
  await control.query('reset role');
  const deadline=Date.now()+3000;
  while(Date.now()<deadline) {
    const state=(await control.query('select wait_event_type,state from pg_stat_activity where pid=$1',[pid])).rows[0];
    if(state?.wait_event_type==='Lock' && state.state==='active') return;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.fail('independent PostgreSQL backend did not block on held lock');
}
async function freePort() {
  const server=createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;
}

test('isolated real PostgreSQL wallet concurrency (explicit external runtime required)',{
  skip: !moduleRoot && 'NOT RUN: set WAVEKB_ISOLATED_POSTGRES_MODULE_ROOT to a temporary embedded-postgres installation', timeout:120000,
},async t=>{
  const root=await realpath(moduleRoot);
  assert.match(root,/^\/(?:private\/)?tmp\/wavekb-postgres-concurrency\.[A-Za-z0-9]+$/,'only explicit disposable /tmp runtime accepted');
  const require=createRequire(join(root,'package.json'));
  const {default:EmbeddedPostgres}=await import(pathToFileURL(require.resolve('embedded-postgres')).href);
  const {Client}=require('pg');
  const databaseDir=await mkdtemp(join(root,'cluster-')),port=await freePort();
  const user='wavekb_isolated',password=randomUUID();
  const pg=new EmbeddedPostgres({databaseDir,user,password,port,persistent:true,createPostgresUser:false,
    initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-c','listen_addresses=127.0.0.1','-c','max_connections=20'],onLog:()=>{},onError:()=>{}});
  const config={host:'127.0.0.1',port,user,password,database:'postgres',ssl:false,connectionTimeoutMillis:5000,statement_timeout:8000};
  let clusterStarted=false;
  const connections=[];
  async function connect(database='postgres') {
    const c=new Client({...config,database});await c.connect();connections.push(c);return c;
  }
  async function fixture(run) {
    const database='wavekb_concurrency_'+randomUUID().replaceAll('-','');
    await pg.createDatabase(database);
    const control=await connect(database),a=await connect(database),b=await connect(database);
    const pids=await Promise.all([a,b].map(c=>value(c,'pg_backend_pid()')));assert.notEqual(pids[0],pids[1]);
    await bootstrap(control);const c=await setup(control);
    try { await run({control,a,b,c,pids}); }
    finally { for(const client of [a,b,control]) {await client.query('rollback;reset role').catch(()=>{});await client.end();connections.splice(connections.indexOf(client),1);} }
  }
  try {
    await pg.initialise();await pg.start();clusterStarted=true;
    const admin=await connect();
    const embeddedVersion=JSON.parse(await readFile(join(root,'node_modules/embedded-postgres/package.json'),'utf8')).version;
    t.diagnostic(`Actual runtime: ${await value(admin,'version()')}; Node ${process.version}; ${process.platform}/${process.arch}; external embedded-postgres ${embeddedVersion}`);
    await admin.query('create role anon;create role authenticated;create role service_role;');

    await t.test('independent sessions, same request: exactly one frozen invoice',()=>fixture(async({control,a,b,c,pids})=>{
      const request=randomUUID();await a.query('begin');const first=await prepare(a,c,ids.member,request);
      const second=prepare(b,c,ids.member,request);await blocked(control,pids[1]);await a.query('commit');
      assert.deepEqual(await second,first);
      assert.equal(await value(control,'(select count(*)::int from membership_wallet_orders)'),1);
    }));
    await t.test('independent buyers share amount namespace: distinct exact atomic-unit invoices',()=>fixture(async({control,a,b,c,pids})=>{
      await a.query('begin');const one=await prepare(a,c,ids.member);
      const other=prepare(b,c,ids.other);await blocked(control,pids[1]);await a.query('commit');const two=await other;
      assert.notEqual(one.amount_units,two.amount_units);assert.notEqual(one.buyer_id,two.buyer_id);
      assert.equal(await value(control,'(select count(distinct amount_units)::int from membership_wallet_orders)'),2);
    }));
    await t.test('manual grant vs wallet payment: wallet renewal starts at committed manual end',()=>fixture(async({control,a,b,c,pids})=>{
      const p=await leased(control,c);await a.query('begin');await actor(a,ids.admin);
      const end=await value(a,"now()+interval '1 month'");
      await value(a,"admin_change_membership($1,'vip','grant',$2::timestamptz,0,'并发人工期限',$3,auth.uid())",[ids.member,end,randomUUID()]);
      const receipt=apply(b,p);await blocked(control,pids[1]);await a.query('commit');assert.equal((await receipt).outcome,'paid');
      const grant=(await control.query('select starts_at,ends_at=starts_at+interval \'1 month\' as calendar_term from membership_wallet_grants where order_id=$1',[p.order.id])).rows[0];
      assert.equal(grant.starts_at.toISOString(),new Date(end).toISOString());assert.equal(grant.calendar_term,true);
    }));
    await t.test('wallet vs Stripe payment: lock wait stacks a second calendar term without overlap',()=>fixture(async({control,a,b,c,pids})=>{
      const p=await leased(control,c);
      // An old, expired invoice may be confirmed late for an in-window transfer.
      // Synthetic fixture aging only; the production immutable guard stays intact.
      await control.query('reset role;alter table membership_wallet_orders disable trigger membership_wallet_order_guard');
      await control.query("update membership_wallet_orders set created_at=now()-interval '31 minutes',expires_at=now()-interval '1 minute' where id=$1",[p.order.id]);
      await control.query('alter table membership_wallet_orders enable trigger membership_wallet_order_guard');
      p.order=await value(control,'membership_wallet_order_receipt($1)',[p.order.id]);
      await control.query("update membership_commerce_settings set billing_enabled=true,payment_mode='live'");
      await actor(control,null,'service_role');const {route_revision,...quote}=c.quote;
      const stripe=await value(control,'prepare_membership_order($1,$2,$3,$4::jsonb)',[ids.member,c.price.id,randomUUID(),JSON.stringify(quote)]);
      const suffix=stripe.id.replaceAll('-','');
      await value(control,"register_membership_checkout_session($1,$2,$3,'https://checkout.stripe.com/c/pay/isolated',now()+interval '1 day',true)",[ids.member,stripe.id,'cs_'+suffix]);
      await a.query('begin');assert.equal((await apply(a,p)).outcome,'paid');
      await actor(b,null,'service_role');const paid=value(b,"apply_verified_membership_payment_event($1,'checkout.session.completed',$2,$3,$4,$5,$6,'USD','paid',true,now())",['evt_'+suffix,stripe.id,ids.member,'cs_'+suffix,'pi_'+suffix,stripe.amount_minor]);
      await blocked(control,pids[1]);await a.query('commit');assert.equal((await paid).outcome,'paid');
      await control.query('reset role');
      assert.equal(await value(control,'(select s.starts_at=w.ends_at and s.ends_at=s.starts_at+interval \'1 month\' from membership_purchase_grants s cross join membership_wallet_grants w)'),true);
    }));
    for(const mode of ['apply','settle']) await t.test(`expired lease after real row-lock wait rejects ${mode} without ledger changes`,()=>fixture(async({control,a,b,c,pids})=>{
      const p=await leased(control,c);
      await control.query('reset role');
      await control.query("update membership_wallet_verifications set lease_expires_at=clock_timestamp()+interval '350 milliseconds' where id=$1",[p.job.id]);
      await a.query('begin');await a.query('select id from membership_wallet_orders where id=$1 for update',[p.order.id]);
      await actor(b,null,'service_role');
      const pending=(mode==='apply'?value(b,'apply_verified_membership_wallet_transfer($1,$2,$3::jsonb)',[p.order.id,p.job.lease_id,JSON.stringify(evidence(p))]):value(b,"settle_membership_wallet_verification($1,$2,'waiting','rpc_temporarily_unavailable',60)",[p.job.id,p.job.lease_id])).then(v=>({value:v}),error=>({error}));
      await blocked(control,pids[1]);
      // PostgreSQL's actual wall clock must pass the lease while session B is
      // demonstrably blocked; transaction now() remains earlier by design.
      await control.query('select pg_sleep(greatest(0,extract(epoch from (lease_expires_at-clock_timestamp())))+0.05) from membership_wallet_verifications where id=$1',[p.job.id]);
      await a.query('commit');assert.match((await pending).error?.message||'',/membership_wallet_lease_invalid/);
      assert.equal(await value(control,'(select count(*)::int from membership_wallet_receipts)'),0);
      assert.equal(await value(control,'(select count(*)::int from membership_wallet_grants)'),0);
      assert.equal(await value(control,'(select status from membership_wallet_verifications where id=$1)',[p.job.id]),'leased');
    }));
    await t.test('payment/revoke lock race and duplicate replay never reactivate revoked grant',()=>fixture(async({control,a,b,c,pids})=>{
      const p=await leased(control,c);await a.query('begin');assert.equal((await apply(a,p)).outcome,'paid');
      await actor(b,ids.admin);const revoked=value(b,"admin_revoke_membership_wallet_order($1,'并发撤销验收',$2,auth.uid())",[p.order.id,randomUUID()]);
      await blocked(control,pids[1]);await a.query('commit');assert.equal((await revoked).order.status,'revoked');
      const duplicate=await apply(a,p);assert.equal(duplicate.duplicate,true);assert.equal(duplicate.order_status,'revoked');
      await control.query('reset role');assert.equal(await value(control,'(select status from membership_wallet_grants where order_id=$1)',[p.order.id]),'revoked');
      await actor(control,ids.member);assert.equal((await value(control,'get_effective_membership_entitlements(auth.uid())')).has_vip,false);
    }));
    await t.test('revoke first vs second real payment: extra transfer is review, never a resurrected VIP',()=>fixture(async({control,a,b,c,pids})=>{
      const p=await leased(control,c);assert.equal((await apply(control,p)).outcome,'paid');
      await actor(control,ids.member);await value(control,'submit_membership_wallet_transfer(auth.uid(),$1,$2)',[p.order.id,hash('f')]);
      await actor(control,null,'service_role');const extra=(await value(control,"claim_membership_wallet_verifications(10,'isolated-extra-pg')")).find(x=>x.order_id===p.order.id);
      assert.ok(extra);await a.query('begin');await actor(a,ids.admin);
      await value(a,"admin_revoke_membership_wallet_order($1,'撤销优先竞争',$2,auth.uid())",[p.order.id,randomUUID()]);
      const receipt=apply(b,{order:p.order,job:extra});await blocked(control,pids[1]);await a.query('commit');
      const r=await receipt;assert.equal(r.outcome,'review');assert.equal(r.applied,false);assert.equal(r.order_status,'revoked');
      assert.equal(await value(control,'(select count(*)::int from membership_wallet_grants)'),1);
      assert.equal(await value(control,'(select status from membership_wallet_grants where order_id=$1)',[p.order.id]),'revoked');
      assert.equal(await value(control,"(select count(*)::int from membership_wallet_receipts where outcome='review')"),1);
      await actor(control,ids.member);assert.equal((await value(control,'get_effective_membership_entitlements(auth.uid())')).has_vip,false);
    }));
  } finally {
    for(const c of connections) await c.end().catch(()=>{});
    if(clusterStarted) await pg.stop();
    t.diagnostic('Temporary PostgreSQL stopped; synthetic cluster retained for inspection; repository dependencies and live databases untouched.');
  }
});
