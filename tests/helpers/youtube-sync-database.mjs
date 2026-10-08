import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

export const youtubeIds = { owner: "11111111-1111-4111-8111-111111111111", other: "22222222-2222-4222-8222-222222222222", channel: "UCaaaaaaaaaaaaaaaaaaaaaa", otherChannel: "UCbbbbbbbbbbbbbbbbbbbbbb", worker: "youtube-test-worker" };
export const youtubeSecret = { ciphertext: "encrypted-test-value", iv: "test-iv", auth_tag: "test-tag", key_version: 1 };
export const youtubeVideo = { id: "abcdefghijk", channelId: youtubeIds.channel, title: "真实SQL验收视频", description: "授权同步内容", publishedAt: "2026-10-08T00:00:00Z", privacyStatus: "public", embeddable: true };

export async function createYouTubeDatabase() {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
      create table public.profiles(id uuid primary key,public_uid integer,account_status text default 'active',muted_until timestamptz);
      create table public.posts(id uuid primary key default gen_random_uuid(),board text not null,title text not null check(char_length(title) between 5 and 120),
        body text not null check(char_length(body) between 20 and 20000),author_id uuid not null references profiles(id),
        status text not null check(status in('draft','published','hidden')),external_url text,external_kind text);
      alter table public.posts enable row level security;
      grant select on public.posts to anon,authenticated;
      create policy readable_test_posts on public.posts for select to anon,authenticated using(status='published');
      create table public.post_external_references(id uuid primary key default gen_random_uuid(),post_id uuid not null references posts(id) on delete cascade,
        owner_id uuid not null references profiles(id),url text not null,kind text not null,sort_order integer not null,unique(post_id,sort_order));
      insert into auth.users values('${youtubeIds.owner}',now()),('${youtubeIds.other}',now());
      insert into profiles(id,public_uid) values('${youtubeIds.owner}',11111),('${youtubeIds.other}',22222);`);
    await db.exec(`create table public.test_reward_awards(owner_id uuid,event text,reference text,points integer);
      create function public.award_reward_points(p_owner uuid,p_event text,p_reference text,p_points integer,p_note text) returns jsonb
      language plpgsql set search_path='' as $$ begin insert into public.test_reward_awards values(p_owner,p_event,p_reference,p_points); return '{}'::jsonb; end $$;`);
    const originalRewards=await readFile(new URL("../../supabase/migrations/202608030004_rewards_store.sql", import.meta.url), "utf8");
    await db.exec(originalRewards.match(/create or replace function public\.reward_post_published\(\)[\s\S]+?for each row execute function public\.reward_post_published\(\);/)[0]);
    await db.exec(await readFile(new URL("../../supabase/migrations/202610080004_youtube_auto_posts.sql", import.meta.url), "utf8"));
    return db;
  } catch (error) { await db.close(); throw error; }
}
export async function beginYouTubeOAuth(db, owner = youtubeIds.owner, hash = "a".repeat(64), history = true, autoSync = true) {
  return (await db.query("select youtube_begin_oauth($1,$2,$3::jsonb,$4,$5) as id", [owner,hash,JSON.stringify(youtubeSecret),history,autoSync])).rows[0].id;
}
export async function connectYouTube(db, owner = youtubeIds.owner, channel = youtubeIds.channel, history = true, autoSync = true) {
  const hash = owner === youtubeIds.owner ? "a".repeat(64) : "b".repeat(64);
  const state = await beginYouTubeOAuth(db,owner,hash,history,autoSync);
  await db.query("select youtube_consume_oauth($1,$2)",[owner,hash]);
  return (await db.query("select youtube_complete_oauth($1,$2,$3,'验收频道','UUaaaaaaaaaaaaaaaaaaaaaa',$4::jsonb) as connection",[owner,state,channel,JSON.stringify(youtubeSecret)])).rows[0].connection;
}
export async function claimYouTube(db, worker = youtubeIds.worker) { return (await db.query("select youtube_claim_sync($1) as claimed",[worker])).rows[0].claimed; }
export async function commitYouTube(db, connectionId, videos = [youtubeVideo], { worker = youtubeIds.worker, expectedCursor = null, nextCursor = null, historyComplete = true, mode = "history" } = {}) {
  return (await db.query("select youtube_commit_page($1,$2,$3,$4,$5::jsonb,$6,$7) as receipt",[connectionId,worker,expectedCursor,nextCursor,JSON.stringify(videos),historyComplete,mode])).rows[0].receipt;
}
