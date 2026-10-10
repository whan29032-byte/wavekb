import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
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
async function plan(db,{enabled=true,revision=1,reason="测试启用方案",request=randomUUID(),benefits={research_notes:"测试专属笔记"},title="VIP 会员",description="test-only"}={}) {
  return (await db.query("select admin_save_membership_plan('vip',$1,$2,$3::jsonb,$4,$5,$6,$7,auth.uid()) as value",[title,description,JSON.stringify(benefits),enabled,revision,reason,request])).rows[0].value;
}
async function change(db,{user=ids.member,action="grant",end=until,revision=0,reason="测试会员授予",request=randomUUID()}={}) {
  return (await db.query("select admin_change_membership($1,'vip',$2,$3::timestamptz,$4,$5,$6,auth.uid()) as value",[user,action,end,revision,reason,request])).rows[0].value;
}
async function mine(db) { return (await db.query("select get_my_membership() as value")).rows[0].value; }
async function entitlement(db) { return (await db.query("select has_membership_entitlement('research_notes') as value")).rows[0].value; }

let clientModule;
async function databaseRepository(db,id) {
  if (!clientModule) {
    const types=stripTypeScriptTypes(await readFile(new URL("../apps/web/src/lib/membership/types.ts",import.meta.url),"utf8"));
    const typesUrl=`data:text/javascript;base64,${Buffer.from(types).toString("base64")}`;
    const source=stripTypeScriptTypes((await readFile(new URL("../apps/web/src/lib/membership/client-repository.ts",import.meta.url),"utf8")).replace('"@/lib/membership/types"',JSON.stringify(typesUrl)));
    clientModule=import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  }
  const {membershipRepository}=await clientModule;
  const client={auth:{getUser:async()=>({data:{user:{id:(await db.query("select auth.uid() as id")).rows[0].id}},error:null})},rpc:async(name,p)=>{
    try {
      let result;
      if(name==="admin_save_membership_plan") result=await db.query("select admin_save_membership_plan($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9) as value",[p.p_key,p.p_title,p.p_description,JSON.stringify(p.p_benefits),p.p_enabled,p.p_expected_revision,p.p_reason,p.p_request_id,p.p_actor_id]);
      else if(name==="admin_change_membership") result=await db.query("select admin_change_membership($1,$2,$3,$4::timestamptz,$5,$6,$7,$8) as value",[p.p_user_id,p.p_plan_key,p.p_action,p.p_ends_at,p.p_expected_revision,p.p_reason,p.p_request_id,p.p_actor_id]);
      else if(name==="admin_membership_store") result=await db.query("select admin_membership_store($1,$2) as value",[p.p_public_uid,p.p_actor_id]);
      else if(name==="get_my_membership") result=await db.query("select get_my_membership() as value");
      else throw new Error("unexpected membership RPC");
      return {data:result.rows[0].value,error:null};
    } catch(error) { return {data:null,error}; }
  }};
  return membershipRepository(client,id);
}

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
test("same-timestamp plan, grant, extend and revoke history follows generated sequence, not UUID order",()=>fixture(async(db)=>{
  await db.exec(`reset role; begin;
    create sequence membership_test_uuid_sequence;
    create function membership_test_event_uuid() returns uuid language sql volatile as $$
      select ('00000000-0000-4000-8000-'||lpad((1000000-nextval('membership_test_uuid_sequence'))::text,12,'0'))::uuid;
    $$;
    alter table membership_events alter column id set default membership_test_event_uuid();
    alter table membership_events alter column created_at set default '2030-01-01T00:00:00Z'::timestamptz;`);
  await actor(db,ids.admin);
  await plan(db); const granted=await change(db);
  const extended=await change(db,{action:"extend",end:new Date(Date.now()+60*864e5).toISOString(),revision:1});
  const revoked=await change(db,{action:"revoke",end:null,revision:2});
  const store=(await db.query("select admin_membership_store(10002,auth.uid()) as value")).rows[0].value;
  assert.deepEqual(store.history.map((event)=>event.action),["revoked","extended","granted","plan_updated"]);
  assert.equal(new Set(store.history.map((event)=>event.created_at)).size,1);
  assert.equal(store.history[0].before_state.revision,2); assert.equal(store.history[0].after_state.status,"revoked");
  assert.equal(store.history[1].before_state.revision,1); assert.equal(store.history[1].after_state.revision,2);
  assert.equal(store.history[2].before_state,null); assert.equal(store.history[2].after_state.id,granted.id);
  assert.ok(store.history.every((event)=>!("event_sequence" in event)));
  assert.deepEqual(store.history.map((event)=>event.id),[...store.history.map((event)=>event.id)].sort());
  await actor(db,ids.member); const current=await mine(db);
  assert.deepEqual(current.history.map((event)=>event.action),["revoked","extended","granted"]);
  assert.ok(current.history.every((event)=>!("event_sequence" in event)));
  assert.equal(current.grants[0].id,granted.id); assert.equal(current.grants[0].status,"revoked");
  assert.equal(revoked.id,extended.id); assert.equal(extended.id,granted.id); assert.equal(await entitlement(db),false);
  await db.exec("reset role");
  const rows=(await db.query("select event_sequence::text as sequence, action from membership_events order by event_sequence")).rows;
  assert.deepEqual(rows.map((event)=>event.action),["plan_updated","granted","extended","revoked"]);
  assert.ok(rows.every((event,index)=>index===0 || BigInt(event.sequence)>BigInt(rows[index-1].sequence)));
  await db.exec("commit");
}));
test("same-timestamp history limits take the latest 50 events before aggregation for both readers",()=>fixture(async(db)=>{
  await db.exec("reset role; begin; alter table membership_events alter column created_at set default '2030-01-01T00:00:00Z'::timestamptz;");
  await actor(db,ids.admin); await plan(db); await change(db);
  for(let index=1;index<=55;index++) await change(db,{action:"extend",end:new Date(Date.now()+(30+index)*864e5).toISOString(),revision:index});
  await change(db,{action:"revoke",end:null,revision:56});
  const store=(await db.query("select admin_membership_store(10002,auth.uid()) as value")).rows[0].value;
  assert.equal(store.history.length,50); assert.equal(new Set(store.history.map((event)=>event.created_at)).size,1);
  assert.deepEqual(store.history.map((event)=>event.action),["revoked",...Array(49).fill("extended")]);
  assert.deepEqual(store.history.map((event)=>event.after_state.revision),Array.from({length:50},(_,index)=>57-index));
  assert.equal(store.history[0].before_state.revision,56); assert.equal(store.history[0].after_state.status,"revoked");
  await actor(db,ids.member); const current=await mine(db);
  assert.equal(current.history.length,50); assert.deepEqual(current.history.map((event)=>event.id),store.history.map((event)=>event.id));
  await db.exec("reset role");
  const expected=(await db.query("select id from membership_events where user_id=$1 order by event_sequence desc limit 50",[ids.member])).rows.map((event)=>event.id);
  assert.deepEqual(current.history.map((event)=>event.id),expected);
  assert.equal((await db.query("select count(*)::int as count from membership_events")).rows[0].count,58);
  await db.exec("commit");
}));
test("event ordering sequence is internal and cannot be assigned or consumed by browser roles",()=>fixture(async(db)=>{
  await plan(db); await change(db); await db.exec("reset role");
  const sequence=(await db.query("select pg_get_serial_sequence('public.membership_events','event_sequence') as name")).rows[0].name;
  const before=(await db.query("select to_jsonb(e) as value from membership_events e order by event_sequence")).rows.map((event)=>event.value);
  await assert.rejects(db.query("insert into membership_events(event_sequence,request_id,actor_id,plan_key,action,reason,request,after_state) values(999,$1,$2,'vip','plan_updated','测试禁止写序号','{}','{}')",[randomUUID(),ids.admin]),/cannot insert a non-DEFAULT value|generated always/i);
  for(const [id,role] of [[ids.admin,"authenticated"],[ids.member,"authenticated"],[null,"anon"]]) {
    await actor(db,id,role);
    await assert.rejects(db.query("select nextval($1::regclass)",[sequence]),/permission denied/);
    await assert.rejects(db.query("select setval($1::regclass,999)",[sequence]),/permission denied/);
    await assert.rejects(db.query("insert into membership_events(event_sequence,request_id,actor_id,plan_key,action,reason,request,after_state) values(999,$1,$2,'vip','plan_updated','测试禁止写序号','{}','{}')",[randomUUID(),ids.admin]),/permission denied|cannot insert a non-DEFAULT value/);
  }
  await db.exec("reset role");
  const after=(await db.query("select to_jsonb(e) as value from membership_events e order by event_sequence")).rows.map((event)=>event.value);
  assert.deepEqual(after,before);
}));
test("additive ordering column preserves old event UUIDs and payloads and can be reapplied",()=>fixture(async(db)=>{
  await plan(db); await change(db); await db.exec("reset role");
  const contents=async()=> (await db.query("select to_jsonb(e)-'event_sequence' as value from membership_events e order by id")).rows.map((event)=>event.value);
  const before=await contents();
  await db.exec("alter table membership_events drop column event_sequence;");
  const migration=await load("202610100002_membership_foundation.sql");
  const addColumn=migration.match(/alter table public\.membership_events\s+add column if not exists event_sequence bigint generated always as identity;/)[0];
  await db.exec(addColumn); assert.deepEqual(await contents(),before);
  const sequences=(await db.query("select event_sequence::text as sequence from membership_events order by id")).rows;
  assert.equal(new Set(sequences.map((event)=>event.sequence)).size,before.length);
  await db.exec(addColumn); assert.deepEqual(await contents(),before);
  assert.deepEqual((await db.query("select event_sequence::text as sequence from membership_events order by id")).rows,sequences);
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

test("SQL trims exactly the JavaScript whitespace set without stripping non-whitespace Unicode",()=>fixture(async(db)=>{
  await db.exec("reset role");
  const codes=[9,10,11,12,13,32,160,5760,...Array.from({length:11},(_,index)=>8192+index),8232,8233,8239,8287,12288,65279,133,6158,8203];
  for(const code of codes) {
    const space=String.fromCodePoint(code),value=`${space}会员👑${space}`;
    assert.equal((await db.query("select membership_trim_text($1) as value",[value])).rows[0].value,value.trim(),`U+${code.toString(16)}`);
  }
}));
test("canonical text commits once and round-trips through the actual client receipt and account parsers",()=>fixture(async(db)=>{
  const repository=await databaseRepository(db,ids.admin);
  const input={key:"vip",title:"\u00a0\tVIP 会员\ufeff",description:"  保留说明\r\n",benefits:{research_notes:`${" ".repeat(300)}专属笔记\u2003\u00a0`},enabled:true,revision:1,reason:"\u00a0\t确认方案内容\ufeff",requestId:randomUUID()};
  const saved=await repository.savePlan(input);
  assert.equal(saved.title,"VIP 会员"); assert.equal(saved.description,input.description); assert.deepEqual(saved.benefits,{research_notes:"专属笔记"});
  assert.deepEqual(await repository.savePlan(input),saved);
  assert.deepEqual((await repository.adminStore(10002)).plans[0].benefits,saved.benefits);
  await repository.change({userId:ids.member,planKey:"vip",action:"grant",endsAt:until,revision:0,reason:"\u2003确认会员授予\u00a0",requestId:randomUUID()});
  await actor(db,ids.member);
  assert.deepEqual((await (await databaseRepository(db,ids.member)).mine()).grants[0].benefits,saved.benefits); assert.equal(await entitlement(db),true);
  await db.exec("reset role");
  const events=(await db.query("select action,reason,request from membership_events order by created_at,event_sequence")).rows;
  assert.equal(events.length,2); assert.equal(events[0].reason,"确认方案内容"); assert.equal(events[0].request.title,input.title); assert.equal(events[0].request.reason,input.reason); assert.equal(events[1].reason,"确认会员授予");
}));
test("maximum Unicode code-point fields, including emoji, remain readable after real RPC writes",()=>fixture(async(db)=>{
  const repository=await databaseRepository(db,ids.admin);
  const input={key:"vip",title:"👑".repeat(60),description:"👑".repeat(1000),benefits:{research_notes:"👑".repeat(240)},enabled:true,revision:1,reason:"👑".repeat(500),requestId:randomUUID()};
  const saved=await repository.savePlan(input); assert.equal(saved.title,input.title); assert.equal(saved.description,input.description); assert.deepEqual(saved.benefits,input.benefits);
  await repository.change({userId:ids.member,planKey:"vip",action:"grant",endsAt:until,revision:0,reason:input.reason,requestId:randomUUID()});
  assert.deepEqual((await repository.adminStore(10002)).plans[0].benefits,input.benefits);
  await actor(db,ids.member); assert.deepEqual((await (await databaseRepository(db,ids.member)).mine()).grants[0].benefits,input.benefits);
}));
test("invalid normalized text and Unicode limits are rejected before any plan, grant or audit write",()=>fixture(async(db)=>{
  for(const [input,message] of [
    [{title:"\u00a0\t\ufeff"},/membership_input_invalid/], [{title:"👑"},/membership_input_invalid/], [{title:"👑".repeat(61)},/membership_input_invalid/],
    [{description:"👑".repeat(1001)},/membership_input_invalid/], [{reason:"👑".repeat(501)},/membership_input_invalid/], [{reason:"\u00a0\t\ufeff"},/membership_input_invalid/],
    [{benefits:{research_notes:"\u00a0\t\ufeff"}},/membership_benefits_invalid/], [{benefits:{research_notes:"👑".repeat(241)}},/membership_benefits_invalid/],
  ]) await assert.rejects(plan(db,input),message);
  const initial=(await db.query("select admin_membership_store(null,auth.uid()) as value")).rows[0].value;
  assert.equal(initial.plans[0].revision,1); assert.equal(initial.plans[0].enabled,false); assert.deepEqual(initial.history,[]);
  await plan(db);
  for(const reason of ["\u00a0\t\ufeff","👑".repeat(501)]) await assert.rejects(change(db,{reason}),/membership_input_invalid/);
  const after=(await db.query("select admin_membership_store(10002,auth.uid()) as value")).rows[0].value;
  assert.deepEqual(after.grants,[]); assert.equal(after.history.length,1); assert.equal(after.history[0].action,"plan_updated");
}));
test("replayed receipts never reactivate disabled plans or revoked grants; re-enabling only resumes unrevoked rights",()=>fixture(async(db)=>{
  const planRequest=randomUUID(),grantRequest=randomUUID();
  const enabled=await plan(db,{request:planRequest}); const granted=await change(db,{request:grantRequest});
  await plan(db,{enabled:false,revision:2});
  assert.deepEqual(await plan(db,{request:planRequest}),enabled);
  await actor(db,ids.member); assert.equal(await entitlement(db),false);
  await actor(db,ids.admin); await plan(db,{revision:3});
  await actor(db,ids.member); assert.equal(await entitlement(db),true);
  await actor(db,ids.admin); await plan(db,{enabled:false,revision:4});
  await change(db,{action:"revoke",end:null,revision:1});
  assert.deepEqual(await change(db,{request:grantRequest}),granted);
  const current=(await db.query("select admin_membership_store(10002,auth.uid()) as value")).rows[0].value;
  assert.equal(current.grants[0].status,"revoked"); assert.equal(current.plans[0].enabled,false);
  await plan(db,{revision:5}); await actor(db,ids.member); assert.equal(await entitlement(db),false);
  await db.exec("reset role"); assert.equal((await db.query("select count(*)::int as count from membership_events")).rows[0].count,7);
}));
