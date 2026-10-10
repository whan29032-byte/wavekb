import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(new URL("../supabase/migrations/20261010223739_hermes_private_research.sql", import.meta.url), "utf8");
const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222", admin = "33333333-3333-4333-8333-333333333333";
const analysis = "44444444-4444-4444-8444-444444444444", otherAnalysis = "55555555-5555-4555-8555-555555555555";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
const digest = (value) => hash(JSON.stringify(stable(value)));
const sourceNames = ["source-pages-001-070","source-pages-071-140","source-pages-141-210","source-pages-211-280","updated-rules-and-examples","practical-courses-01-17-distilled","chanlun-trading-system","cross-market-sync","wave-chanlun-integration"];
const labels = ["book-distillation-001","book-distillation-002","book-distillation-003","book-distillation-004","rule-supplement","course-distillation","structure-context","market-context","integration-context"];
function artifactFixture() {
  const sources=[],chunks=[];
  sourceNames.forEach((name,i)=>{
    const text=`本段为补充理论资料；不得覆盖网站第十一版原书规则。未载入的图片不构成已验证证据。\n\n补充结构资料 ${i}：规则、假设与验证必须分开。\n引用测试 "中文" 👋`;
    const originalText=`original ${i} private source`, originalHash=hash(originalText), curatedHash=hash(text);
    const relativePath=`references/${name}.md`, id=`s_${hash(`${relativePath}\0${originalHash}`).slice(0,32)}`;
    const receipt={schemaVersion:"hermes-theory-curation-receipt-v1",originalSha256:originalHash,curatedSha256:curatedHash,
      counts:{imagesOmitted:0,referenceLinesOmitted:0,referenceMentionsReplaced:0,titleMentionsReplaced:0,newlinesNormalized:0,noticeAdded:1}};
    receipt.transformSha256=digest(receipt);
    sources.push({id,relativePath,sourceLabel:labels[i],authority:"supplement",original:{sha256:originalHash,bytes:Buffer.byteLength(originalText),version:`sha256:${originalHash}`},
      curated:{sha256:curatedHash,bytes:Buffer.byteLength(text),version:"hermes-theory-curation-v1"},receipt});
    chunks.push({id:`h_${hash(`${id}\0${0}\0${text}`).slice(0,32)}`,sourceId:id,index:0,text,sha256:curatedHash,authority:"supplement"});
  });
  const artifact={schemaVersion:"hermes-private-theory-v2",classification:"server-private",authority:"supplement",curationVersion:"hermes-theory-curation-v1",privateSourceTerms:["私有书名"],sources,chunks};
  artifact.artifactSha256=digest(artifact); return artifact;
}
const output={schema_version:"wavekb-public-analysis-v1",source_visibility:"private_research",knowledge_version:"a".repeat(64),
  instrument:"BTCUSDT",timeframe:"1h",analysis_level:"日内",parent_trend:"不确定",current_pattern:"候选推进",current_subwave:"待验证",
  valid_scenarios:[],eliminated_scenarios:[],unknown_fields:["需要更多观察"],citations:[],knowledge_citations:[],analysis_basis:[]};
async function role(db, name="service_role", jwt=name) {
  await db.exec(`reset role; set role ${name};`);
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:jwt})]);
}
async function setup() {
  const db=new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
    grant usage on schema auth to anon,authenticated,service_role;
    create table public.profiles(id uuid primary key,role text,account_status text);
    create table public.workbench_analyses(id uuid primary key,owner_id uuid references profiles(id));
    create table public.ai_jobs(id uuid primary key,owner_id uuid references profiles(id),analysis_id uuid references workbench_analyses(id),task_type text,status text,output_payload jsonb,knowledge_version text);
    create table public.knowledge_retrievals(id uuid primary key);
    insert into profiles values('${owner}','user','active'),('${other}','user','active'),('${admin}','admin','active');
    insert into workbench_analyses values('${analysis}','${owner}'),('${otherAnalysis}','${other}');
    grant select,insert,update on public.ai_jobs to service_role;
    grant select on public.profiles to service_role;
    grant select,update on public.workbench_analyses to service_role;
    grant select,update on public.ai_jobs to authenticated;`);
  await db.exec(migration); await role(db); return db;
}
async function job(db,{id=randomUUID(),status="running",analysisId=analysis,ownerId=owner,task="wave_analysis",value=output}={}) {
  await db.query("insert into ai_jobs values($1,$2,$3,$4,$5,$6::jsonb,$7)",[id,ownerId,analysisId,task,status,JSON.stringify(value),output.knowledge_version]); return id;
}
async function register(db,artifact) {
  return (await db.query("select hermes_research_register_artifact($1::jsonb,$2) as value",[JSON.stringify(artifact),artifact.artifactSha256])).rows[0].value;
}
async function active(db) { return (await db.query("select hermes_research_load_active_artifact() as value")).rows[0].value; }
async function retrieval(db,id,artifact,{ids=[artifact.chunks[0].id],context="b".repeat(64)}={}) {
  return (await db.query("select hermes_research_record_retrieval($1,$2,$3,$4) as value",[id,artifact.artifactSha256,ids,context])).rows[0].value;
}
async function candidate(db,id,value=output,version=output.knowledge_version) {
  return (await db.query("select hermes_research_record_candidate($1,$2::jsonb,$3) as value",[id,JSON.stringify(value),version])).rows[0].value;
}

test("Hermes private research actual PostgreSQL boundaries and atomic learning lifecycle",async(t)=>{
  const db=await setup(), artifact=artifactFixture();
  try {
    await t.test("starts empty and canonical hashes match JavaScript for Unicode, escapes and provenance",async()=>{
      assert.equal(await active(db),null); assert.equal(await register(db,artifact),artifact.artifactSha256);
      assert.equal(await register(db,artifact),artifact.artifactSha256);
      const source=(await db.query("select * from hermes_research_private.source_lineage order by source_id limit 1")).rows[0];
      assert.notEqual(source.original_sha256,source.curated_sha256);
      assert.equal(source.original_version,`sha256:${source.original_sha256}`); assert.equal(source.curated_version,"hermes-theory-curation-v1");
      assert.equal(source.receipt.originalSha256,source.original_sha256);
      const registered=(await db.query("select count(*)::int as count from hermes_research_private.artifacts")).rows[0].count;
      assert.equal(registered,1); assert.equal(await active(db),null);
    });
    await t.test("artifact registration rejects corrupted digest, lineage, nulls, extra metadata and chunk mismatch",async()=>{
      for(const mutate of [
        (v)=>{v.artifactSha256="f".repeat(64);}, (v)=>{v.sources[0].receipt.curatedSha256="f".repeat(64);v.artifactSha256=digest(Object.fromEntries(Object.entries(v).filter(([k])=>k!=="artifactSha256")));},
        (v)=>{v.classification=null;v.artifactSha256=digest(Object.fromEntries(Object.entries(v).filter(([k])=>k!=="artifactSha256")));},
        (v)=>{v.filename="private-name";v.artifactSha256=digest(Object.fromEntries(Object.entries(v).filter(([k])=>k!=="artifactSha256")));},
        (v)=>{v.chunks[0].text="different";v.artifactSha256=digest(Object.fromEntries(Object.entries(v).filter(([k])=>k!=="artifactSha256")));},
        (v)=>{v.sources[0].original.bytes=String(v.sources[0].original.bytes);v.artifactSha256=digest(Object.fromEntries(Object.entries(v).filter(([k])=>k!=="artifactSha256")));},
      ]) { const value=structuredClone(artifact);mutate(value);await assert.rejects(register(db,value),/hermes_research_artifact_invalid/); }
      assert.equal((await db.query("select count(*)::int as count from hermes_research_private.artifacts")).rows[0].count,1);
    });
    await t.test("registration does not activate; explicit activation is revision-protected",async()=>{
      const result=(await db.query("select hermes_research_activate_artifact($1,0) as value",[artifact.artifactSha256])).rows[0].value;
      assert.deepEqual(result,{artifact_sha256:artifact.artifactSha256,revision:1});
      assert.deepEqual(await active(db),{artifact,expected_sha256:artifact.artifactSha256});
      await assert.rejects(db.query("select hermes_research_activate_artifact($1,0)",[artifact.artifactSha256]),/revision_conflict/);
      await assert.rejects(db.query("select hermes_research_activate_artifact($1,1)",["f".repeat(64)]),/artifact_missing/);
    });
    await t.test("browser/admin roles cannot read private tables or RPCs, forged JWTs cannot bypass database role",async()=>{
      const tables=["artifacts","source_lineage","active_snapshot","retrieval_audits","learning_candidates","candidate_reviews"];
      for(const name of ["anon","authenticated"]) {
        await role(db,name,"service_role");
        for(const table of tables) await assert.rejects(db.query(`select * from hermes_research_private.${table}`),/permission denied/);
        await assert.rejects(active(db),/permission denied/); await assert.rejects(register(db,artifact),/permission denied/);
        await assert.rejects(db.query("select hermes_research_activate_artifact($1,1)",[artifact.artifactSha256]),/permission denied/);
        await assert.rejects(db.query("select hermes_research_record_candidate($1,'{}','x')",[randomUUID()]),/permission denied/);
        await assert.rejects(db.query("select hermes_research_record_retrieval($1,$2,$3,$4)",[randomUUID(),artifact.artifactSha256,[artifact.chunks[0].id],"b".repeat(64)]),/permission denied/);
        await assert.rejects(db.query("select hermes_research_review_candidate($1,$2,$3,'supported','test','{}')",[randomUUID(),randomUUID(),admin]),/permission denied/);
      }
      await role(db,"service_role","authenticated"); await assert.rejects(active(db),/service_required/); await role(db);
    });
    await t.test("retrieval uses actual job owner, rejects foreign/failed/queued jobs and unregistered chunk IDs",async()=>{
      const id=await job(db); const receipt=await retrieval(db,id,artifact); assert.equal(await retrieval(db,id,artifact),receipt);
      const audit=(await db.query("select * from hermes_research_private.retrieval_audits where id=$1",[receipt])).rows[0];
      assert.equal(audit.owner_id,owner); assert.equal(audit.analysis_id,analysis);
      const empty=await retrieval(db,id,artifact,{ids:[],context:"c".repeat(64)});assert.ok(empty);
      await assert.rejects(retrieval(db,id,artifact,{ids:[artifact.chunks[1].id]}),/retrieval_conflict/);
      await assert.rejects(retrieval(db,id,artifact,{ids:["h_"+"f".repeat(32)]}),/retrieval_invalid/);
      await assert.rejects(retrieval(db,id,artifact,{ids:[artifact.chunks[0].id,artifact.chunks[0].id]}),/retrieval_invalid/);
      for(const details of [{status:"failed"},{status:"queued"},{analysisId:otherAnalysis},{task:"other"}]) await assert.rejects(retrieval(db,await job(db,details),artifact),/job_invalid/);
      await db.exec("reset role"); assert.equal((await db.query("select count(*)::int as count from knowledge_retrievals")).rows[0].count,0); await role(db);
    });
    await t.test("success transition atomically captures unverified candidate once, never on running or failed job",async()=>{
      const id=await job(db); await assert.rejects(candidate(db,id),/job_invalid/);
      assert.equal((await db.query("select count(*)::int as count from hermes_research_private.learning_candidates")).rows[0].count,0);
      await db.query("update ai_jobs set status='succeeded' where id=$1",[id]);
      const row=(await db.query("select * from hermes_research_private.learning_candidates where job_id=$1",[id])).rows[0];
      assert.equal(row.owner_id,owner); assert.equal(row.analysis_id,analysis);assert.equal(row.status,"candidate");assert.deepEqual(row.output_payload,output);
      assert.equal(await candidate(db,id),id); assert.equal(await candidate(db,id),id);
      await assert.rejects(candidate(db,id,{...output,instrument:"OTHER"}),/candidate_invalid/);
      await assert.rejects(candidate(db,id,output,"different-version"),/candidate_invalid/);
      await assert.rejects(db.query("update hermes_research_private.learning_candidates set status='verified' where job_id=$1",[id]),/permission denied/);
      const failed=await job(db,{status:"failed"});await assert.rejects(candidate(db,failed),/job_invalid/);
      assert.equal((await db.query("select count(*)::int as count from hermes_research_private.learning_candidates")).rows[0].count,1);
    });
    await t.test("browser historical success and insufficient evidence never create a private learning candidate",async()=>{
      const id=await job(db); await role(db,"authenticated"); await db.query("update ai_jobs set status='succeeded' where id=$1",[id]); await role(db);
      assert.equal((await db.query("select count(*)::int as count from hermes_research_private.learning_candidates where job_id=$1",[id])).rows[0].count,0);
      const insufficient=await job(db,{status:"succeeded",value:{schema_version:"wavekb-public-analysis-v1",source_visibility:"private_research",status:"insufficient_evidence",reason:"no_relevant_knowledge",citations:[],knowledge_citations:[],analysis_basis:[]}});
      await assert.rejects(candidate(db,insufficient),/candidate_invalid/);
      assert.equal((await db.query("select count(*)::int as count from hermes_research_private.learning_candidates where job_id=$1",[insufficient])).rows[0].count,0);
    });
    await t.test("disabled private retrieval still permits normal public-book outputs as unverified learning candidates",async()=>{
      const publicOutput={...output,source_visibility:"public_books"};
      const id=await job(db,{status:"succeeded",value:publicOutput});
      const row=(await db.query("select * from hermes_research_private.learning_candidates where job_id=$1",[id])).rows[0];
      assert.equal(row.status,"candidate");assert.deepEqual(row.output_payload,publicOutput);
      assert.equal(await candidate(db,id,publicOutput),id);
    });
    await t.test("foreign owner/analysis match failure aborts success atomically; candidate cannot mutate on retry",async()=>{
      const id=await job(db,{analysisId:otherAnalysis});await assert.rejects(db.query("update ai_jobs set status='succeeded' where id=$1",[id]),/job_invalid/);
      assert.equal((await db.query("select status from ai_jobs where id=$1",[id])).rows[0].status,"running");
      const good=await job(db,{status:"succeeded"});
      await assert.rejects(db.query("update ai_jobs set output_payload=$2::jsonb where id=$1",[good,JSON.stringify({...output,instrument:"OTHER"})]),/candidate_conflict/);
      assert.deepEqual((await db.query("select output_payload from ai_jobs where id=$1",[good])).rows[0].output_payload,output);
    });
    await t.test("manual admin review is idempotent evidence only, never promotes candidates or changes active theory",async()=>{
      const id=await job(db,{status:"succeeded"}),request=randomUUID();const before=await active(db);
      const review=async(administrator=admin,outcome="supported")=>(await db.query("select hermes_research_review_candidate($1,$2,$3,$4,'人工复核证据',$5::jsonb) as value",[request,id,administrator,outcome,JSON.stringify({observation:"测试观察"})])).rows[0].value;
      await assert.rejects(review(owner),/administrator_required/);assert.equal(await review(),request);assert.equal(await review(),request);
      await assert.rejects(review(admin,"rejected"),/review_conflict/);
      assert.equal((await db.query("select status from hermes_research_private.learning_candidates where job_id=$1",[id])).rows[0].status,"candidate");
      assert.deepEqual(await active(db),before);
      await db.exec("reset role");assert.equal((await db.query("select count(*)::int as count from knowledge_retrievals")).rows[0].count,0);
      assert.equal((await db.query("select wavekb_schema_version() as value")).rows[0].value,"20261010223739");
      const policies=(await db.query("select count(*)::int as count from pg_policies where schemaname='hermes_research_private'")).rows[0].count;
      assert.equal(policies,0);
      const tables=(await db.query("select relrowsecurity,relforcerowsecurity from pg_class join pg_namespace on pg_class.relnamespace=pg_namespace.oid where nspname='hermes_research_private' and relkind='r'")).rows;
      assert.equal(tables.length,6);assert.ok(tables.every((v)=>v.relrowsecurity&&v.relforcerowsecurity));
    });
  } finally { await db.close(); }
});
