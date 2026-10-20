import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const author = "11111111-1111-4111-8111-111111111111";
const liker = "22222222-2222-4222-8222-222222222222";
const post = "33333333-3333-4333-8333-333333333333";

test("community engagement migration moves YouTube posts, counts real and display engagement, and keeps settings isolated", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor', true), '')::uuid $$;
      create schema storage;
      create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
      alter table storage.objects enable row level security;
      create table public.profiles(id uuid primary key, created_at timestamptz not null default now());
      create table public.posts(
        id uuid primary key,
        board text not null,
        author_id uuid not null,
        status text not null default 'published',
        created_at timestamptz not null default now(),
        constraint posts_board_check check (board in ('case_submission','idea_sharing','public_viewpoint','question_answers','review_answers'))
      );
      create table public.post_comments(id uuid primary key, post_id uuid not null, author_id uuid not null, status text not null default 'visible');
      create table public.reward_ledger(user_id uuid not null, action_key text not null, reference_key text not null, points integer not null default 1, created_at timestamptz not null default now(), unique(user_id, action_key, reference_key));
      create table public.reward_daily_checkins(user_id uuid not null, checkin_date date not null default current_date);
      create table public.youtube_connections(id uuid primary key, owner_id uuid, channel_id text, source_salt text, status text, lease_worker_id text, lease_until timestamptz, sync_enabled boolean, history_cursor text, poll_cursor text, history_complete boolean, history_imported integer, last_synced_at timestamptz, last_error_code text, sync_since timestamptz);
      create table public.youtube_post_sources(connection_id uuid, source_key text, video_id text, post_id uuid, generated_title text, generated_body text, source_state text, refreshed_at timestamptz);
      create table public.post_external_references(post_id uuid, owner_id uuid, url text, kind text, sort_order integer);
      create function public.is_verified_user() returns boolean language sql stable as $$ select true $$;
      create function public.mentor_is_admin() returns boolean language sql stable as $$ select true $$;
      create function public.award_reward_points(uuid,text,text,integer,text) returns jsonb language sql as $$ select '{"awarded":true}'::jsonb $$;
      create function public._youtube_require_owner(uuid) returns void language plpgsql as $$ begin end $$;
      create function public._youtube_lock_lease(uuid,text) returns public.youtube_connections language plpgsql as $$ declare c public.youtube_connections; begin return c; end $$;
      insert into public.profiles(id) values ('${author}'), ('${liker}');
      insert into public.posts(id, board, author_id) values ('${post}', 'idea_sharing', '${author}');
      insert into public.youtube_post_sources(connection_id, source_key, video_id, post_id, source_state) values (gen_random_uuid(), 'source', 'video', '${post}', 'active');
    `);

    await db.exec(fs.readFileSync(new URL("../supabase/migrations/202610190001_community_engagement.sql", import.meta.url), "utf8"));

    const moved = await db.query(`select board from public.posts where id = '${post}'`);
    assert.equal(moved.rows[0]?.board, "video_sharing");

    await db.exec(`select set_config('test.actor', '${liker}', false)`);
    await db.exec(`insert into public.post_likes(user_id, post_id) values ('${liker}', '${post}')`);
    await db.exec(`select set_config('test.actor', '', false)`);
    await db.exec(`select public.record_post_view('${post}', 'visitor-12345678')`);
    await db.exec(`select public.record_post_view('${post}', 'visitor-12345678')`);

    const engagement = await db.query(`select * from public.post_engagement(array['${post}']::uuid[])`);
    const counts = engagement.rows[0];
    assert.equal(Number(counts.like_count) >= 3, true);
    assert.equal(Number(counts.view_count) >= 120, true);
    assert.equal(counts.liked_by_me, false);

    await db.exec(`select set_config('test.actor', '${liker}', false)`);
    const liked = await db.query(`select liked_by_me from public.post_engagement(array['${post}']::uuid[])`);
    assert.equal(liked.rows[0]?.liked_by_me, true);

    const settings = await db.query(`select public.admin_get_community_engagement_settings() as settings`);
    assert.equal(settings.rows[0]?.settings?.virtual_enabled, true);
    await db.query(`select public.admin_update_community_engagement_settings(true, 2, 50, 10, 100, 150, 1, 3, 300, 400, 10, 20)`);
    const updated = await db.query(`select public.admin_get_community_engagement_settings() as settings`);
    assert.equal(Number(updated.rows[0]?.settings?.like_points), 2);
    assert.equal(Number(updated.rows[0]?.settings?.active_view_max), 400);

    await db.query(`select public.admin_update_community_engagement_settings(true, 2, 50, 0, 100, 150, 1, 3, 300, 400, 10, 20)`);
    const active = await db.query(`select * from public.post_engagement(array['${post}']::uuid[])`);
    assert.equal(Number(active.rows[0]?.view_count) >= 300, true);
    assert.equal(Number(active.rows[0]?.like_count) >= 10, true);

    await db.query(`select public.admin_update_community_engagement_settings(false, 2, 50, 0, 100, 150, 1, 3, 300, 400, 10, 20)`);
    const realOnly = await db.query(`select * from public.post_engagement(array['${post}']::uuid[])`);
    assert.equal(Number(realOnly.rows[0]?.view_count), 1);
    assert.equal(Number(realOnly.rows[0]?.like_count), 1);

    const version = await db.query(`select public.wavekb_schema_version() as version`);
    assert.equal(version.rows[0]?.version, "202610190001");
  } finally {
    await db.close();
  }
});
