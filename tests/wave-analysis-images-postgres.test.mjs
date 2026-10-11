import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(new URL("../supabase/migrations/20261011001354_wave_analysis_images.sql", import.meta.url), "utf8");
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const analysis = "33333333-3333-4333-8333-333333333333";
const otherAnalysis = "44444444-4444-4444-8444-444444444444";
const removableAnalysis = "55555555-5555-4555-8555-555555555555";
const quotaAnalysis = "66666666-6666-4666-8666-666666666666";

async function role(db, name = "authenticated", actor = owner) {
  await db.exec(`reset role; set role ${name};`);
  await db.query("select set_config('test.actor',$1,false)", [actor]);
}
async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor',true),'')::uuid $$;
    create function public.account_is_active() returns boolean language sql stable as $$ select coalesce(nullif(current_setting('test.active',true),'')::boolean,true) $$;
    grant usage on schema auth to anon,authenticated,service_role;
    create table public.profiles(id uuid primary key);
    create table public.workbench_analyses(id uuid primary key,owner_id uuid references profiles(id),instrument text not null,primary_timeframe text not null);
    alter table public.workbench_analyses enable row level security;
    create policy fixture_analysis_select on public.workbench_analyses for select to authenticated using(owner_id=(select auth.uid()));
    create policy fixture_analysis_update on public.workbench_analyses for update to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
    create policy fixture_analysis_delete on public.workbench_analyses for delete to authenticated using(owner_id=(select auth.uid()));
    grant select,update,delete on public.workbench_analyses to authenticated,service_role;
    create schema storage;
    grant usage on schema storage to anon,authenticated,service_role;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null,metadata jsonb default '{}',unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;
    -- Deliberately broad historical policies prove the new restrictive gates
    -- cannot be bypassed by a permissive policy intended for another bucket.
    create policy fixture_broad_select on storage.objects for select to anon,authenticated using(true);
    create policy fixture_broad_insert on storage.objects for insert to anon,authenticated with check(true);
    create policy fixture_broad_update on storage.objects for update to anon,authenticated using(true) with check(true);
    create policy fixture_broad_delete on storage.objects for delete to anon,authenticated using(true);
    insert into public.profiles values('${owner}'),('${other}');
    insert into public.workbench_analyses values
      ('${analysis}','${owner}','BTCUSDT','1h'),('${otherAnalysis}','${other}','BTCUSDT','1h'),
      ('${removableAnalysis}','${owner}','BTCUSDT','1h'),('${quotaAnalysis}','${owner}','BTCUSDT','1h');
    insert into storage.buckets values('unrelated','unrelated',false,null,null);
  `);
  await db.exec(migration);
  await role(db);
  return db;
}
function metadata(overrides = {}) {
  const row = { id: randomUUID(), owner_id: owner, analysis_id: analysis, step: 2, instrument: "BTCUSDT", timeframe: "1h", mime_type: "image/png", byte_size: 101, ...overrides };
  row.storage_path ??= `${row.owner_id}/${row.analysis_id}/${row.id}.${{ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[row.mime_type] ?? "png"}`;
  return row;
}
async function insert(db, row) {
  await db.query("insert into public.wave_analysis_images(id,owner_id,analysis_id,step,instrument,timeframe,storage_path,mime_type,byte_size) values($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [row.id, row.owner_id, row.analysis_id, row.step, row.instrument, row.timeframe, row.storage_path, row.mime_type, row.byte_size]);
  return row;
}
async function object(db, row) {
  return db.query("insert into storage.objects(bucket_id,name) values('wave-analysis-images',$1) returning id", [row.storage_path]);
}
async function count(db, table, where = "", values = []) {
  return (await db.query(`select count(*)::int as value from ${table} ${where}`, values)).rows[0].value;
}

test("image evidence PostgreSQL permissions, immutable owner binding and bounded upload lifecycle", async (t) => {
  const db = await setup();
  let first;
  try {
    await t.test("private bucket limits and invoker/RLS configuration are exact", async () => {
      await db.exec("reset role");
      const bucket = (await db.query("select public,file_size_limit,allowed_mime_types from storage.buckets where id='wave-analysis-images'")).rows[0];
      assert.deepEqual(bucket, { public: false, file_size_limit: 2097152, allowed_mime_types: ["image/jpeg", "image/png", "image/webp"] });
      const table = (await db.query("select relrowsecurity,relforcerowsecurity from pg_class where oid='public.wave_analysis_images'::regclass")).rows[0];
      assert.deepEqual(table, { relrowsecurity: true, relforcerowsecurity: true });
      assert.equal((await db.query("select prosecdef from pg_proc where oid='public.guard_wave_analysis_image_insert()'::regprocedure")).rows[0].prosecdef, false);
      assert.equal((await db.query("select wavekb_schema_version() as value")).rows[0].value, "20261011001354");
      assert.match(migration, /for update;/u);
      await role(db);
    });
    await t.test("bare objects fail before metadata; current metadata then object upload succeeds", async () => {
      first = metadata();
      await assert.rejects(object(db, first), /row-level security/u);
      await insert(db, first);
      assert.ok((await object(db, first)).rows[0].id);
      assert.equal(await count(db, "wave_analysis_images"), 1);
      assert.equal(await count(db, "storage.objects", "where bucket_id='wave-analysis-images'"), 1);
    });
    await t.test("metadata cannot spoof owner, another analysis, current context, path or file format", async () => {
      for (const values of [
        { owner_id: other, analysis_id: otherAnalysis }, { analysis_id: otherAnalysis },
        { instrument: "SOLUSDT" }, { timeframe: "4h" }, { storage_path: "https://private.invalid/image.png" },
        { storage_path: `${other}/${analysis}/${randomUUID()}.png` },
        { byte_size: 0 }, { byte_size: 2097153 }, { mime_type: "image/svg+xml" },
        { step: 0 }, { step: 8 }, { mime_type: "image/jpeg", storage_path: `${owner}/${analysis}/${randomUUID()}.png` },
      ]) await assert.rejects(insert(db, metadata(values)), /context_invalid|row-level security|check constraint/u);
      assert.equal(await count(db, "wave_analysis_images"), 1);
      await role(db, "service_role");
      await assert.rejects(insert(db, metadata({ owner_id: other })), /context_invalid/u);
      await role(db);
    });
    await t.test("owner-only metadata and storage reads survive broad historical policies", async () => {
      await role(db, "authenticated", other);
      assert.equal(await count(db, "wave_analysis_images"), 0);
      assert.equal(await count(db, "storage.objects", "where bucket_id='wave-analysis-images'"), 0);
      await assert.rejects(object(db, metadata()), /row-level security/u);
      await role(db, "anon", "");
      await assert.rejects(db.query("select * from wave_analysis_images"), /permission denied/u);
      await assert.rejects(insert(db, metadata()), /permission denied/u);
      assert.equal(await count(db, "storage.objects", "where bucket_id='wave-analysis-images'"), 0);
      await assert.rejects(object(db, metadata()), /row-level security/u);
      await role(db);
      assert.equal(await count(db, "wave_analysis_images"), 1);
    });
    await t.test("metadata and storage cannot be overwritten or removed, unrelated buckets are unaffected", async () => {
      await assert.rejects(db.query("update wave_analysis_images set timeframe='4h' where id=$1", [first.id]), /permission denied/u);
      await assert.rejects(db.query("delete from wave_analysis_images where id=$1", [first.id]), /permission denied/u);
      const updated = await db.query("update storage.objects set metadata='{\"changed\":true}' where name=$1 returning id", [first.storage_path]);
      const deleted = await db.query("delete from storage.objects where name=$1 returning id", [first.storage_path]);
      assert.equal(updated.rows.length, 0); assert.equal(deleted.rows.length, 0);
      await assert.rejects(object(db, first), /duplicate key/u);
      await db.query("insert into storage.objects(bucket_id,name) values('unrelated','fixture')");
      assert.equal((await db.query("update storage.objects set metadata='{\"changed\":true}' where bucket_id='unrelated' returning id")).rows.length, 1);
      assert.equal((await db.query("delete from storage.objects where bucket_id='unrelated' returning id")).rows.length, 1);
    });
    await t.test("inactive accounts cannot insert metadata or upload delayed objects, while owner reads keep existing behavior", async () => {
      const pending = await insert(db, metadata());
      await db.query("select set_config('test.active','false',false)");
      await assert.rejects(insert(db, metadata()), /row-level security/u);
      await assert.rejects(object(db, pending), /row-level security/u);
      assert.ok(await count(db, "wave_analysis_images") > 0);
      assert.equal(await count(db, "storage.objects", "where name=$1", [first.storage_path]), 1);
      await db.query("select set_config('test.active','true',false)");
      await object(db, pending);
    });
    await t.test("changing analysis context does not erase old evidence, but prevents a delayed old-context upload", async () => {
      const pending = await insert(db, metadata());
      await db.query("update workbench_analyses set instrument='ETHUSDT',primary_timeframe='4h' where id=$1", [analysis]);
      await assert.rejects(object(db, pending), /row-level security/u);
      await assert.rejects(insert(db, metadata()), /context_invalid/u);
      assert.equal(await count(db, "storage.objects", "where name=$1", [first.storage_path]), 1);
      await insert(db, metadata({ instrument: "ETHUSDT", timeframe: "4h" }));
      await db.query("update workbench_analyses set instrument='BTCUSDT',primary_timeframe='1h' where id=$1", [analysis]);
    });
    await t.test("12 cumulative metadata slots per context are enforced even when no object was uploaded", async () => {
      for (let i = 0; i < 11; i++) await insert(db, metadata({ analysis_id: quotaAnalysis }));
      const attempts = await Promise.allSettled(Array.from({ length: 8 }, () => insert(db, metadata({ analysis_id: quotaAnalysis }))));
      assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(attempts.filter((result) => result.status === "rejected" && /quota_exceeded/u.test(String(result.reason))).length, 7);
      assert.equal(await count(db, "wave_analysis_images", "where analysis_id=$1 and step=2", [quotaAnalysis]), 12);
      for (let step = 3; step <= 7; step++) for (let i = 0; i < 12; i++) await insert(db, metadata({ analysis_id: quotaAnalysis, step }));
      assert.equal(await count(db, "wave_analysis_images", "where analysis_id=$1", [quotaAnalysis]), 72);
      await db.query("update workbench_analyses set instrument='SOLUSDT' where id=$1", [quotaAnalysis]);
      await assert.rejects(insert(db, metadata({ analysis_id: quotaAnalysis, instrument: "SOLUSDT" })), /quota_exceeded/u);
    });
    await t.test("explicit parent-analysis deletion preserves existing UX and makes orphaned objects unreadable", async () => {
      const removable = await insert(db, metadata({ analysis_id: removableAnalysis }));
      await object(db, removable);
      await db.query("delete from workbench_analyses where id=$1", [removableAnalysis]);
      assert.equal(await count(db, "wave_analysis_images", "where analysis_id=$1", [removableAnalysis]), 0);
      assert.equal(await count(db, "storage.objects", "where name=$1", [removable.storage_path]), 0);
      await assert.rejects(object(db, removable), /row-level security/u);
      await db.exec("reset role");
      assert.equal(await count(db, "storage.objects", "where name=$1", [removable.storage_path]), 1);
    });
  } finally { await db.close(); }
});
