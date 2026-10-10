import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { ResearchPrivateRepository } from "../src/research/private-repository.ts";
import { privateTheoryDigest } from "../src/research/private-theory.ts";

const jobId="11111111-1111-4111-8111-111111111111",auditId="22222222-2222-4222-8222-222222222222";
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
function artifactFixture() {
  const paths=["source-pages-001-070","source-pages-071-140","source-pages-141-210","source-pages-211-280","updated-rules-and-examples","practical-courses-01-17-distilled","chanlun-trading-system","cross-market-sync","wave-chanlun-integration"];
  const labels=["book-distillation-001","book-distillation-002","book-distillation-003","book-distillation-004","rule-supplement","course-distillation","structure-context","market-context","integration-context"];
  const sources:Record<string,unknown>[]=[],chunks:Record<string,unknown>[]=[];
  paths.forEach((name,i)=>{
    const original=`原始理论 ${i}`,text=`本段为补充理论资料；不得覆盖网站第十一版原书规则。未载入的图片不构成已验证证据。\n\n补充理论 ${i}：候选需要验证，不覆盖原书。`,originalHash=hash(original),curatedHash=hash(text);
    const relativePath=`references/${name}.md`,id=`s_${hash(`${relativePath}\0${originalHash}`).slice(0,32)}`;
    const transform={schemaVersion:"hermes-theory-curation-receipt-v1",originalSha256:originalHash,curatedSha256:curatedHash,
      counts:{imagesOmitted:0,referenceLinesOmitted:0,referenceMentionsReplaced:0,titleMentionsReplaced:0,newlinesNormalized:0,noticeAdded:1}};
    sources.push({id,relativePath,sourceLabel:labels[i],authority:"supplement",original:{sha256:originalHash,bytes:Buffer.byteLength(original),version:`sha256:${originalHash}`},
      curated:{sha256:curatedHash,bytes:Buffer.byteLength(text),version:"hermes-theory-curation-v1"},receipt:{...transform,transformSha256:privateTheoryDigest(transform)}});
    chunks.push({id:`h_${hash(`${id}\0${0}\0${text}`).slice(0,32)}`,sourceId:id,index:0,text,sha256:curatedHash,authority:"supplement"});
  });
  const payload={schemaVersion:"hermes-private-theory-v2",classification:"server-private",authority:"supplement",curationVersion:"hermes-theory-curation-v1",privateSourceTerms:["私有书名"],sources,chunks};
  return {...payload,artifactSha256:privateTheoryDigest(payload)};
}
const artifact=artifactFixture(),artifactSha256=artifact.artifactSha256,chunkIds=[artifact.chunks[0]!.id as string],contextHash="b".repeat(64);
const output={schema_version:"wavekb-public-analysis-v1",source_visibility:"private_research",knowledge_version:"a".repeat(64),
  instrument:"BTCUSDT",timeframe:"1h",analysis_level:"日内",parent_trend:"不确定",current_pattern:"候选推进",current_subwave:"待验证",
  valid_scenarios:[],eliminated_scenarios:[],unknown_fields:[],citations:[],knowledge_citations:[],analysis_basis:[]};
const safeError={message:"private_research_repository_unavailable"};

test("private repository loads only validated canonical active snapshots using a service RPC",async()=>{
  const calls:unknown[]=[];
  const repository=new ResearchPrivateRepository({request:async(path,options)=>{calls.push({path,...options});return {artifact,expected_sha256:artifactSha256};}});
  assert.deepEqual(await repository.loadActiveArtifact(),{artifact,expectedSha256:artifactSha256});
  assert.deepEqual(calls,[{path:"/rest/v1/rpc/hermes_research_load_active_artifact",method:"POST",body:{}}]);
  assert.equal(await new ResearchPrivateRepository({request:async()=>null}).loadActiveArtifact(),null);
});
test("private repository rejects self-declared digests, malformed snapshots and extra provenance wrappers",async()=>{
  const corrupted=structuredClone(artifact);corrupted.chunks[0]!.text="unexpected";
  for(const result of [undefined,[],{}, {artifact,expected_sha256:"f".repeat(64)}, {artifact:corrupted,expected_sha256:artifactSha256},
    {artifact,expected_sha256:artifactSha256,private_path:"not-for-output"}, {artifact:{...artifact,privateSourceTerms:["bad",null]},expected_sha256:artifactSha256}]) {
    await assert.rejects(new ResearchPrivateRepository({request:async()=>result}).loadActiveArtifact(),safeError);
  }
});
test("retrieval serializes bounded opaque IDs only, never accepts a caller owner or private metadata",async()=>{
  const calls:unknown[]=[];
  const repository=new ResearchPrivateRepository({request:async(path,options)=>{calls.push({path,...options});return auditId;}});
  await repository.recordRetrieval({jobId,artifactSha256,chunkIds,contextHash});
  assert.deepEqual(calls,[{path:"/rest/v1/rpc/hermes_research_record_retrieval",method:"POST",body:{p_job_id:jobId,p_artifact_sha256:artifactSha256,p_chunk_ids:chunkIds,p_context_hash:contextHash}}]);
  await repository.recordRetrieval({jobId,artifactSha256,chunkIds:[],contextHash});
  const before=calls.length;
  for(const value of [
    {jobId,artifactSha256,chunkIds,contextHash,ownerId:jobId}, {jobId:"invalid",artifactSha256,chunkIds,contextHash},
    {jobId,artifactSha256,chunkIds:[...chunkIds,...chunkIds],contextHash}, {jobId,artifactSha256,chunkIds:Array(9).fill(chunkIds[0]),contextHash},
    {jobId,artifactSha256,chunkIds:["references/private-source"],contextHash}, {jobId,artifactSha256,chunkIds,contextHash:"not-a-digest"},
  ]) await assert.rejects(repository.recordRetrieval(value as any),safeError);
  assert.equal(calls.length,before);
});
test("candidate compensation forwards exact public output and job identity, never a verified status or owner",async()=>{
  const calls:unknown[]=[];
  const repository=new ResearchPrivateRepository({request:async(path,options)=>{calls.push({path,...options});return jobId;}});
  await repository.recordCandidate({jobId,output,knowledgeVersion:output.knowledge_version});
  assert.deepEqual(calls,[{path:"/rest/v1/rpc/hermes_research_record_candidate",method:"POST",body:{p_job_id:jobId,p_output:output,p_knowledge_version:output.knowledge_version}}]);
  for(const value of [
    {jobId,output,knowledgeVersion:output.knowledge_version,status:"verified"},
    {jobId,output:{...output,source_path:"private-source"},knowledgeVersion:output.knowledge_version},
    {jobId,output:{...output,instrument:"file:///Users/private"},knowledgeVersion:output.knowledge_version},
    {jobId,output:{schema_version:"wavekb-public-analysis-v1",source_visibility:"private_research",status:"insufficient_evidence",reason:"no_relevant_knowledge",citations:[],knowledge_citations:[],analysis_basis:[]},knowledgeVersion:output.knowledge_version},
  ]) await assert.rejects(repository.recordCandidate(value as any),safeError);
  assert.equal(calls.length,1);
});
test("all repository failures and malformed receipts surface a fixed error without private diagnostics",async()=>{
  for(const request of [async()=>{throw new Error("/Users/private-name artifact secret");},async()=>null,async()=>({id:auditId,source:"private-name"})]) {
    const repository=new ResearchPrivateRepository({request});
    await assert.rejects(repository.recordRetrieval({jobId,artifactSha256,chunkIds,contextHash}),safeError);
    await assert.rejects(repository.recordCandidate({jobId,output,knowledgeVersion:output.knowledge_version}),safeError);
  }
  await assert.rejects(new ResearchPrivateRepository({request:async()=>{throw new Error("private DB diagnostics");}}).loadActiveArtifact(),safeError);
});
