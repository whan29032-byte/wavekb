import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = (filename) => readFile(new URL(`../supabase/migrations/${filename}`, import.meta.url), "utf8");
const owner = "11111111-1111-4111-8111-111111111111";
const reader = "22222222-2222-4222-8222-222222222222";
const post = "33333333-3333-4333-8333-333333333333";
const ordinaryPost = "44444444-4444-4444-8444-444444444444";
const snapshot = "55555555-5555-4555-8555-555555555555";
const cycle = "66666666-6666-4666-8666-666666666666";
const marker = "0c33da70915147498a6295e83b118ee2";
const otherMarker = "ac33da70915147498a6295e83b118ee2";
const digest = "d".repeat(64);
const tokenHash = "e".repeat(64);
const idempotencyKey = "77777777-7777-4777-8777-777777777777";
const pointer = { provider: "wavekb-trade-snapshot", snapshot_id: snapshot };
const projection = {
  schema_version: "wavekb-public-strategy-snapshot-v1",
  renderer_schema_version: "wavekb-public-chart-v1",
  calculation_engine_version: "2.7.5",
  provider: "binance", product: "usdt_perpetual", symbol: "BTCUSDT",
  timeframe: "1m", price_type: "trade", direction: "long",
  range: { from: "2026-11-26T00:00:00.000Z", to: "2026-11-26T00:01:00.000Z" },
  snapshot_status: "closed",
  candles: [{
    open_time: "2026-11-26T00:00:00.000Z", close_time: "2026-11-26T00:01:00.000Z",
    open: "100.00", high: "101.00", low: "99.00", close: "100.50", volume: "1.250",
  }],
  markers: [
    { marker_key: marker, occurred_at: "2026-11-26T00:00:03.000Z", price: "100.00", allocation_role: "open", side: "buy" },
    { marker_key: otherMarker, occurred_at: "2026-11-26T00:00:40.000Z", price: "100.50", allocation_role: "close", side: "sell" },
  ],
  public_annotations: [], indicators: [], drawings: [],
  coverage: { status: "complete", source: "public_api", fetched_at: "2026-11-26T00:02:00.000Z", gaps: [] },
  show_quantity: false, show_absolute_pnl: false, price_return_rate: "0.5",
};

async function asRole(db, role = "", actor = "") {
  await db.exec(role ? `reset role; set role ${role};` : "reset role;");
  await db.query("select set_config('test.actor', $1, false)", [actor]);
}

async function fixture(run) {
  const db = new PGlite();
  try {
    // Minimal pre-migration rows for the two foreign-key domains. The actual
    // community migration supplies policies and parent-comment validation.
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      grant usage on schema auth to anon, authenticated, service_role;
      create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('test.actor', true), '')::uuid $$;
      create table public.profiles(id uuid primary key);
      create table public.posts(
        id uuid primary key, author_id uuid not null references public.profiles(id) on delete cascade,
        status text not null check (status in ('draft', 'published', 'hidden')),
        comments_enabled boolean not null default true, chart_package jsonb
      );
      alter table public.posts enable row level security;
      create policy "published or owned posts are readable" on public.posts for select
        using (status = 'published' or author_id = auth.uid());
      grant select on public.posts to anon, authenticated, service_role;
      grant delete on public.posts to service_role;
      create table public.trading_trade_cycles(
        id uuid primary key, owner_id uuid not null references public.profiles(id) on delete cascade,
        fill_digest text not null, revision integer not null, unique(id, owner_id)
      );
      create function public.touch_updated_at() returns trigger language plpgsql as
      $$ begin new.updated_at = now(); return new; end $$;
      create function public.is_verified_user() returns boolean language sql stable as
      $$ select auth.uid() is not null $$;
      create function public.is_admin() returns boolean language sql stable as $$ select false $$;
      create function public.wavekb_schema_version() returns text language sql stable as $$ select '202611270002' $$;
    `);
    await db.exec(await migration("202607260003_comments_reports.sql"));
    await db.exec("grant select on public.post_comments to anon; grant select, insert, update on public.post_comments to authenticated; grant select, update on public.post_comments to service_role;");
    await db.query("insert into public.profiles values ($1), ($2)", [owner, reader]);
    await db.query("insert into public.trading_trade_cycles values ($1, $2, 'private-fill-digest', 1)", [cycle, owner]);
    await db.query("insert into public.posts (id, author_id, status, chart_package) values ($1, $2, 'draft', $3), ($4, $2, 'published', null)", [post, owner, JSON.stringify(pointer), ordinaryPost]);
    await db.exec(await migration("202611270003_public_strategy_snapshots.sql"));
    await run(db);
  } finally {
    await db.close();
  }
}

function addSnapshot(db, payload = projection, author = owner, postId = post) {
  return db.query(
    "insert into public.public_strategy_snapshots (id, post_id, author_id, projection_digest, projection) values ($1,$2,$3,$4,$5)",
    [snapshot, postId, author, digest, JSON.stringify(payload)],
  );
}

function addPreview(db, actor = owner, hash = tokenHash, key = idempotencyKey, payload = projection) {
  return db.query(
    `insert into public.strategy_share_previews
       (owner_id, cycle_id, cycle_revision, source_fill_digest, chart_state_version, token_hash, idempotency_key, projection_digest, projection)
     values ($1, $2, 1, 'private-fill-digest', 0, $3, $4, $5, $6)
     returning id, expires_at - created_at = interval '15 minutes' as valid_ttl`,
    [actor, cycle, hash, key, digest, JSON.stringify(payload)],
  );
}

async function visibleSnapshots(db) {
  return (await db.query("select projection from public.public_strategy_snapshots")).rows.map((row) => row.projection);
}

test("snapshot reads follow the published post, matching pointer, author and lifecycle", async () => fixture(async (db) => {
  await assert.rejects(addSnapshot(db, projection, reader), /invalid_strategy_snapshot_post/);
  await assert.rejects(addSnapshot(db, projection, owner, ordinaryPost), /invalid_strategy_snapshot_post/);
  await asRole(db, "service_role");
  await addSnapshot(db);
  for (const role of ["anon", "authenticated"]) {
    await asRole(db, role, owner);
    assert.deepEqual(await visibleSnapshots(db), []);
    await assert.rejects(addSnapshot(db), /permission denied/);
  }
  await asRole(db);
  await db.query("update public.posts set status='published' where id=$1", [post]);
  await asRole(db, "anon");
  assert.deepEqual(await visibleSnapshots(db), [projection]);
  await asRole(db, "authenticated", reader);
  await assert.rejects(db.query("update public.public_strategy_snapshots set visibility_status='unpublished'"), /permission denied/);
  await asRole(db);
  const stateChanges = [
    ["status = 'hidden'", []],
    ["status = 'published', chart_package = null", []],
    ["chart_package = $2, author_id = $3", [JSON.stringify(pointer), reader]],
  ];
  for (const [update, values] of stateChanges) {
    await db.query(`update public.posts set ${update} where id=$1`, [post, ...values]);
    await asRole(db, "anon");
    assert.deepEqual(await visibleSnapshots(db), []);
    await asRole(db);
  }
  await db.query("update public.posts set author_id=$2 where id=$1", [post, owner]);
  await asRole(db, "service_role");
  await db.query("update public.public_strategy_snapshots set visibility_status='unpublished'");
  await asRole(db, "anon");
  assert.deepEqual(await visibleSnapshots(db), []);
}));

test("only the service can access preview tokens and private source links", async () => fixture(async (db) => {
  await asRole(db, "service_role");
  await addSnapshot(db);
  const preview = await addPreview(db);
  assert.equal(preview.rows[0]?.valid_ttl, true);
  await assert.rejects(addPreview(db, reader, "f".repeat(64)), /foreign key/);
  await assert.rejects(addPreview(db), /unique constraint/);
  await assert.rejects(addPreview(db, owner, "f".repeat(64)), /unique constraint/);
  await assert.rejects(addPreview(db, owner, "raw-bearer-not-a-hash", snapshot), /check constraint/);
  await db.query(`
    insert into public.trading_post_sources (post_id, owner_id, cycle_id, source_revision, source_fill_digest)
    values ($1, $2, $3, 1, 'private-fill-digest')`, [post, owner, cycle]);
  const differentPreview = await addPreview(db, owner, "f".repeat(64), snapshot, { ...projection, symbol: "ETHUSDT" });
  await assert.rejects(
    db.query("update public.strategy_share_previews set consumed_at=clock_timestamp(), published_post_id=$1 where id=$2", [post, differentPreview.rows[0].id]),
    /invalid_strategy_share_consumption/,
  );
  await db.query(
    "update public.strategy_share_previews set consumed_at=clock_timestamp(), published_post_id=$1 where id=$2",
    [post, preview.rows[0].id],
  );
  await assert.rejects(
    db.query("update public.strategy_share_previews set consumed_at=null, published_post_id=null"),
    /strategy_share_preview_consumed/,
  );
  for (const role of ["anon", "authenticated"]) {
    await asRole(db, role, owner);
    await assert.rejects(db.query("select * from public.strategy_share_previews"), /permission denied/);
    await assert.rejects(db.query("select * from public.trading_post_sources"), /permission denied/);
  }
}));

test("snapshot constraints reject unversioned or oversized projections and changed semantic fields", async () => fixture(async (db) => {
  for (const candidate of [
    { ...projection, schema_version: "future-v2" },
    { ...projection, connection_id: cycle },
    { ...projection, candles: Array.from({ length: 3_001 }, () => projection.candles[0]) },
    { ...projection, candles: [null] },
    { ...projection, candles: [{ ...projection.candles[0], close: [] }] },
    { ...projection, candles: [{ ...projection.candles[0], response_body: "unexpected" }] },
    { ...projection, markers: [projection.markers[0], projection.markers[0]] },
    { ...projection, markers: [{ ...projection.markers[0], marker_key: "" }] },
    { ...projection, markers: [{ ...projection.markers[0], price: {} }] },
    { ...projection, markers: [{ ...projection.markers[0], accountIdentifier: "unexpected" }] },
    { ...projection, markers: [{ ...projection.markers[0], allocated_quantity: "2.00" }] },
    { ...projection, indicators: [{ settings: { raw_payload: { fake: "internal diagnostics" } } }] },
    { ...projection, drawings: [{ style: { accountSize: 50 } }] },
    { ...projection, markers: [{ ...projection.markers[0], absolute_pnl: "25.0" }] },
    { ...projection, show_quantity: "true" },
  ]) {
    await assert.rejects(addSnapshot(db, candidate), /check constraint/);
  }
  const permittedAmounts = {
    ...projection, show_quantity: true, show_absolute_pnl: true, quantity: "2.00",
    absolute_pnl: { amount: "5.00", currency: "USDT" },
    markers: [{ ...projection.markers[0], quantity: "2.00" }, projection.markers[1]],
  };
  await addSnapshot(db, permittedAmounts);
  await asRole(db, "service_role");
  for (const sql of [
    "update public.public_strategy_snapshots set projection=jsonb_set(projection,'{symbol}','\"ETHUSDT\"')",
    "update public.public_strategy_snapshots set projection_digest=repeat('a',64)",
    "update public.public_strategy_snapshots set created_at=created_at+interval '1 day'",
  ]) {
    await assert.rejects(db.query(sql), /strategy_snapshot_immutable/);
  }
  await db.query("update public.public_strategy_snapshots set visibility_status='unpublished'");
  assert.deepEqual(await visibleSnapshots(db), [permittedAmounts]);
}));

test("deleting private trades leaves a publication intact, while deleting its post tombstones it", async () => fixture(async (db) => {
  await addSnapshot(db);
  await addPreview(db);
  await db.query(`
    insert into public.trading_post_sources (post_id, owner_id, cycle_id, source_revision, source_fill_digest)
    values ($1, $2, $3, 1, 'private-fill-digest')`, [post, owner, cycle]);
  await db.query("update public.posts set status='published' where id=$1", [post]);
  await db.query("delete from public.trading_trade_cycles where id=$1", [cycle]);
  await asRole(db, "anon");
  assert.deepEqual(await visibleSnapshots(db), [projection]);
  await asRole(db);
  assert.equal((await db.query("select * from public.strategy_share_previews")).rows.length, 0);
  assert.equal((await db.query("select * from public.trading_post_sources")).rows.length, 0);
  await asRole(db, "service_role");
  await db.query("delete from public.posts where id=$1", [post]);
  assert.equal((await db.query("select visibility_status from public.public_strategy_snapshots")).rows[0]?.visibility_status, "tombstoned");
  await assert.rejects(db.query("update public.public_strategy_snapshots set visibility_status='active'"), /strategy_snapshot_tombstoned/);
  await asRole(db, "anon");
  assert.deepEqual(await visibleSnapshots(db), []);
}));

test("marker comments bind to a live snapshot, replies inherit the marker, and moderation still works", async () => fixture(async (db) => {
  await addSnapshot(db);
  await db.query("update public.posts set status='published' where id=$1", [post]);
  const add = async (postId, markerKey = null, parent = null) => (await db.query(
    "insert into public.post_comments (post_id, author_id, body, marker_key, parent_id) values ($1,$2,'comment',$3,$4) returning id, marker_key",
    [postId, reader, markerKey, parent],
  )).rows[0];
  await asRole(db, "authenticated", reader);
  const ordinary = await add(ordinaryPost);
  assert.equal(ordinary?.marker_key, null);
  assert.equal((await add(ordinaryPost, null, ordinary?.id))?.marker_key, null);
  await assert.rejects(add(ordinaryPost, marker), /invalid_strategy_comment_marker/);
  await assert.rejects(add(post, "f".repeat(32)), /invalid_strategy_comment_marker/);
  const top = await add(post, marker);
  assert.equal(top?.marker_key, marker);
  const reply = await add(post, null, top?.id);
  assert.equal(reply?.marker_key, marker);
  await assert.rejects(add(post, otherMarker, top?.id), /invalid_strategy_comment_marker/);
  await assert.rejects(add(post, null, reply?.id), /top level/);
  await assert.rejects(add(post, null, ordinary?.id), /same post/);
  await assert.rejects(
    db.query("update public.post_comments set marker_key=$2,status='deleted_by_author' where id=$1", [top.id, otherMarker]),
    /strategy_comment_marker_immutable/,
  );
  await asRole(db, "service_role");
  await db.query("update public.post_comments set status='hidden_by_admin' where id=$1", [reply.id]);
  await asRole(db, "anon");
  assert.equal((await db.query("select id from public.post_comments where id=$1", [reply.id])).rows.length, 0);
  await asRole(db, "service_role");
  await db.query("update public.public_strategy_snapshots set visibility_status='unpublished'");
  await asRole(db, "anon");
  assert.deepEqual((await db.query("select marker_key from public.post_comments")).rows, [{ marker_key: null }, { marker_key: null }]);
  await asRole(db, "authenticated", reader);
  await assert.rejects(add(post, marker), /invalid_strategy_comment_marker/);
}));
