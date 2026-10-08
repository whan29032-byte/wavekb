import assert from "node:assert/strict";
import test from "node:test";
import { youtubeIds as ids, youtubeVideo as video, youtubeSecret as secret, beginYouTubeOAuth, createYouTubeDatabase, connectYouTube, claimYouTube, commitYouTube } from "./helpers/youtube-sync-database.mjs";

async function fixture(run) { const db = await createYouTubeDatabase(); try { await run(db); } finally { await db.close(); } }
async function count(db, table) { return (await db.query(`select count(*)::int as n from ${table}`)).rows[0].n; }

test("OAuth state is owner-bound, ten-minute expiring, consumed exactly once",()=>fixture(async db=>{
  const state=await beginYouTubeOAuth(db);
  await assert.rejects(db.query("select youtube_consume_oauth($1,$2)",[ids.other,"a".repeat(64)]),/youtube_state_invalid/);
  await db.query("select youtube_consume_oauth($1,$2)",[ids.owner,"a".repeat(64)]);
  await assert.rejects(db.query("select youtube_consume_oauth($1,$2)",[ids.owner,"a".repeat(64)]),/youtube_state_invalid/);
  await beginYouTubeOAuth(db,ids.owner,"c".repeat(64));
  await db.exec("update youtube_oauth_states set expires_at=now()-interval '1 second'");
  await assert.rejects(db.query("select youtube_consume_oauth($1,$2)",[ids.owner,"c".repeat(64)]),/youtube_state_invalid/);
  assert.ok(state);
}));

test("completed binding enforces one user one channel and refuses channel takeover",()=>fixture(async db=>{
  const connection=await connectYouTube(db);
  assert.equal(connection.channelId,ids.channel);
  await assert.rejects(connectYouTube(db,ids.other,ids.channel),/youtube_channel_already_bound/);
  await assert.rejects(connectYouTube(db,ids.owner,ids.otherChannel),/youtube_already_connected/);
  assert.equal(await count(db,"youtube_connections"),1);
  const state=(await db.query("select id from youtube_oauth_states where owner_id=$1",[ids.owner])).rows[0].id;
  await db.query("select youtube_complete_oauth($1,$2,$3,'频道','UUaaaaaaaaaaaaaaaaaaaaaa',$4::jsonb)",[ids.owner,state,ids.channel,JSON.stringify(secret)]);
  await assert.rejects(db.query("select youtube_complete_oauth($1,$2,$3,'频道','UUaaaaaaaaaaaaaaaaaaaaaa',$4::jsonb)",[ids.owner,state,ids.channel,JSON.stringify(secret)]),/youtube_state_invalid/);
}));

test("atomic importer preserves owner identity, publication/media order and retry idempotence",()=>fixture(async db=>{
  const connection=await connectYouTube(db); const claim=await claimYouTube(db);
  assert.equal(claim.id,connection.id);
  assert.deepEqual(await commitYouTube(db,connection.id,[video],{nextCursor:"page2",historyComplete:false}),{imported:1});
  assert.equal(await count(db,"posts"),1); assert.equal(await count(db,"post_external_references"),1);
  const post=(await db.query("select * from posts")).rows[0];
  assert.equal(post.author_id,ids.owner); assert.equal(post.board,"idea_sharing"); assert.equal(post.status,"published");
  assert.equal((await db.query("select owner_id from post_external_references")).rows[0].owner_id,ids.owner);
  await assert.rejects(commitYouTube(db,connection.id,[video]),/youtube_cursor_conflict/);
  assert.deepEqual(await commitYouTube(db,connection.id,[video],{expectedCursor:"page2",nextCursor:null}),{imported:0});
  assert.equal(await count(db,"posts"),1);
  const view=(await db.query("select youtube_get_connection($1) as v",[ids.owner])).rows[0].v;
  assert.equal(view.historyStatus,"complete"); assert.equal(view.historyImported,1); assert.ok(!JSON.stringify(view).includes("ciphertext"));
}));

test("failed reference write rolls back posts, source ledger and cursor together",()=>fixture(async db=>{
  const c=await connectYouTube(db); await claimYouTube(db);
  await db.exec("create function reject_test_ref() returns trigger language plpgsql as $$ begin raise exception 'test_media_failed'; end $$; create trigger reject_test_ref before insert on post_external_references for each row execute function reject_test_ref();");
  await assert.rejects(commitYouTube(db,c.id,[video],{nextCursor:"page2",historyComplete:false}),/test_media_failed/);
  assert.equal(await count(db,"posts"),0); assert.equal(await count(db,"youtube_post_sources"),0);
  assert.equal((await db.query("select history_cursor from youtube_connections")).rows[0].history_cursor,null);
}));

test("private/unlisted/foreign-channel videos never become posts",()=>fixture(async db=>{
  const c=await connectYouTube(db); await claimYouTube(db);
  assert.deepEqual(await commitYouTube(db,c.id,[{...video,privacyStatus:"private"},{...video,id:"lmnopqrstuv",privacyStatus:"unlisted"}],{nextCursor:"page2",historyComplete:false}),{imported:0});
  await assert.rejects(commitYouTube(db,c.id,[{...video,channelId:ids.otherChannel}],{expectedCursor:"page2"}),/youtube_channel_mismatch/);
  assert.equal(await count(db,"posts"),0);
}));

test("muted, banned, unverified and UID-unactivated owners cannot bind or publish with service credentials",()=>fixture(async db=>{
  const c=await connectYouTube(db); await claimYouTube(db);
  for(const restriction of ["muted_until=now()+interval '1 day'","account_status='banned'","public_uid=null"]){
    await db.exec(`update profiles set ${restriction} where id='${ids.owner}'`);
    await assert.rejects(commitYouTube(db,c.id),/youtube_account_ineligible/);
    await assert.rejects(beginYouTubeOAuth(db),/youtube_account_ineligible/);
    await db.exec(`update profiles set muted_until=null,account_status='active',public_uid=11111 where id='${ids.owner}'`);
  }
  await db.exec(`update auth.users set email_confirmed_at=null where id='${ids.owner}'`);
  await assert.rejects(commitYouTube(db,c.id),/youtube_account_ineligible/);
  assert.equal(await count(db,"posts"),0);
}));

test("deleted posts retain only deletion-intent digest and cannot be resurrected by poll or historical retry",()=>fixture(async db=>{
  const c=await connectYouTube(db); await claimYouTube(db); await commitYouTube(db,c.id);
  await db.exec("delete from posts");
  const source=(await db.query("select * from youtube_post_sources")).rows[0];
  assert.equal(source.source_state,"user_deleted"); assert.equal(source.post_id,null); assert.equal(source.video_id,null); assert.equal(source.generated_body,null); assert.equal(source.source_key.length,64);
  assert.deepEqual(await commitYouTube(db,c.id,[video],{mode:"poll"}),{imported:0});
  assert.equal(await count(db,"posts"),0);
}));

test("poll cursor has independent durable progress and stale cursor cannot overwrite it",()=>fixture(async db=>{
  const c=await connectYouTube(db); await claimYouTube(db);
  await commitYouTube(db,c.id,[],{mode:"poll",nextCursor:"live-page2"});
  await commitYouTube(db,c.id,[video],{nextCursor:"history-page2",historyComplete:false});
  const row=(await db.query("select history_cursor,poll_cursor from youtube_connections")).rows[0];
  assert.deepEqual(row,{history_cursor:"history-page2",poll_cursor:"live-page2"});
  await assert.rejects(commitYouTube(db,c.id,[],{mode:"poll"}),/youtube_cursor_conflict/);
}));

test("lease exclusivity, expiry and stopped sync prevent stale worker publication",()=>fixture(async db=>{
  const c=await connectYouTube(db); await claimYouTube(db);
  assert.equal(await claimYouTube(db,"another-worker"),null);
  await assert.rejects(commitYouTube(db,c.id,[video],{worker:"another-worker"}),/youtube_lease_lost/);
  await db.query("select youtube_settings($1,false,false)",[ids.owner]);
  await assert.rejects(commitYouTube(db,c.id,[video],{mode:"poll"}),/youtube_sync_disabled/);
  await db.exec("update youtube_connections set lease_until=now()-interval '1 second'");
  await assert.rejects(commitYouTube(db,c.id),/youtube_lease_lost/);
}));

test("source disappearance removes only generated post and never resurrects moderated posts",()=>fixture(async db=>{
  const c=await connectYouTube(db); await claimYouTube(db); await commitYouTube(db,c.id);
  await db.exec("update posts set status='hidden'");
  await db.query("select youtube_refresh_videos($1,$2,$3::jsonb,$4::jsonb)",[c.id,ids.worker,JSON.stringify([video]),JSON.stringify([video.id])]);
  assert.equal((await db.query("select status from posts")).rows[0].status,"hidden");
  await db.query("select youtube_refresh_videos($1,$2,'[]'::jsonb,$3::jsonb)",[c.id,ids.worker,JSON.stringify([video.id])]);
  assert.equal(await count(db,"posts"),0);
  assert.equal((await db.query("select source_state from youtube_post_sources")).rows[0].source_state,"source_removed");
}));

test("disconnect needs explicit confirmation, deletes sync posts and secrets, preserves ordinary posts",()=>fixture(async db=>{
  const c=await connectYouTube(db); await claimYouTube(db); await commitYouTube(db,c.id);
  await db.query("insert into posts(board,title,body,author_id,status) values('idea_sharing','手工帖子保留','这是用户手工写的内容，应始终保留，不与同步删除关联。',$1,'published')",[ids.owner]);
  await assert.rejects(db.query("select youtube_disconnect($1,false)",[ids.owner]),/youtube_disconnect_confirmation_required/);
  assert.deepEqual((await db.query("select youtube_disconnect($1,true) as result",[ids.other])).rows[0].result,{disconnected:true,removedPosts:0});
  const disconnect=(await db.query("select youtube_disconnect($1,true) as result",[ids.owner])).rows[0].result;
  assert.equal(disconnect.disconnected,true); assert.equal(disconnect.removedPosts,1); assert.equal(disconnect.remoteRevocationPending,true);
  assert.equal(await count(db,"posts"),1); assert.equal(await count(db,"youtube_connection_secrets"),0);
  assert.equal(await count(db,"youtube_revocation_jobs"),1);
  await assert.rejects(connectYouTube(db),/youtube_revocation_pending/);
  await db.query("select youtube_complete_revocation($1,null)",[disconnect.revocationId]);
  assert.equal((await db.query("select youtube_get_connection($1) as v",[ids.owner])).rows[0].v,null);
  await connectYouTube(db,ids.owner,ids.channel,false); await claimYouTube(db); await commitYouTube(db,c.id,[video],{mode:"poll"});
  assert.equal(await count(db,"posts"),1);
}));

test("fresh history consent reimports authorization-removed videos only and resets the history run",()=>fixture(async db=>{
  const deleted={...video,id:"lmnopqrstuv"},removed={...video,id:"wxyzABCDEFG"};
  const c=await connectYouTube(db); await claimYouTube(db);
  await commitYouTube(db,c.id,[video,deleted,removed],{nextCursor:"old-history-page",historyComplete:false});
  await db.query("delete from posts where id=(select post_id from youtube_post_sources where video_id=$1)",[deleted.id]);
  await db.query("select youtube_refresh_videos($1,$2,'[]'::jsonb,$3::jsonb)",[c.id,ids.worker,JSON.stringify([removed.id])]);
  const manual=(await db.query("insert into posts(board,title,body,author_id,status) values('idea_sharing','手工帖子保留','这是用户手工写的内容，不得在解绑或重新导入历史时修改。',$1,'published') returning id",[ids.owner])).rows[0].id;
  const disconnect=(await db.query("select youtube_disconnect($1,true) as receipt",[ids.owner])).rows[0].receipt;
  await db.query("select youtube_complete_revocation($1,null)",[disconnect.revocationId]);
  await connectYouTube(db,ids.owner,ids.channel,false);
  assert.deepEqual((await db.query("select source_state from youtube_post_sources order by source_state")).rows.map(row=>row.source_state),["authorization_removed","source_removed","user_deleted"]);
  const rebind=await connectYouTube(db,ids.owner,ids.channel,true);
  assert.equal(rebind.historyImported,0); assert.equal(rebind.historyStatus,"pending");
  assert.equal((await db.query("select history_cursor from youtube_connections")).rows[0].history_cursor,null);
  assert.deepEqual((await db.query("select source_state from youtube_post_sources order by source_state")).rows.map(row=>row.source_state),["source_removed","user_deleted"]);
  await claimYouTube(db);
  assert.deepEqual(await commitYouTube(db,c.id,[video,deleted,removed],{nextCursor:"fresh-page2",historyComplete:false}),{imported:1});
  assert.deepEqual(await commitYouTube(db,c.id,[video,deleted,removed],{expectedCursor:"fresh-page2"}),{imported:0});
  assert.equal(await count(db,"posts"),2);
  assert.equal((await db.query("select title from posts where id=$1",[manual])).rows[0].title,"手工帖子保留");
  assert.equal((await db.query("select youtube_get_connection($1) as view",[ids.owner])).rows[0].view.historyImported,1);
}));

test("confirmed revocation purges immediately but transient network release retains posts and authorization",()=>fixture(async db=>{
  const c=await connectYouTube(db); await claimYouTube(db); await commitYouTube(db,c.id);
  await db.query("select youtube_release_sync($1,$2,'provider_unavailable',now())",[c.id,ids.worker]);
  assert.equal(await count(db,"posts"),1); assert.equal(await count(db,"youtube_connection_secrets"),1);
  await claimYouTube(db); await db.query("select youtube_mark_reconnect($1,$2)",[c.id,ids.worker]);
  assert.equal(await count(db,"posts"),0); assert.equal(await count(db,"youtube_connection_secrets"),0);
  assert.equal((await db.query("select channel_id,status from youtube_connections")).rows[0].channel_id,null);
}));

test("thirty-day refresh expiry clears stale API data and expired OAuth verifier states",()=>fixture(async db=>{
  const c=await connectYouTube(db); await claimYouTube(db); await commitYouTube(db,c.id);
  await db.exec("update youtube_post_sources set refreshed_at=now()-interval '31 days'; update youtube_oauth_states set expires_at=now()-interval '1 second'");
  await db.exec("select youtube_cleanup_stale_data()");
  assert.equal(await count(db,"posts"),0); assert.equal(await count(db,"youtube_oauth_states"),0);
  assert.equal((await db.query("select video_id,generated_body from youtube_post_sources")).rows[0].video_id,null);
}));

test("browser roles cannot read private credentials, state, ledger or call privileged RPCs",()=>fixture(async db=>{
  await connectYouTube(db);
  for(const role of ["anon","authenticated"]){
    await db.exec(`set role ${role}`);
    for(const table of ["youtube_connections","youtube_connection_secrets","youtube_oauth_states","youtube_post_sources","youtube_revocation_jobs"]) await assert.rejects(db.query(`select * from ${table}`),/permission denied/);
    await assert.rejects(db.query("select youtube_get_connection($1)",[ids.owner]),/permission denied/);
    await assert.rejects(db.query("select youtube_disconnect($1,true)",[ids.owner]),/permission denied/);
    await db.exec("reset role");
  }
}));

test("freshness RLS hides stale sync posts without worker or cleanup and leaves manual posts readable",()=>fixture(async db=>{
  const c=await connectYouTube(db); await claimYouTube(db); await commitYouTube(db,c.id);
  await db.query("insert into posts(board,title,body,author_id,status) values('idea_sharing','手工帖子保留','手工内容不应因为外部同步的元数据到期而被隐藏。',$1,'published')",[ids.owner]);
  await db.exec("update youtube_post_sources set refreshed_at=now()-interval '31 days'");
  assert.equal(await count(db,"posts"),2);
  for(const role of ["anon","authenticated"]){
    await db.exec(`set role ${role}`);
    assert.equal(await count(db,"posts"),1);
    assert.equal((await db.query("select title from posts")).rows[0].title,"手工帖子保留");
    await db.exec("reset role");
  }
}));

test("paused new-post sync keeps old video refresh eligible and poll cannot import pre-binding history",()=>fixture(async db=>{
  const c=await connectYouTube(db,ids.owner,ids.channel,false,true); await claimYouTube(db);
  assert.deepEqual(await commitYouTube(db,c.id,[video],{mode:"poll"}),{imported:0});
  const newVideo={...video,publishedAt:new Date(Date.now()+1000).toISOString()};
  assert.deepEqual(await commitYouTube(db,c.id,[newVideo],{mode:"poll"}),{imported:1});
  await db.query("select youtube_settings($1,false,false)",[ids.owner]);
  await db.exec("update youtube_post_sources set refreshed_at=now()-interval '2 days'");
  await db.query("select youtube_release_sync($1,$2,null,now())",[c.id,ids.worker]);
  const claim=await claimYouTube(db);
  assert.equal(claim.syncEnabled,false);
  assert.deepEqual((await db.query("select youtube_old_video_ids($1,$2,50) as ids",[c.id,ids.worker])).rows[0].ids,[video.id]);
  await db.query("select youtube_refresh_videos($1,$2,$3::jsonb,$4::jsonb)",[c.id,ids.worker,JSON.stringify([newVideo]),JSON.stringify([video.id])]);
  assert.equal(await count(db,"posts"),1);
}));

test("revocation jobs retain only encrypted retry material, are leased and expire to explicit manual action",()=>fixture(async db=>{
  const c=await connectYouTube(db); await claimYouTube(db); await commitYouTube(db,c.id);
  const result=(await db.query("select youtube_disconnect($1,true) as receipt",[ids.owner])).rows[0].receipt;
  const first=(await db.query("select youtube_claim_revocation('revoke-worker') as job")).rows[0].job;
  assert.equal(first.id,result.revocationId); assert.equal(first.refreshSecret.ciphertext,secret.ciphertext);
  assert.equal((await db.query("select youtube_claim_revocation('other-worker') as job")).rows[0].job,null);
  await assert.rejects(db.query("select youtube_complete_revocation($1,'other-worker')",[first.id]),/youtube_lease_lost/);
  await db.query("select youtube_release_revocation($1,'revoke-worker',now()+interval '1 hour')",[first.id]);
  assert.equal((await db.query("select youtube_claim_revocation('revoke-worker') as job")).rows[0].job,null);
  await db.exec("update youtube_revocation_jobs set expires_at=now()-interval '1 second'; select youtube_cleanup_stale_data()");
  assert.equal(await count(db,"youtube_revocation_jobs"),0);
  const view=(await db.query("select youtube_get_connection($1) as v",[ids.owner])).rows[0].v;
  assert.equal(view.lastErrorCode,"youtube_manual_revocation_required"); assert.equal(view.status,"reconnect_required");
}));

test("new channel binding resets history counters/cutoff while same-channel reauth preserves deletion intent",()=>fixture(async db=>{
  const c=await connectYouTube(db); await claimYouTube(db); await commitYouTube(db,c.id);
  await db.exec("update youtube_connections set sync_since=now()-interval '2 days'");
  const cutoff=(await db.query("select sync_since from youtube_connections")).rows[0].sync_since;
  await connectYouTube(db);
  assert.equal((await db.query("select sync_since from youtube_connections")).rows[0].sync_since.getTime(),cutoff.getTime());
  const disconnect=(await db.query("select youtube_disconnect($1,true) as receipt",[ids.owner])).rows[0].receipt;
  await db.query("select youtube_complete_revocation($1,null)",[disconnect.revocationId]);
  await connectYouTube(db,ids.owner,ids.otherChannel);
  const row=(await db.query("select sync_since,history_imported,last_synced_at from youtube_connections")).rows[0];
  assert.ok(row.sync_since.getTime()>cutoff.getTime()); assert.equal(row.history_imported,0); assert.equal(row.last_synced_at,null);
}));

test("historical/automatic imports never earn post points while ordinary authored publication keeps existing reward",()=>fixture(async db=>{
  const c=await connectYouTube(db); await claimYouTube(db); await commitYouTube(db,c.id);
  assert.equal(await count(db,"test_reward_awards"),0);
  const manual=(await db.query("insert into posts(board,title,body,author_id,status) values('idea_sharing','手工原创研究','这是原创手工研究，应保持普通发帖的既有积分规则，不受视频同步影响。',$1,'draft') returning id",[ids.owner])).rows[0].id;
  await db.query("update posts set status='published' where id=$1",[manual]);
  assert.equal(await count(db,"test_reward_awards"),1);
  assert.equal((await db.query("select points from test_reward_awards")).rows[0].points,12);
}));

test("null/expired worker leases and null pages cannot bypass the importer lease fence",()=>fixture(async db=>{
  const c=await connectYouTube(db);
  await assert.rejects(db.query("select youtube_commit_page($1,null,null,null,'[]',true,'history')",[c.id]),/youtube_lease_lost/);
  await claimYouTube(db);
  await assert.rejects(db.query("select youtube_commit_page($1,$2,null,null,null,true,'history')",[c.id,ids.worker]),/youtube_page_invalid/);
  assert.equal(await count(db,"posts"),0);
}));
