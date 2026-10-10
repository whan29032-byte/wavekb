import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const ids={admin:"11111111-1111-4111-8111-111111111111",member:"22222222-2222-4222-8222-222222222222",other:"33333333-3333-4333-8333-333333333333"};
const load=async(name)=>readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),"utf8");
async function actor(db,id,role="authenticated") { await db.exec(`reset role; set role ${role};`); await db.query("select set_config('test.actor',$1,false)",[id||""]); }
async function fixture(run) {
  const db=new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor',true),'')::uuid $$;
      grant usage on schema auth to anon,authenticated;
      create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
      create table public.profiles(id uuid primary key,public_uid bigint,display_name text,account_status text,role text);
      insert into auth.users values('${ids.admin}',now()),('${ids.member}',now()),('${ids.other}',now());
      insert into profiles values('${ids.admin}',10001,'管理员','active','admin'),('${ids.member}',10002,'普通用户','active','user'),('${ids.other}',10003,'其他用户','active','user');`);
    const enforcement=await load("202608140001_account_enforcement.sql");
    await db.exec(enforcement.match(/create or replace function public\.account_is_active\(\)[\s\S]+?\$\$;/)[0]);
    const hardening=await load("202610100001_admin_payment_hardening.sql");
    await db.exec(hardening.match(/create or replace function public\.is_admin\(\)[\s\S]+?\$\$;/)[0]);
    await db.exec(await load("202610100002_membership_foundation.sql"));
    await actor(db,ids.admin); await run(db);
  } finally { await db.close(); }
}
const until=new Date(Date.now()+30*864e5).toISOString();
async function plan(db,{enabled=true,revision=1,reason="测试启用方案",request=randomUUID(),benefits={research_notes:"测试专属笔记"}}={}) {
  return (await db.query("select admin_save_membership_plan('vip','VIP 会员','test-only',$1::jsonb,$2,$3,$4,$5,auth.uid()) as value",[JSON.stringify(benefits),enabled,revision,reason,request])).rows[0].value;
}
async function change(db,{user=ids.member,action="grant",end=until,revision=0,reason="测试会员授予",request=randomUUID()}={}) {
  return (await db.query("select admin_change_membership($1,'vip',$2,$3::timestamptz,$4,$5,$6,auth.uid()) as value",[user,action,end,revision,reason,request])).rows[0].value;
}
async function mine(db) { return (await db.query("select get_my_membership() as value")).rows[0].value; }
async function entitlement(db) { return (await db.query("select has_membership_entitlement('research_notes') as value")).rows[0].value; }

test("membership initializes disabled, with no billing or changes to account roles",()=>fixture(async(db)=>{
  await assert.rejects(change(db),/membership_plan_disabled/);
  await actor(db,ids.member);
  assert.deepEqual(await mine(db),{billing_enabled:false,grants:[],history:[]}); assert.equal(await entitlement(db),false);
  await db.exec("reset role"); assert.equal((await db.query("select role from profiles where id=$1",[ids.member])).rows[0].role,"user");
}));
test("ordinary users cannot read other accounts, grant themselves, configure plans, or write tables",()=>fixture(async(db)=>{
  await plan(db); await change(db); await actor(db,ids.other);
  assert.deepEqual((await mine(db)).grants,[]);
  await assert.rejects(db.query("select admin_membership_store(10002,auth.uid())"),/admin_required/);
  await assert.rejects(change(db,{user:ids.other}),/admin_required/); await assert.rejects(plan(db,{revision:2}),/admin_required/);
  for(const table of ["membership_plans","membership_grants","membership_events"]) await assert.rejects(db.query(`select * from ${table}`),/permission denied/);
  await assert.rejects(db.query("update membership_grants set ends_at=now()+interval '2 years'"),/permission denied/);
  await actor(db,null,"anon"); await assert.rejects(db.query("select get_my_membership()"),/permission denied/);
}));
test("active grant, extend and revoke change rights immediately and preserve before-after audit",()=>fixture(async(db)=>{
  await plan(db); const grant=await change(db); assert.equal(grant.revision,1);
  await actor(db,ids.member); assert.equal(await entitlement(db),true); assert.equal((await mine(db)).grants[0].status,"active");
  await actor(db,ids.admin); const extended=await change(db,{action:"extend",end:new Date(Date.now()+60*864e5).toISOString(),revision:1}); assert.equal(extended.revision,2);
  const revoked=await change(db,{action:"revoke",end:null,revision:2}); assert.equal(revoked.status,"revoked");
  const store=(await db.query("select admin_membership_store(10002,auth.uid()) as value")).rows[0].value;
  assert.equal(store.history.length,4); assert.equal(store.history[0].before_state.revision,2); assert.equal(store.history[0].after_state.status,"revoked");
  await actor(db,ids.member); assert.equal(await entitlement(db),false); assert.deepEqual((await mine(db)).grants[0].benefits,{});
}));
test("lost-response retries are idempotent and changed actor or parameters conflict",()=>fixture(async(db)=>{
  const planRequest=randomUUID(); const saved=await plan(db,{request:planRequest}); assert.deepEqual(await plan(db,{request:planRequest}),saved);
  await assert.rejects(plan(db,{request:planRequest,reason:"不同的操作原因"}),/request_conflict/);
  const request=randomUUID(); const grant=await change(db,{request}); assert.deepEqual(await change(db,{request}),grant);
  await assert.rejects(change(db,{request,reason:"changed request"}),/request_conflict/);
  await db.exec("reset role"); await db.query("update profiles set role='admin' where id=$1",[ids.other]); await actor(db,ids.other);
  await assert.rejects(change(db,{request}),/request_conflict/);
  await db.exec("reset role"); assert.equal((await db.query("select count(*)::int as count from membership_events where user_id is not null")).rows[0].count,1);
}));
test("disabled, expired, banned and unverified accounts never retain executable rights",()=>fixture(async(db)=>{
  await plan(db); await change(db); await plan(db,{enabled:false,revision:2}); await actor(db,ids.member);
  assert.equal(await entitlement(db),false); assert.equal((await mine(db)).grants[0].status,"disabled");
  await actor(db,ids.admin); await plan(db,{revision:3}); await db.exec("reset role");
  await db.exec("update membership_grants set starts_at=now()-interval '2 days',ends_at=now()-interval '1 day'");
  await actor(db,ids.member); assert.equal(await entitlement(db),false); assert.equal((await mine(db)).grants[0].status,"expired");
  await db.exec("reset role"); await db.exec("update membership_grants set ends_at=now()+interval '1 day'");
  await db.query("update profiles set account_status='banned' where id=$1",[ids.member]); await actor(db,ids.member);
  assert.equal(await entitlement(db),false); await assert.rejects(mine(db),/account_ineligible/);
  await db.exec("reset role"); await db.query("update profiles set account_status='active' where id=$1",[ids.member]); await db.query("update auth.users set email_confirmed_at=null where id=$1",[ids.member]); await actor(db,ids.member);
  assert.equal(await entitlement(db),false); await assert.rejects(mine(db),/account_ineligible/);
}));
test("banned admins and inactive recipients cannot receive or change grants",()=>fixture(async(db)=>{
  await plan(db); await db.exec("reset role"); await db.query("update profiles set account_status='banned' where id=$1",[ids.admin]); await actor(db,ids.admin);
  await assert.rejects(change(db),/admin_required/); await assert.rejects(plan(db,{revision:2}),/admin_required/); await assert.rejects(db.query("select admin_membership_store(10002,auth.uid())"),/admin_required/);
  await db.exec("reset role"); await db.query("update profiles set account_status='active' where id=$1",[ids.admin]); await db.query("update profiles set public_uid=null where id=$1",[ids.member]); await actor(db,ids.admin);
  await assert.rejects(change(db),/account_ineligible/);
}));
test("stale revisions and invalid dates, null reasons and malformed benefits roll back atomically",()=>fixture(async(db)=>{
  await assert.rejects(plan(db,{reason:null}),/membership_input_invalid/); await assert.rejects(plan(db,{benefits:{bad:true}}),/membership_benefits_invalid/);
  await plan(db); await assert.rejects(plan(db,{revision:1}),/membership_changed_concurrently/);
  for(const end of [null,"2020-01-01","infinity","2099-01-01"]) await assert.rejects(change(db,{end}),/membership_dates_invalid/);
  const grant=await change(db); await assert.rejects(change(db,{action:"revoke",revision:0}),/membership_changed_concurrently/);
  await assert.rejects(change(db,{action:"extend",revision:1,end:until}),/membership_extension_invalid/);
  await assert.rejects(change(db,{action:"revoke",revision:1,reason:null}),/membership_input_invalid/);
  await actor(db,ids.member); assert.equal((await mine(db)).grants[0].id,grant.id); assert.equal(await entitlement(db),true);
}));
test("duplicate simultaneous submissions produce one grant and one audit event in the real DB",()=>fixture(async(db)=>{
  await plan(db); const request=randomUUID(); const receipts=await Promise.all(Array.from({length:8},()=>change(db,{request})));
  assert.ok(receipts.every((item)=>item.id===receipts[0].id)); await db.exec("reset role");
  assert.equal((await db.query("select count(*)::int as count from membership_grants")).rows[0].count,1);
  assert.equal((await db.query("select count(*)::int as count from membership_events where request_id=$1",[request])).rows[0].count,1);
}));
test("an admin session switched between verification and RPC cannot execute the previous actor's intent",()=>fixture(async(db)=>{
  await plan(db); await db.exec("reset role"); await db.query("update profiles set role='admin' where id=$1",[ids.other]); await actor(db,ids.other);
  await assert.rejects(db.query("select admin_change_membership($1,'vip','grant',$2::timestamptz,0,'测试身份绑定',$3,$4)",[ids.member,until,randomUUID(),ids.admin]),/admin_required/);
  await assert.rejects(db.query("select admin_save_membership_plan('vip','VIP 会员','test','{}',true,2,'测试身份绑定',$1,$2)",[randomUUID(),ids.admin]),/admin_required/);
  await assert.rejects(db.query("select admin_membership_store(10002,$1)",[ids.admin]),/admin_required/);
  await assert.rejects(db.query("select admin_membership_store(10002)"),/admin_required/);
  await db.exec("reset role"); assert.equal((await db.query("select count(*)::int as count from membership_grants")).rows[0].count,0);
}));
