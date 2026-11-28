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

const connection = "88888888-8888-4888-8888-888888888888";

async function withPublishContract(run) {
  await fixture(async (db) => {
    // The private chart ABI is already exercised with its real migrations in
    // trade-chart-private-postgres.test.mjs. This fixture gives the public
    // wrapper current owner-bound facts and real relational write targets.
    await db.exec(`
      alter table public.posts add column board text, add column title text, add column body text;
      alter table public.profiles add column public_uid integer, add column account_status text default 'active',
        add column muted_until timestamptz;
      update public.profiles set public_uid = 33333;
      create table auth.users(id uuid primary key, email_confirmed_at timestamptz);
      insert into auth.users select id, now() from public.profiles;
      create table public.exchange_connections(
        id uuid primary key, owner_id uuid not null, status text not null, sync_generation bigint not null
      );
      insert into public.exchange_connections values ('${connection}', '${owner}', 'active', 3);
      alter table public.trading_trade_cycles
        add column connection_id uuid references public.exchange_connections(id),
        add column provider text default 'binance', add column product text default 'usdt_perpetual',
        add column symbol text default 'BTCUSDT', add column direction text default 'long',
        add column entry_price numeric(38,18) default 70000.123456789012345678,
        add column exit_price numeric(38,18) default 72000.876543210987654321,
        add column quantity numeric(38,18) default 0.010000000000000001,
        add column net_pnl numeric(38,18) default 12.345678901234567891,
        add column completeness text default 'complete', add column account_currency text default 'USDT',
        add column opened_at timestamptz default '2026-11-26T00:00:03Z',
        add column closed_at timestamptz default '2026-11-26T00:00:40Z',
        add column is_current boolean default true, add column generation bigint default 3;
      update public.trading_trade_cycles set connection_id = '${connection}';
      create table public.test_chart_facts(cycle_id uuid primary key, chart_state jsonb, notes jsonb, price jsonb);
      insert into public.test_chart_facts values ('${cycle}',
        '{"version":2,"price_type":"mark","drawings":[{"id":"saved","tool":"trend-line"}]}',
        '[{"version":1,"body":"private memo"}]', '"70000.123456789012345678"');
      create function public.load_private_trade_chart_facts(p_owner_id uuid, p_cycle_id uuid)
      returns jsonb language sql stable as $$
        select jsonb_build_object(
          'chart_state', f.chart_state, 'annotations', f.notes, 'fills', jsonb_build_array(f.price),
          'snapshot_token', jsonb_build_object('sync_generation', conn.sync_generation)
        )
        from public.test_chart_facts f
        join public.trading_trade_cycles c on c.id = f.cycle_id
        join public.exchange_connections conn on conn.id = c.connection_id and conn.owner_id = c.owner_id
        where c.id = p_cycle_id and c.owner_id = p_owner_id and c.is_current and c.generation = conn.sync_generation
          and conn.status <> 'deleting'
      $$;
    `);
    await db.exec(await migration("202611270004_public_strategy_publish.sql"));
    await run(db);
  });
}

async function readSource(db, actor = owner, tradeId = cycle) {
  return (await db.query("select public.load_public_strategy_share_source($1,$2) as value", [actor, tradeId])).rows[0]?.value;
}

async function addPublishPreview(db, {
  hash = tokenHash, key = idempotencyKey, tradeId = cycle, fingerprint, age = 0, payload = projection,
} = {}) {
  const source = await readSource(db, owner, tradeId);
  return db.query(`
    insert into public.strategy_share_previews (
      owner_id, cycle_id, cycle_revision, source_fill_digest, chart_state_version, source_fingerprint,
      token_hash, idempotency_key, projection_digest, projection, created_at, expires_at
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
      clock_timestamp() - ($11::integer * interval '1 minute'),
      clock_timestamp() - ($11::integer * interval '1 minute') + interval '14 minutes')
  `, [owner, tradeId, source.revision, source.fill_digest, source.chart_state_version,
    fingerprint ?? source.source_fingerprint, hash, key, digest, JSON.stringify(payload), age]);
}

async function publishPreview(db, {
  actor = owner, tradeId = cycle, hash = tokenHash, key = idempotencyKey, expectedDigest = digest,
  board = "idea_sharing", title = "Equal preview and publication", body = "This body follows the same existing post rules.",
  predecessor = null,
} = {}) {
  return (await db.query("select public.publish_public_strategy_preview($1,$2,$3,$4,$5,$6,$7,$8,$9) as value",
    [actor, tradeId, hash, key, expectedDigest, board, title, body, predecessor])).rows[0]?.value;
}

test("a service-only source fingerprint uses owner, private annotations, saved studies and exact decimal facts", async () => withPublishContract(async (db) => {
  await asRole(db, "service_role");
  assert.equal(await readSource(db, reader), null);
  const original = await readSource(db);
  assert.equal(original.trade.entry_price, "70000.123456789012345678");
  assert.equal(original.trade.quantity, "0.010000000000000001");
  assert.equal(original.trade.net_pnl, "12.345678901234567891");
  assert.equal(original.chart_state_version, 2);
  assert.equal(original.price_type, "mark");
  assert.deepEqual(original.drawings, [{ id: "saved", tool: "trend-line" }]);
  assert.match(original.source_fingerprint, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(original), /private memo/);
  await asRole(db);
  await db.exec("set timezone to 'Asia/Shanghai'");
  assert.equal((await readSource(db)).source_fingerprint, original.source_fingerprint);
  await db.exec("update public.test_chart_facts set notes = '[{\"version\":2,\"body\":\"changed\"}]'");
  const noteEdited = await readSource(db);
  assert.notEqual(noteEdited.source_fingerprint, original.source_fingerprint);
  await db.exec("update public.trading_trade_cycles set entry_price = entry_price + 0.000000000000000001");
  assert.notEqual((await readSource(db)).source_fingerprint, noteEdited.source_fingerprint);
  for (const role of ["anon", "authenticated"]) {
    await asRole(db, role, owner);
    await assert.rejects(readSource(db), /permission denied/);
    await assert.rejects(publishPreview(db), /permission denied/);
  }
}));

test("publish atomically persists the exact preview, creates one visible post and does not repeat on retry", async () => withPublishContract(async (db) => {
  await asRole(db, "service_role");
  await addPublishPreview(db);
  const saved = await publishPreview(db);
  assert.equal(saved.replayed, false);
  await asRole(db, "anon");
  const read = (await db.query("select post_id, projection, projection_digest from public.public_strategy_snapshots")).rows;
  assert.deepEqual(read, [{ post_id: saved.post_id, projection, projection_digest: digest }]);
  await asRole(db);
  await db.exec(`
    update public.trading_trade_cycles set revision = 2;
    alter table public.strategy_share_previews disable trigger guard_strategy_share_preview_consumption;
    update public.strategy_share_previews set
      created_at = created_at - interval '1 hour', expires_at = expires_at - interval '1 hour',
      consumed_at = consumed_at - interval '1 hour';
    alter table public.strategy_share_previews enable trigger guard_strategy_share_preview_consumption;
  `);
  await asRole(db, "service_role");
  assert.deepEqual(await publishPreview(db), { ...saved, replayed: true });
  await assert.rejects(publishPreview(db, { expectedDigest: "b".repeat(64) }), /public_strategy_preview_stale/);
  await assert.rejects(publishPreview(db, { key: snapshot }), /public_strategy_preview_consumed/);
  await asRole(db);
  assert.equal((await db.query("select count(*)::integer as count from public.posts where status = 'published' and chart_package is not null")).rows[0].count, 1);
  await db.query("update public.posts set status='hidden' where id=$1", [saved.post_id]);
  await asRole(db, "service_role");
  await assert.rejects(publishPreview(db), /public_strategy_preview_consumed/);
}));

test("preserves linked charts on generic edits, rejects forged pointers, and permits atomic publication", async () => withPublishContract(async (db) => {
  await db.exec(await migration("202611270005_strategy_marker_comments.sql"));
  await asRole(db, "service_role");
  await addPublishPreview(db);
  const saved = await publishPreview(db);
  await asRole(db);
  await db.query("update public.posts set title='Edited post title', chart_package=null where id=$1", [saved.post_id]);
  const [edited] = (await db.query("select title, chart_package from public.posts where id=$1", [saved.post_id])).rows;
  assert.deepEqual(edited, { title: "Edited post title", chart_package: { provider: "wavekb-trade-snapshot", snapshot_id: saved.snapshot_id } });
  await assert.rejects(db.query("update public.posts set chart_package=$2 where id=$1", [saved.post_id, JSON.stringify(pointer)]), /strategy_post_pointer_immutable/);
  await assert.rejects(db.query("update public.posts set chart_package=$2 where id=$1", [ordinaryPost, JSON.stringify(pointer)]), /invalid_strategy_post_pointer/);
  await assert.rejects(db.query("insert into public.posts(id,author_id,status,chart_package) values($1,$2,'published',$3)", [connection, owner, JSON.stringify(edited.chart_package)]), /invalid_strategy_post_pointer/);
  await assert.rejects(db.query("insert into public.posts(id,author_id,status,chart_package) values($1,$2,'published',$3)", [connection, owner, JSON.stringify({ ...edited.chart_package, api_key: "hidden" })]), /invalid_strategy_post_pointer/);
  await asRole(db, "anon");
  assert.deepEqual(await visibleSnapshots(db), [projection]);
}));

test("soft deletes verified authors' comments idempotently without altering replies or hidden rows", async () => fixture(async (db) => {
  await db.exec(await migration("202611270005_strategy_marker_comments.sql"));
  await addSnapshot(db);
  await db.query("update public.posts set status='published' where id=$1", [post]);
  await asRole(db, "authenticated", reader);
  const [{ id }] = (await db.query("insert into public.post_comments (post_id,author_id,body,marker_key) values($1,$2,'original comment',$3) returning id", [post, reader, marker])).rows;
  const [{ id: replyId }] = (await db.query("insert into public.post_comments (post_id,author_id,body,parent_id) values($1,$2,'reply stays',$3) returning id", [post, reader, id])).rows;
  const legacyUpdate = await db.query("update public.post_comments set status='deleted_by_author', body='legacy delete' where id=$1 and author_id=$2 returning id", [id, reader]);
  assert.deepEqual(legacyUpdate.rows, [], "the old browser update cannot silently be treated as a successful deletion");
  const softDelete = async (commentId) => (await db.query("select public.soft_delete_my_post_comment($1) as deleted", [commentId])).rows[0].deleted;
  await asRole(db, "authenticated", owner);
  assert.equal(await softDelete(id), false);
  await asRole(db, "anon");
  await assert.rejects(softDelete(id), /permission denied/);
  await asRole(db);
  await db.exec(`create or replace function public.is_verified_user() returns boolean language sql stable as $$
    select coalesce(current_setting('test.verified',true), '') = 'yes' $$`);
  await asRole(db, "authenticated", reader);
  await assert.rejects(softDelete(id), /comment_delete_forbidden/);
  await db.exec("select set_config('test.verified','yes',false)");
  assert.equal(await softDelete(id), true);
  assert.equal(await softDelete(id), true);
  await asRole(db, "anon");
  assert.deepEqual((await db.query("select id,body,marker_key from public.post_comments")).rows, [{ id: replyId, body: "reply stays", marker_key: marker }]);
  await asRole(db, "service_role");
  assert.deepEqual((await db.query("select status,body,marker_key from public.post_comments where id=$1", [id])).rows,
    [{ status: "deleted_by_author", body: "该评论已由作者删除。", marker_key: marker }]);
  await db.query("update public.post_comments set status='hidden_by_admin' where id=$1", [replyId]);
  await asRole(db, "authenticated", reader);
  assert.equal(await softDelete(replyId), false);
}));

test("only the service purges at most 500 expired unconsumed previews in expiry order", async () => withPublishContract(async (db) => {
  await db.exec(await migration("202611270005_strategy_marker_comments.sql"));
  await asRole(db, "service_role");
  await addPublishPreview(db);
  await publishPreview(db);
  const validHash = "a".repeat(64);
  await addPublishPreview(db, { hash: validHash, key: snapshot });
  await asRole(db);
  await db.query(`insert into public.strategy_share_previews (
    owner_id, cycle_id, cycle_revision, source_fill_digest, chart_state_version, source_fingerprint, token_hash, projection_digest, projection, created_at, expires_at
  ) select $1, $2, 1, 'private-fill-digest', 0, repeat('f', 64), lpad(n::text, 64, '0'), $3, $4,
    statement_timestamp() - interval '1 hour' + n * interval '1 second',
    statement_timestamp() - interval '50 minutes' + n * interval '1 second'
  from generate_series(1, 501) as rows(n)`, [owner, cycle, digest, JSON.stringify(projection)]);
  await db.exec(`alter table public.strategy_share_previews disable trigger guard_strategy_share_preview_consumption;
    update public.strategy_share_previews set created_at = created_at - interval '1 hour',
      expires_at = expires_at - interval '1 hour', consumed_at = consumed_at - interval '1 hour' where consumed_at is not null;
    alter table public.strategy_share_previews enable trigger guard_strategy_share_preview_consumption;`);
  const purge = async () => (await db.query("select public.purge_expired_strategy_share_previews() as affected")).rows[0].affected;
  for (const role of ["anon", "authenticated"]) {
    await asRole(db, role, owner);
    await assert.rejects(purge(), /permission denied/);
  }
  await asRole(db, "service_role");
  assert.equal(await purge(), 500);
  const remaining = async () => (await db.query("select token_hash from public.strategy_share_previews order by token_hash")).rows.map((row) => row.token_hash);
  assert.deepEqual(await remaining(), ["501".padStart(64, "0"), validHash, tokenHash]);
  assert.equal(await purge(), 1);
  assert.equal(await purge(), 0);
  assert.deepEqual(await remaining(), [validHash, tokenHash]);
}));

test("publish handles retries and rejects stale, expired and cross-owner previews", async () => withPublishContract(async (db) => {
  await asRole(db, "service_role");
  await addPublishPreview(db);
  await assert.rejects(publishPreview(db, { actor: reader }), /public_strategy_preview_not_found/);
  await assert.rejects(publishPreview(db, { board: "unsupported" }), /public_strategy_publish_invalid/);
  await assert.rejects(publishPreview(db, { predecessor: ordinaryPost }), /public_strategy_publish_invalid/);
  await asRole(db);
  await db.exec("update public.test_chart_facts set notes = '[{\"version\":2,\"body\":\"new\"}]'");
  await asRole(db, "service_role");
  await assert.rejects(publishPreview(db), /public_strategy_preview_stale/);
  await addPublishPreview(db, { hash: "b".repeat(64), key: snapshot, age: 30 });
  await assert.rejects(publishPreview(db, { hash: "b".repeat(64), key: snapshot }), /public_strategy_preview_expired/);
  const fresh = { hash: "c".repeat(64), key: ordinaryPost };
  await addPublishPreview(db, fresh);
  const [a, b] = await Promise.all([publishPreview(db, fresh), publishPreview(db, fresh)]);
  assert.deepEqual(b, { ...a, replayed: true });
  await asRole(db);
  await db.query("update public.profiles set account_status='banned' where id=$1", [owner]);
  await asRole(db, "service_role");
  await assert.rejects(publishPreview(db, fresh), /public_strategy_publish_forbidden/);
}));

test("a successor must belong to the same source and leaves its predecessor visible", async () => withPublishContract(async (db) => {
  await asRole(db, "service_role");
  await addPublishPreview(db);
  const first = await publishPreview(db);
  const next = { hash: "b".repeat(64), key: snapshot, predecessor: first.post_id };
  await addPublishPreview(db, next);
  const second = await publishPreview(db, next);
  await asRole(db, "anon");
  const { rows } = await db.query(
    "select post_id, supersedes_post_id from public.public_strategy_snapshots where post_id = any($1::uuid[])",
    [[first.post_id, second.post_id]],
  );
  assert.deepEqual(new Map(rows.map(({ post_id, supersedes_post_id }) => [post_id, supersedes_post_id])),
    new Map([[first.post_id, null], [second.post_id, first.post_id]]));

  await asRole(db);
  const otherCycle = "43224564-a4f2-4efa-a544-e186d281e254";
  await db.query(`insert into public.trading_trade_cycles (id, owner_id, connection_id, fill_digest, revision)
    values ($1,$2,$3,'another-private-digest',1)`,
    [otherCycle, owner, connection]);
  await db.query(`insert into public.test_chart_facts (cycle_id,chart_state,notes,price)
    select $1,chart_state,notes,price from public.test_chart_facts where cycle_id=$2`, [otherCycle, cycle]);
  await asRole(db, "service_role");
  const wrongSource = { hash: "c".repeat(64), key: ordinaryPost, tradeId: otherCycle, predecessor: first.post_id };
  await addPublishPreview(db, wrongSource);
  await assert.rejects(publishPreview(db, wrongSource), /public_strategy_publish_invalid/);
}));

test("a failed activation rolls back the post, snapshot, source and preview consumption", async () => withPublishContract(async (db) => {
  await asRole(db, "service_role");
  await addPublishPreview(db);
  await asRole(db);
  await db.exec(`create function public.test_reject_publication() returns trigger language plpgsql as $$
    begin if new.status = 'published' then raise exception 'activation_fixture_failure'; end if; return new; end $$;
    create trigger test_reject_publication before update of status on public.posts for each row
      execute function public.test_reject_publication();`);
  await asRole(db, "service_role");
  await assert.rejects(publishPreview(db), /activation_fixture_failure/);
  assert.equal((await db.query("select count(*)::integer as count from public.posts")).rows[0].count, 2);
  assert.deepEqual((await db.query("select * from public.public_strategy_snapshots")).rows, []);
  assert.deepEqual((await db.query("select * from public.trading_post_sources")).rows, []);
  assert.deepEqual((await db.query("select consumed_at,published_post_id from public.strategy_share_previews")).rows,
    [{ consumed_at: null, published_post_id: null }]);
  await asRole(db);
  await db.exec("drop trigger test_reject_publication on public.posts");
  await asRole(db, "service_role");
  assert.equal((await publishPreview(db)).replayed, false);
}));
