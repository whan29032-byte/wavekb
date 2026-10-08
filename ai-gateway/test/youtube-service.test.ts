import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { loadYouTubeSyncConfig } from "../src/youtube/config.ts";
import { YouTubeError, type YouTubeConnectionView, type YouTubeProvider, type YouTubeSecret } from "../src/youtube/contracts.ts";
import { encryptYouTubeSecret, decryptYouTubeSecret } from "../src/youtube/crypto.ts";
import { YouTubeRepository, YouTubeRestDatabase, type YouTubeServiceRepository } from "../src/youtube/repository.ts";
import { YouTubeService } from "../src/youtube/service.ts";

const owner="11111111-1111-4111-8111-111111111111", other="22222222-2222-4222-8222-222222222222";
const channel=`UC${"a".repeat(22)}`, key=Buffer.alloc(32,27);
const env={YOUTUBE_SYNC_ENABLED:"true",YOUTUBE_OAUTH_CLIENT_ID:"test.apps.googleusercontent.com",YOUTUBE_OAUTH_CLIENT_SECRET:"synthetic-client-secret",YOUTUBE_OAUTH_REDIRECT_URI:"https://wavekb.com/api/youtube/callback",YOUTUBE_TOKEN_MASTER_KEY:key.toString("base64"),SUPABASE_URL:"https://database.example.test",SUPABASE_SERVICE_ROLE_KEY:"synthetic-service-role"};
const config=loadYouTubeSyncConfig(env);
const view:YouTubeConnectionView={id:"33333333-3333-4333-8333-333333333333",channelId:channel,channelTitle:"Verified channel",syncEnabled:true,importHistory:true,historyStatus:"pending",historyImported:0,status:"connected",lastSyncedAt:null,lastErrorCode:null};

function fixture(options:{config?:typeof config;provider?:Partial<YouTubeProvider>;repository?:Partial<YouTubeServiceRepository>}={}){
  const calls:{name:string;owner?:string;value?:unknown}[]=[];
  let stateHash="",verifierSecret:YouTubeSecret|null=null,consumed=false,codeChallenge="";
  const repository:YouTubeServiceRepository={
    async getConnection(actor){calls.push({name:"get",owner:actor});return view;},
    async beginOAuth(actor,hash,secret,choices){calls.push({name:"begin",owner:actor,value:choices});stateHash=hash;verifierSecret=secret;return "state-id";},
    async consumeOAuth(actor,hash){calls.push({name:"consume",owner:actor});if(actor!==owner||hash!==stateHash||consumed||!verifierSecret)throw new YouTubeError("youtube_state_invalid",409);consumed=true;return{id:"state-id",verifierSecret};},
    async completeOAuth(actor,state,owned,secret){calls.push({name:"complete",owner:actor,value:{state,owned,secret}});return view;},
    async settings(actor,enabled,history){calls.push({name:"settings",owner:actor,value:{enabled,history}});return{...view,syncEnabled:enabled};},
    async disconnect(actor,confirm){calls.push({name:"disconnect",owner:actor,value:confirm});return{disconnected:true,removedPosts:1,remoteRevocationPending:true,revocationId:"private-job-id"};},
    ...options.repository,
  };
  const provider:YouTubeProvider={
    authorizationUrl(input){codeChallenge=input.codeChallenge;const url=new URL("https://accounts.google.com/o/oauth2/v2/auth");url.search=new URLSearchParams({state:input.state,code_challenge:input.codeChallenge}).toString();return url.href;},
    async exchangeCode(input){calls.push({name:"exchange",value:input});assert.equal(createHash("sha256").update(input.codeVerifier).digest("base64url"),codeChallenge);return{accessToken:"synthetic-access-token",refreshToken:"synthetic-refresh-token",expiresIn:3600,scope:"https://www.googleapis.com/auth/youtube.readonly"};},
    async refreshToken(){throw new Error("unexpected refresh");},async revokeToken(){calls.push({name:"revoke"});},
    async ownedChannels(){calls.push({name:"channels"});return[{id:channel,title:"Verified channel",uploadsPlaylistId:"UUaaaaaaaaaaaaaaaaaaaaaa"}];},
    async listUploads(){throw new Error("unexpected uploads");},async publicVideos(){throw new Error("unexpected videos");},
    ...options.provider,
  };
  const service=new YouTubeService(options.config??config,{provider,repository});
  return{service,calls,repository,storedVerifier:()=>verifierSecret,challenge:()=>codeChallenge};
}

test("YouTube encryption uses random GCM IV and authenticated owner/channel separation",()=>{
  const one=encryptYouTubeSecret("test-refresh-token",key,owner,channel),two=encryptYouTubeSecret("test-refresh-token",key,owner,channel);
  assert.notEqual(one.iv,two.iv);assert.ok(!JSON.stringify(one).includes("test-refresh-token"));
  assert.equal(decryptYouTubeSecret(one,key,owner,channel),"test-refresh-token");
  assert.throws(()=>decryptYouTubeSecret(one,key,other,channel));
  assert.throws(()=>decryptYouTubeSecret(one,key,owner,`UC${"b".repeat(22)}`));
  assert.throws(()=>decryptYouTubeSecret(one,Buffer.alloc(32,28),owner,channel));
  assert.throws(()=>decryptYouTubeSecret({...one,auth_tag:Buffer.alloc(16).toString("base64")},key,owner,channel));
});

test("default disabled/unconfigured integration never starts authorization or hides existing binding cleanup",async()=>{
  const f=fixture({config:loadYouTubeSyncConfig({...env,YOUTUBE_SYNC_ENABLED:"false"})});
  assert.deepEqual(await f.service.getConnection(owner),{configured:false,connection:view});
  await assert.rejects(f.service.authorize(owner,{importHistory:true,autoSync:true}),/youtube_not_configured/);
  const result=await f.service.disconnect(owner,{confirmRemoveSyncedPosts:true});
  assert.deepEqual(result,{disconnected:true,removedPosts:1,remoteRevocationPending:true});
  assert.ok(!JSON.stringify(result).includes("private-job-id"));assert.ok(!f.calls.some(call=>call.name==="revoke"));
  const empty=fixture({config:loadYouTubeSyncConfig({})});
  assert.deepEqual(await empty.service.getConnection(owner),{configured:false,connection:null});assert.equal(empty.calls.length,0);
});

test("authorize persists owner-bound state hash and encrypted PKCE with explicit import choices",async()=>{
  const f=fixture();const result=await f.service.authorize(owner,{importHistory:true,autoSync:false});
  assert.match(result.state,/^[A-Za-z0-9_-]{43}$/);
  const verifier=decryptYouTubeSecret(f.storedVerifier()!,key,owner,"oauth-state");
  assert.equal(createHash("sha256").update(verifier).digest("base64url"),f.challenge());
  assert.equal(f.calls[0]?.owner,owner);assert.deepEqual(f.calls[0]?.value,{importHistory:true,autoSync:false});
  assert.ok(!JSON.stringify(f.calls).includes(verifier));
});

test("callback consumes state before exchange, uses fixed redirect, persists only encrypted refresh token",async()=>{
  const f=fixture();const start=await f.service.authorize(owner,{importHistory:true,autoSync:true});
  assert.deepEqual(await f.service.callback(owner,{state:start.state,code:"synthetic-code"}),{connection:view});
  assert.deepEqual(f.calls.map(call=>call.name),["begin","consume","exchange","channels","complete"]);
  const exchange=f.calls.find(call=>call.name==="exchange")!.value as {redirectUri:string};assert.equal(exchange.redirectUri,config.redirectUri);
  const completed=f.calls.find(call=>call.name==="complete")!.value as {secret:YouTubeSecret};
  assert.equal(decryptYouTubeSecret(completed.secret,key,owner,channel),"synthetic-refresh-token");
  assert.ok(!JSON.stringify(completed).includes("synthetic-refresh-token"));
  await assert.rejects(f.service.callback(owner,{state:start.state,code:"synthetic-code"}),/youtube_state_invalid/);
  assert.equal(f.calls.filter(call=>call.name==="exchange").length,1);
});

test("wrong owner, malformed state, invalid user and implicit boolean choices never persist a binding",async()=>{
  const f=fixture();const start=await f.service.authorize(owner,{importHistory:false,autoSync:false});
  await assert.rejects(f.service.callback(other,{state:start.state,code:"synthetic-code"}),/youtube_state_invalid/);
  await assert.rejects(f.service.callback(owner,{state:"bad",code:"synthetic-code"}),/youtube_state_invalid/);
  await assert.rejects(f.service.getConnection("not-a-uuid"),/authentication_required/);
  await assert.rejects(f.service.authorize(owner,{importHistory:undefined as unknown as boolean,autoSync:true}),/youtube_options_invalid/);
  assert.ok(!f.calls.some(call=>call.name==="exchange"||call.name==="complete"));
});

test("missing readonly scope, refresh token or channel ownership cannot create connection",async()=>{
  for(const [override,code] of [
    [{exchangeCode:async()=>({accessToken:"synthetic",expiresIn:3600,scope:"openid",refreshToken:"synthetic"})},"youtube_scope_missing"],
    [{exchangeCode:async()=>({accessToken:"synthetic",expiresIn:3600,scope:"https://www.googleapis.com/auth/youtube.readonly"})},"youtube_refresh_token_missing"],
    [{ownedChannels:async()=>[]},"youtube_channel_missing"],
    [{ownedChannels:async()=>[{id:channel,title:"a",uploadsPlaylistId:"UUaaaaaaaaaaaaaaaaaaaaaa"},{id:`UC${"b".repeat(22)}`,title:"b",uploadsPlaylistId:"UUbbbbbbbbbbbbbbbbbbbbbb"}]},"youtube_channel_selection_required"],
  ] as [Partial<YouTubeProvider>,string][]){
    const f=fixture({provider:override});const start=await f.service.authorize(owner,{importHistory:true,autoSync:true});
    await assert.rejects(f.service.callback(owner,{state:start.state,code:"synthetic-code"}),new RegExp(code));
    assert.ok(!f.calls.some(call=>call.name==="complete"));
  }
});

test("history restart preserves current sync choice and disconnect requires explicit deletion consent",async()=>{
  const f=fixture();await f.service.importHistory(owner);
  assert.deepEqual(f.calls.find(call=>call.name==="settings")?.value,{enabled:true,history:true});
  await assert.rejects(f.service.disconnect(owner,{confirmRemoveSyncedPosts:false as unknown as true}),/youtube_disconnect_confirmation_required/);
  assert.ok(!f.calls.some(call=>call.name==="disconnect"));
});

test("repository uses fixed service-only RPC arguments and strips unsafe error text",async()=>{
  const calls:{path:string;body:unknown}[]=[];
  const repo=new YouTubeRepository(config,{async request(path,options){calls.push({path,body:options?.body});return view;}});
  await repo.getConnection(owner);await repo.settings(owner,false,true);
  assert.deepEqual(calls,[{path:"/rest/v1/rpc/youtube_get_connection",body:{p_owner_id:owner}},{path:"/rest/v1/rpc/youtube_settings",body:{p_owner_id:owner,p_sync_enabled:false,p_restart_history:true}}]);
  const database=new YouTubeRestDatabase(config,async()=>new Response(JSON.stringify({message:"duplicate key secret-test-refresh-token at https://sensitive.test/"}),{status:500}));
  await assert.rejects(database.request("/rest/v1/rpc/youtube_get_connection",{method:"POST",body:{p_owner_id:owner}}),error=>error instanceof YouTubeError&&error.code==="youtube_unavailable"&&!error.message.includes("secret-test"));
  const denied=new YouTubeRestDatabase(config,async()=>new Response(JSON.stringify({message:"youtube_account_ineligible"}),{status:400}));
  await assert.rejects(denied.request("/rest/v1/rpc/youtube_settings"),error=>error instanceof YouTubeError&&error.status===403);
});
