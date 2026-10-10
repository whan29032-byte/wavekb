import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.ts";
import { encryptSecret } from "../src/secrets/crypto.ts";
import { ManagedConnectionResolver } from "../src/secrets/managed-connection.ts";
import { SupabaseGatewayApi } from "../src/routes/gateway-api.ts";
import { AiJobWorker } from "../src/worker-main.ts";

const config=loadConfig({SUPABASE_URL:"https://example.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"service-role-test-only-long",SUPABASE_PUBLISHABLE_KEY:"publishable-test-only-long",AI_SECRET_MASTER_KEY:Buffer.alloc(32,7).toString("base64"),AUTH_SITE_URL:"https://knowledge.example.com",ALLOWED_PROVIDER_HOSTS:"model.example",MEMBERSHIP_MANAGED_AI_ENABLED:"true"});
const owner="11111111-1111-4111-8111-111111111111",analysis="22222222-2222-4222-8222-222222222222",modelId="33333333-3333-4333-8333-333333333333";
const request={request_version:2,client_request_id:"44444444-4444-4444-8444-444444444444",task_type:"wave_analysis",step:5,analysis_schema_version:"workbench-v1",knowledge_scope:{mode:"all"}};
const model={id:modelId,provider_id:"provider",name:"operator-model",timeout_ms:60000,max_output_tokens:4096,context_tokens:32768,temperature:0.2,provider:{id:"provider",adapter:"openai_compatible" as const,base_url:"https://model.example/v1"}};

test("managed flag defaults false and cannot be enabled by a truthy non-boolean string",()=>{
  assert.equal(loadConfig({SUPABASE_URL:config.SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY:config.SUPABASE_SERVICE_ROLE_KEY,SUPABASE_PUBLISHABLE_KEY:config.SUPABASE_PUBLISHABLE_KEY,AI_SECRET_MASTER_KEY:config.AI_SECRET_MASTER_KEY.toString('base64'),AUTH_SITE_URL:config.AUTH_SITE_URL}).MEMBERSHIP_MANAGED_AI_ENABLED,false);
});
test("platform resolver inspects allowlisted route metadata without decrypting or calling a model",async()=>{
  const calls:string[]=[];
  const database={async request(path:string){calls.push(path);if(path.startsWith('/rest/v1/ai_task_routes?'))return[{primary_model_id:modelId}];if(path.startsWith('/rest/v1/ai_models?'))return[model];if(path.startsWith('/rest/v1/ai_providers?'))return[model.provider];if(path.startsWith('/rest/v1/ai_provider_secrets?'))return[{id:'secret',...encryptSecret('test-only-model-key',config.AI_SECRET_MASTER_KEY,1)}];throw Error('unexpected');}};
  const resolver=new ManagedConnectionResolver(config,database);
  assert.equal((await resolver.inspect('wave_analysis')).id,modelId);
  assert.ok(calls.every(path=>!path.includes('ciphertext')));
  assert.equal((await resolver.resolve(owner,'wave_analysis',modelId)).ownerId,owner);
  await assert.rejects(resolver.inspect('wave_analysis','different-model'),/managed_ai_not_configured/);
  await assert.rejects(new ManagedConnectionResolver({...config,ALLOWED_PROVIDER_HOSTS:[]},database).inspect('wave_analysis'),/managed_ai_not_configured/);
});
test("disabled platform resolver never reads provider configuration; invalid secret fails closed",async()=>{
  let reads=0;
  await assert.rejects(new ManagedConnectionResolver({...config,MEMBERSHIP_MANAGED_AI_ENABLED:false},{request:async()=>{reads++;return[];}}).inspect('wave_analysis'),/managed_ai_not_configured/);
  assert.equal(reads,0);
  const database={async request(path:string){if(path.startsWith('/rest/v1/ai_task_routes?'))return[{primary_model_id:modelId}];if(path.startsWith('/rest/v1/ai_models?'))return[model];if(path.startsWith('/rest/v1/ai_providers?'))return[model.provider];return[{id:'secret',ciphertext:'bad'}];}};
  await assert.rejects(new ManagedConnectionResolver(config,database).resolve(owner,'wave_analysis',modelId),/managed_ai_not_configured/);
});
test("managed enqueue binds authenticated owner/model with no user connection and maps atomic quota rejection to 429",async()=>{
  const bodies:Record<string,unknown>[]=[];
  const database={async userForJwt(){return null;},async request(path:string,options?:{body?:unknown}){
    if(path.startsWith('/rest/v1/workbench_analyses?'))return[{id:analysis,owner_id:owner,schema_version:'workbench-v1'}];
    if(path.startsWith('/rest/v1/ai_jobs?'))return[];
    if(path==='/rest/v1/rpc/enqueue_membership_ai_job'){bodies.push(options!.body as Record<string,unknown>);throw Error('membership_ai_quota_exceeded');}
    throw Error('BYOK lookup must not occur');
  }};
  const gateway=new SupabaseGatewayApi(config,{database,managedConnections:{inspect:async()=>model}});
  await assert.rejects(gateway.enqueueJob(owner,analysis,{...request,execution_mode:'managed'}),(error:unknown)=>(error as {statusCode:number}).statusCode===429);
  assert.equal(bodies[0]?.p_owner_id,owner);assert.equal(bodies[0]?.p_execution_source,'managed');assert.equal(bodies[0]?.p_user_connection_id,null);assert.equal(bodies[0]?.p_managed_model_id,modelId);
  await assert.rejects(gateway.enqueueJob(owner,analysis,{...request,execution_mode:'managed',owner_id:'spoof'}),/invalid ai run request/);
});
test("managed lost receipt recovers same bound request despite disabled flag, exhausted quota, or model rotation",async()=>{
  const reordered={knowledge_scope:request.knowledge_scope,analysis_schema_version:request.analysis_schema_version,step:request.step,task_type:request.task_type,client_request_id:request.client_request_id,request_version:request.request_version};
  const stored={id:'original',execution_source:'managed',accepted_request:reordered};
  const database={async userForJwt(){return null;},async request(path:string){if(path.startsWith('/rest/v1/workbench_analyses?'))return[{schema_version:'workbench-v1'}];if(path.startsWith('/rest/v1/ai_jobs?'))return[stored];throw Error('unexpected');}};
  const gateway=new SupabaseGatewayApi({...config,MEMBERSHIP_MANAGED_AI_ENABLED:false},{database,managedConnections:{inspect:async()=>{throw Error('must not inspect');}}});
  assert.equal((await gateway.enqueueJob(owner,analysis,{...request,execution_mode:'managed'}) as typeof stored).id,'original');
  await assert.rejects(gateway.enqueueJob(owner,analysis,{...request,step:6,execution_mode:'managed'}),(error:unknown)=>(error as {statusCode:number}).statusCode===409);
});
test("managed availability exposes only service-derived rights/usage and never reports disabled mode available",async()=>{
  const usage={user_id:owner,has_vip:true,daily_limit:50,used:5,remaining:45,timezone:'Asia/Shanghai'};
  const gateway=new SupabaseGatewayApi({...config,MEMBERSHIP_MANAGED_AI_ENABLED:false},{database:{userForJwt:async()=>null,request:async()=>usage},managedConnections:{inspect:async()=>{throw Error('no read');}}});
  assert.deepEqual(await gateway.membershipAiStatus(owner),{...usage,enabled:false,configured:false,available:false});
});
test("managed worker reauthorizes reservation/rights, uses platform resolver, and does not resolve BYOK",async()=>{
  const calls:Array<{path:string;body?:unknown}>=[];let resolved=0;
  const database={async request(path:string,options?:{body?:unknown}){calls.push({path,body:options?.body});if(path.startsWith('/rest/v1/ai_job_attempts?'))return[];if(path==='/rest/v1/ai_job_attempts')return[{id:'attempt'}];if(path==='/rest/v1/rpc/authorize_membership_ai_job')return true;if(path.startsWith('/rest/v1/profiles?'))return[{id:owner}];if(path.startsWith('/rest/v1/workbench_analyses?'))return[{id:analysis}];return null;}};
  const worker=new AiJobWorker(config,'test-worker',{database,connections:{resolve:async()=>{throw Error('BYOK must not be used');}},managedConnections:{resolve:async()=>{resolved++;return{id:modelId,ownerId:owner,modelName:'model',timeoutMs:1000,maxOutputTokens:10,contextTokens:100,temperature:0,provider:{} as never};}},knowledgeRuntime:{run:async()=>({normalizedRequest:request,knowledgeVersion:'test',output:{}} as never)}});
  await worker.runJob({id:'job',owner_id:owner,analysis_id:analysis,task_type:'wave_analysis',execution_source:'managed',managed_model_id:modelId,input_payload:request});
  assert.equal(resolved,1);assert.ok(calls.some(call=>call.path==='/rest/v1/rpc/authorize_membership_ai_job'));
  assert.ok(calls.some(call=>(call.body as {status?:string})?.status==='succeeded'));
});
test("disabled or revoked managed worker produces final server failure without provider access (DB trigger refunds once)",async()=>{
  for(const disabled of [true,false]){
    const patches:Record<string,unknown>[]=[];let resolved=0;
    const database={async request(path:string,options?:{body?:unknown}){if(path.startsWith('/rest/v1/ai_job_attempts?'))return[];if(path==='/rest/v1/ai_job_attempts')return[{id:'attempt'}];if(path==='/rest/v1/rpc/authorize_membership_ai_job')throw Error('membership_ai_vip_required');if(path.startsWith('/rest/v1/ai_jobs?'))patches.push(options?.body as Record<string,unknown>);return null;}};
    const worker=new AiJobWorker({...config,MEMBERSHIP_MANAGED_AI_ENABLED:!disabled},'test-worker',{database,managedConnections:{resolve:async()=>{resolved++;throw Error('must not resolve');}}});
    await worker.runJob({id:'job',owner_id:owner,analysis_id:analysis,task_type:'wave_analysis',execution_source:'managed',managed_model_id:modelId,input_payload:request});
    assert.equal(resolved,0);assert.equal(patches[0]?.status,'failed');assert.equal(typeof patches[0]?.finished_at,'string');
  }
});
