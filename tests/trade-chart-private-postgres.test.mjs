import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const baseMigrationUrl = new URL(
  "../supabase/migrations/202611240001_multi_exchange_trade_review.sql",
  import.meta.url,
);
const privateChartMigrationUrl = new URL(
  "../supabase/migrations/202611260001_trade_chart_private.sql",
  import.meta.url,
);

const ownerOne = "11111111-1111-4111-8111-111111111111";
const ownerTwo = "22222222-2222-4222-8222-222222222222";
const connectionOne = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const connectionTwo = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const cycleOne = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const cycleTwo = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

async function createLegacyDatabase(database) {
  await database.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema if not exists auth;
    create schema if not exists public;
    create schema if not exists storage;

    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    create table public.profiles (
      id uuid primary key,
      public_uid integer,
      display_name text not null,
      avatar_url text,
      display_title text not null default '',
      nameplate_style text not null default 'classic',
      account_status text not null default 'active'
    );

    create function public.account_is_active() returns boolean language sql stable security definer set search_path = '' as $$
      select exists (
        select 1 from public.profiles
        where id = auth.uid() and account_status = 'active' and public_uid is not null
      )
    $$;
    revoke all on function public.account_is_active() from public, anon;
    grant execute on function public.account_is_active() to authenticated;

    grant usage on schema auth, storage to anon, authenticated, service_role;

    create table storage.buckets (
      id text primary key,
      name text not null,
      public boolean not null default false,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
    create table storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text not null references storage.buckets(id),
      name text not null,
      metadata jsonb not null default '{}'::jsonb,
      unique (bucket_id, name)
    );
    alter table storage.objects enable row level security;
    grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
    create policy fixture_broad_storage_select on storage.objects
      for select to anon, authenticated using (true);
    create policy fixture_broad_storage_insert on storage.objects
      for insert to anon, authenticated with check (true);
    create policy fixture_broad_storage_update on storage.objects
      for update to anon, authenticated using (true) with check (true);
    create policy fixture_broad_storage_delete on storage.objects
      for delete to anon, authenticated using (true);

    create table public.exchange_connections (
      id uuid primary key default gen_random_uuid(),
      owner_id uuid not null references public.profiles(id) on delete cascade,
      exchange text not null default 'binance' constraint exchange_connections_exchange_check check (exchange = 'binance'),
      market text not null default 'usdm_futures' constraint exchange_connections_market_check check (market = 'usdm_futures'),
      label text not null default 'Binance USD-M',
      public_enabled boolean not null default true,
      status text not null default 'active' constraint exchange_connections_status_check check (status in ('active', 'error', 'disabled')),
      api_key_last_four text not null default '',
      read_only_ack_at timestamptz not null default now(),
      started_at timestamptz not null default now(),
      last_synced_at timestamptz,
      last_error_code text not null default '',
      consecutive_failures integer not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      public_amounts_consented_at timestamptz
    );
    create unique index exchange_connections_one_live_idx
      on public.exchange_connections(owner_id, exchange, market) where status <> 'disabled';

    create table public.exchange_connection_secrets (
      id uuid primary key default gen_random_uuid(),
      connection_id uuid not null references public.exchange_connections(id) on delete cascade,
      owner_id uuid not null references public.profiles(id) on delete cascade,
      ciphertext text not null,
      iv text not null,
      auth_tag text not null,
      key_version integer not null default 1,
      active boolean not null default true,
      created_at timestamptz not null default now(),
      rotated_at timestamptz
    );

    create table public.trading_equity_snapshots (
      id bigint generated always as identity primary key,
      connection_id uuid not null references public.exchange_connections(id) on delete cascade,
      owner_id uuid not null references public.profiles(id) on delete cascade,
      captured_at timestamptz not null,
      equity_usdt numeric(30,8) not null,
      wallet_balance_usdt numeric(30,8) not null,
      unrealized_pnl_usdt numeric(30,8) not null,
      net_external_flow_usdt numeric(30,8) not null default 0,
      period_return numeric(20,12),
      created_at timestamptz not null default now(),
      unique(connection_id, captured_at)
    );

    create table public.trading_return_summaries (
      connection_id uuid primary key references public.exchange_connections(id) on delete cascade,
      owner_id uuid not null references public.profiles(id) on delete cascade,
      return_factor numeric not null default 1,
      sample_count bigint not null default 0,
      updated_at timestamptz not null,
      current_equity_usdt numeric(30,8) not null,
      cumulative_profit_usdt numeric(38,8) not null
    );

    create function public.list_trading_leaderboard(p_period text default 'realtime', p_limit integer default 50)
    returns table (
      rank_no bigint, user_id uuid, public_uid integer, display_name text,
      avatar_url text, display_title text, nameplate_style text,
      return_rate numeric, current_equity_usdt text, cumulative_profit_usdt text,
      tracking_started_at timestamptz, last_synced_at timestamptz
    ) language sql stable as $$
      select null::bigint, null::uuid, null::integer, null::text, null::text,
        null::text, null::text, null::numeric, null::text, null::text,
        null::timestamptz, null::timestamptz where false
    $$;

    create function public.wavekb_schema_version() returns text language sql stable
      as $$ select '202609080003'::text $$;

    insert into public.profiles (id, public_uid, display_name) values
      ('${ownerOne}', 33333, 'Owner one'),
      ('${ownerTwo}', 44444, 'Owner two');
    insert into public.exchange_connections (
      id, owner_id, label, public_enabled, status, api_key_last_four,
      read_only_ack_at, started_at, last_synced_at, public_amounts_consented_at
    ) values (
      '${connectionOne}', '${ownerOne}', 'Legacy Binance', true, 'active', 'ABCD',
      now() - interval '10 days', now() - interval '10 days', now() - interval '5 minutes', now() - interval '10 days'
    );
    insert into public.exchange_connection_secrets (
      connection_id, owner_id, ciphertext, iv, auth_tag, key_version
    ) values ('${connectionOne}', '${ownerOne}', 'cipher', 'iv', 'tag', 1);
  `);
}

async function migratedDatabase() {
  const database = new PGlite();
  await createLegacyDatabase(database);
  await database.exec(await fs.readFile(baseMigrationUrl, "utf8"));
  await database.exec(await fs.readFile(privateChartMigrationUrl, "utf8"));
  return database;
}

function snapshot(capturedAt) {
  return {
    captured_at: capturedAt,
    account_currency: "USDT",
    equity: "1000",
    wallet_balance: "1000",
    unrealized_pnl: "0",
    usd_equity: "1000",
    usd_wallet_balance: "1000",
    usd_unrealized_pnl: "0",
    valuation_status: "approximate",
    valuation_rate: "1",
    valuation_source: "usdt_usd_approximation",
    valuation_path: ["USDT", "USD"],
    valuation_quoted_at: capturedAt,
  };
}

function fill(nativeFillId, occurredAt, { action = "open", side = "buy" } = {}) {
  return {
    native_fill_id: nativeFillId,
    native_order_id: `order-${nativeFillId}`,
    native_position_id: null,
    symbol: "BTCUSDT",
    native_symbol: "BTCUSDT",
    product: "usdt_perpetual",
    side,
    position_side: "both",
    action,
    price: action === "open" ? "100" : "110",
    quantity: "1",
    contract_multiplier: "1",
    occurred_at: occurredAt,
    realized_pnl: action === "open" ? "0" : "10",
    realized_pnl_asset: "USDT",
    realized_pnl_usd: action === "open" ? "0" : "10",
    fee: "-1",
    fee_asset: "USDT",
    fee_usd: "-1",
    liquidity: "taker",
  };
}

function cycle({ revision, fillIds, allocations, closedAt = null, allocationDigest = `allocation-${revision}` }) {
  return {
    id: cycleOne,
    stable_key: "binance:connection:BTCUSDT:long:open-1",
    anchor_fill_id: "open-1",
    fill_ids: fillIds,
    allocations,
    allocation_digest: allocationDigest,
    revision,
    fill_digest: `digest-${revision}`,
    product: "usdt_perpetual",
    symbol: "BTCUSDT",
    direction: "long",
    native_position_id: null,
    opened_at: "2026-11-24T07:00:00.000Z",
    closed_at: closedAt,
    entry_price: "100",
    exit_price: closedAt ? "110" : null,
    quantity: "1",
    realized_pnl: closedAt ? "10" : "0",
    fees: closedAt ? "-2" : "-1",
    funding_or_swap: "0",
    dividends: "0",
    net_pnl: closedAt ? "8" : "-1",
    account_currency: "USDT",
    usd_net_pnl: closedAt ? "8" : "-1",
    valuation_status: "approximate",
    completeness: closedAt ? "complete" : "open",
    is_current: true,
  };
}

async function publish(database, { expectedGeneration, capturedAt, fills, cycles }) {
  return database.query(`
    select public.publish_exchange_sync_generation(
      $1, $2, $3, $4::jsonb, $5::jsonb, '[]'::jsonb, $6::jsonb,
      '[]'::jsonb, '{"kind":"time","value":"next"}'::jsonb,
      '2026-11-01T00:00:00.000Z'::timestamptz
    ) as generation
  `, [
    connectionOne,
    ownerOne,
    expectedGeneration,
    JSON.stringify(snapshot(capturedAt)),
    JSON.stringify(fills),
    JSON.stringify(cycles),
  ]);
}

async function actor(database, userId, role = "authenticated") {
  await database.exec(`reset role; set role ${role};`);
  await database.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
}

async function seedPrivateChartFacts(database) {
  const openedAt = "2026-11-24T07:00:00.000Z";
  await publish(database, {
    expectedGeneration: 0,
    capturedAt: "2026-11-24T09:00:00.000Z",
    fills: [fill("open-1", openedAt)],
    cycles: [cycle({
      revision: 1,
      fillIds: ["open-1"],
      allocations: [{ native_fill_id: "open-1", quantity: "1", role: "open", sort_order: 0 }],
    })],
  });
  await database.exec(`
    insert into public.exchange_credential_sets (owner_id, provider, label)
    values ('${ownerTwo}', 'binance', 'Other owner');
    insert into public.exchange_connections (
      id, owner_id, exchange, market, label, public_enabled, status,
      api_key_last_four, read_only_ack_at, started_at, provider,
      credential_set_id, account_label, account_identifier_mask,
      account_currency, capabilities, equity_tracking_started_at
    ) values (
      '${connectionTwo}', '${ownerTwo}', 'binance', 'usdm_futures', 'Other account', false, 'active',
      'WXYZ', now(), now(), 'binance',
      (select id from public.exchange_credential_sets where owner_id = '${ownerTwo}'),
      'Other account', 'masked-WXYZ', 'USDT', '{}'::jsonb, now()
    );
    insert into public.trading_fills (
      connection_id, owner_id, provider, native_fill_id, native_order_id,
      symbol, native_symbol, product, side, position_side, action,
      price, quantity, contract_multiplier, occurred_at, realized_pnl,
      realized_pnl_asset, fee, fee_asset, liquidity, generation
    ) values (
      '${connectionTwo}', '${ownerTwo}', 'binance', 'other-open', 'other-order',
      'ETHUSDT', 'ETHUSDT', 'usdt_perpetual', 'buy', 'both', 'open',
      2000, 1, 1, '${openedAt}', 0, 'USDT', 0, 'USDT', 'taker', 1
    );
    insert into public.trading_trade_cycles (
      id, connection_id, owner_id, provider, stable_key, revision, fill_digest,
      product, symbol, direction, opened_at, entry_price, quantity, realized_pnl,
      fees, funding_or_swap, dividends, net_pnl, account_currency, valuation_status,
      completeness, generation
    ) values (
      '${cycleTwo}', '${connectionTwo}', '${ownerTwo}', 'binance', 'other-cycle', 1, 'other-digest',
      'usdt_perpetual', 'ETHUSDT', 'long', '${openedAt}', 2000, 1, 0,
      0, 0, 0, 0, 'USDT', 'direct', 'open', 1
    );
    insert into public.trading_trade_cycle_revisions (cycle_id, owner_id, revision, fill_digest, facts)
    values ('${cycleTwo}', '${ownerTwo}', 1, 'other-digest',
      '{"fill_ids":["other-open"],"anchor_fill_id":"other-open"}'::jsonb);
    insert into public.trading_trade_cycle_fills (
      cycle_id, cycle_revision, owner_id, connection_id, fill_id,
      native_fill_id, allocation_quantity, allocation_role, sort_order, generation
    ) select '${cycleTwo}', 1, '${ownerTwo}', '${connectionTwo}', id,
      native_fill_id, 1, 'open', 0, 1
    from public.trading_fills where connection_id = '${connectionTwo}' and native_fill_id = 'other-open';
  `);
  const rows = await database.query(`
    select owner_id, id, native_fill_id from public.trading_fills
    where (owner_id = $1 and native_fill_id = 'open-1')
       or (owner_id = $2 and native_fill_id = 'other-open')
    order by owner_id
  `, [ownerOne, ownerTwo]);
  return {
    ownerOneFillId: rows.rows.find((row) => row.owner_id === ownerOne)?.id,
    ownerTwoFillId: rows.rows.find((row) => row.owner_id === ownerTwo)?.id,
  };
}

function annotationImage(ownerId, annotationId, id, overrides = {}) {
  const mimeType = overrides.mime_type ?? "image/png";
  const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[mimeType] ?? "png";
  return {
    id,
    storage_path: `${ownerId}/${annotationId}/${id}.${extension}`,
    mime_type: mimeType,
    byte_size: 1024,
    ...overrides,
  };
}

async function upsertAnnotation(database, {
  cycleId = cycleOne,
  fillId,
  cycleRevision = 1,
  annotationId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  body = "Review the fill",
  tags = ["discipline"],
  images = [],
  expectedVersion = 0,
  deleted = false,
} = {}) {
  return database.query(`
    select * from public.upsert_trading_fill_annotation(
      $1::uuid, $2::uuid, $3::bigint, $4::integer, $5::text, $6::text[],
      $7::jsonb, $8::integer, $9::boolean
    )
  `, [
    annotationId, cycleId, fillId, cycleRevision, body, tags,
    JSON.stringify(images), expectedVersion, deleted,
  ]);
}

async function upsertChartState(database, {
  cycleId = cycleOne,
  cycleRevision = 1,
  schemaVersion = "wavekb-trade-chart-v1",
  timeframe = "15m",
  priceType = "trade",
  viewport = { from: 100, to: 200 },
  indicators = [],
  drawings = [],
  expectedVersion = 0,
  expectedUpdatedAt = null,
} = {}) {
  return database.query(`
    select * from public.upsert_trading_chart_state(
      $1::uuid, $2::integer, $3::text, $4::text, $5::text,
      $6::jsonb, $7::jsonb, $8::jsonb, $9::integer, $10::timestamptz
    )
  `, [
    cycleId, cycleRevision, schemaVersion, timeframe, priceType,
    JSON.stringify(viewport), JSON.stringify(indicators), JSON.stringify(drawings),
    expectedVersion, expectedUpdatedAt,
  ]);
}

test("trade cycle allocation schema enforces composite identity, ownership, checks, indexes, RLS, and service-only writes", async () => {
  const database = await migratedDatabase();
  try {
    const columns = await database.query(`
      select column_name, data_type, numeric_precision, numeric_scale
      from information_schema.columns
      where table_schema = 'public' and table_name = 'trading_trade_cycle_fills'
      order by ordinal_position
    `);
    assert.deepEqual(columns.rows.map((row) => row.column_name), [
      "cycle_id", "cycle_revision", "owner_id", "connection_id", "fill_id",
      "native_fill_id", "allocation_quantity", "allocation_role", "sort_order",
      "generation", "created_at",
    ]);
    const quantity = columns.rows.find((row) => row.column_name === "allocation_quantity");
    assert.deepEqual(
      { type: quantity?.data_type, precision: quantity?.numeric_precision, scale: quantity?.numeric_scale },
      { type: "numeric", precision: 38, scale: 18 },
    );

    const constraints = await database.query(`
      select conname, contype, pg_get_constraintdef(oid) as definition
      from pg_constraint
      where conrelid = 'public.trading_trade_cycle_fills'::regclass
      order by conname
    `);
    const byName = new Map(constraints.rows.map((row) => [row.conname, row]));
    assert.match(byName.get("trading_trade_cycle_fills_pkey")?.definition ?? "", /PRIMARY KEY \(cycle_id, cycle_revision, fill_id, allocation_role\)/);
    assert.match(byName.get("trading_trade_cycle_fills_revision_fkey")?.definition ?? "", /FOREIGN KEY \(cycle_id, cycle_revision\).*trading_trade_cycle_revisions/);
    assert.match(byName.get("trading_trade_cycle_fills_cycle_owner_fkey")?.definition ?? "", /FOREIGN KEY \(cycle_id, owner_id, connection_id\).*trading_trade_cycles/);
    assert.match(byName.get("trading_trade_cycle_fills_fill_owner_fkey")?.definition ?? "", /FOREIGN KEY \(fill_id, owner_id, connection_id, native_fill_id\).*trading_fills/);
    assert.match(byName.get("trading_trade_cycle_fills_quantity_check")?.definition ?? "", /allocation_quantity > .*0/);
    assert.match(byName.get("trading_trade_cycle_fills_role_check")?.definition ?? "", /open.*add.*reduce.*close.*reverse_open/);
    assert.match(byName.get("trading_trade_cycle_fills_sort_order_check")?.definition ?? "", /sort_order >= 0/);
    assert.match(byName.get("trading_trade_cycle_fills_cycle_sort_unique")?.definition ?? "", /UNIQUE \(cycle_id, cycle_revision, sort_order\)/);

    const indexes = await database.query(`
      select indexname from pg_indexes
      where schemaname = 'public' and tablename = 'trading_trade_cycle_fills'
      order by indexname
    `);
    assert.deepEqual(indexes.rows.map((row) => row.indexname), [
      "trading_trade_cycle_fills_fill_lookup_idx",
      "trading_trade_cycle_fills_owner_cycle_order_idx",
      "trading_trade_cycle_fills_pkey",
      "trading_trade_cycle_fills_cycle_sort_unique",
    ].sort());

    const security = await database.query(`
      select relrowsecurity, relforcerowsecurity from pg_class where oid = 'public.trading_trade_cycle_fills'::regclass
    `);
    assert.equal(security.rows[0]?.relrowsecurity, true);
    assert.equal(security.rows[0]?.relforcerowsecurity, true);
    const privileges = await database.query(`
      select
        has_table_privilege('anon', 'public.trading_trade_cycle_fills', 'INSERT') as anon_insert,
        has_table_privilege('authenticated', 'public.trading_trade_cycle_fills', 'INSERT') as authenticated_insert,
        has_table_privilege('authenticated', 'public.trading_trade_cycle_fills', 'UPDATE') as authenticated_update,
        has_table_privilege('authenticated', 'public.trading_trade_cycle_fills', 'DELETE') as authenticated_delete,
        has_table_privilege('service_role', 'public.trading_trade_cycle_fills', 'INSERT') as service_insert
    `);
    assert.deepEqual(privileges.rows[0], {
      anon_insert: false,
      authenticated_insert: false,
      authenticated_update: false,
      authenticated_delete: false,
      service_insert: true,
    });
    const policies = await database.query(`
      select cmd, roles from pg_policies
      where schemaname = 'public' and tablename = 'trading_trade_cycle_fills'
    `);
    assert.deepEqual(policies.rows, [{ cmd: "ALL", roles: ["service_role"] }]);
  } finally {
    await database.close();
  }
});

test("atomic publication keeps the RPC signature, fill IDs, revisions, and owner-bound allocations", async () => {
  const database = await migratedDatabase();
  try {
    const signature = await database.query(`
      select to_regprocedure(
        'public.publish_exchange_sync_generation(uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,timestamptz)'
      )::text as signature
    `);
    assert.ok(signature.rows[0]?.signature);

    const openedAt = "2026-11-24T07:00:00.000Z";
    const closedAt = "2026-11-24T08:00:00.000Z";
    const first = await publish(database, {
      expectedGeneration: 0,
      capturedAt: "2026-11-24T09:00:00.000Z",
      fills: [fill("open-1", openedAt)],
      cycles: [cycle({
        revision: 1,
        fillIds: ["open-1"],
        allocations: [{ native_fill_id: "open-1", quantity: "1", role: "open", sort_order: 0 }],
      })],
    });
    assert.equal(Number(first.rows[0]?.generation), 1);

    await database.query(`
      delete from public.trading_trade_cycle_fills
      where cycle_id = $1 and cycle_revision = 1
    `, [cycleOne]);
    await database.query(`
      update public.trading_trade_cycle_revisions
      set facts = facts - 'allocations' - 'allocation_digest'
      where cycle_id = $1 and revision = 1
    `, [cycleOne]);

    const backfill = await publish(database, {
      expectedGeneration: 1,
      capturedAt: "2026-11-24T09:01:00.000Z",
      fills: [fill("open-1", openedAt)],
      cycles: [cycle({
        revision: 1,
        fillIds: ["open-1"],
        allocations: [{ native_fill_id: "open-1", quantity: "1", role: "open", sort_order: 0 }],
      })],
    });
    assert.equal(Number(backfill.rows[0]?.generation), 2);

    const replay = await publish(database, {
      expectedGeneration: 2,
      capturedAt: "2026-11-24T09:02:00.000Z",
      fills: [fill("open-1", openedAt)],
      cycles: [cycle({
        revision: 1,
        fillIds: ["open-1"],
        allocations: [{ native_fill_id: "open-1", quantity: "1.000000000000000000", role: "open", sort_order: 0 }],
      })],
    });
    assert.equal(Number(replay.rows[0]?.generation), 3);
    const replayedAllocation = await database.query(`
      select generation, allocation_quantity::text
      from public.trading_trade_cycle_fills
      where cycle_id = $1 and cycle_revision = 1
    `, [cycleOne]);
    assert.deepEqual(replayedAllocation.rows, [{ generation: 2, allocation_quantity: "1.000000000000000000" }]);

    await assert.rejects(
      publish(database, {
        expectedGeneration: 3,
        capturedAt: "2026-11-24T09:03:00.000Z",
        fills: [fill("open-1", openedAt)],
        cycles: [cycle({
          revision: 1,
          fillIds: ["open-1"],
          allocations: [{ native_fill_id: "open-1", quantity: "0.5", role: "open", sort_order: 0 }],
        })],
      }),
      /immutable_trade_cycle_allocations/,
    );
    const unchangedAfterAllocationMutation = await database.query(`
      select sync_generation from public.exchange_connections where id = $1
    `, [connectionOne]);
    assert.equal(Number(unchangedAfterAllocationMutation.rows[0]?.sync_generation), 3);

    const second = await publish(database, {
      expectedGeneration: 3,
      capturedAt: "2026-11-24T09:05:00.000Z",
      fills: [fill("open-1", openedAt), fill("close-1", closedAt, { action: "close", side: "sell" })],
      cycles: [cycle({
        revision: 2,
        fillIds: ["open-1", "close-1"],
        closedAt,
        allocations: [
          { native_fill_id: "open-1", quantity: "1", role: "open", sort_order: 0 },
          { native_fill_id: "close-1", quantity: "1", role: "close", sort_order: 1 },
        ],
      })],
    });
    assert.equal(Number(second.rows[0]?.generation), 4);

    const revisions = await database.query(`
      select revision, facts->'fill_ids' as fill_ids,
             facts->>'allocation_digest' as allocation_digest
      from public.trading_trade_cycle_revisions
      where cycle_id = $1
      order by revision
    `, [cycleOne]);
    assert.deepEqual(revisions.rows, [
      { revision: 1, fill_ids: ["open-1"], allocation_digest: "allocation-1" },
      { revision: 2, fill_ids: ["open-1", "close-1"], allocation_digest: "allocation-2" },
    ]);

    const allocations = await database.query(`
      select cycle_revision, native_fill_id, allocation_quantity::text,
             allocation_role, sort_order, generation
      from public.trading_trade_cycle_fills
      where cycle_id = $1
      order by cycle_revision, sort_order
    `, [cycleOne]);
    assert.deepEqual(allocations.rows, [
      { cycle_revision: 1, native_fill_id: "open-1", allocation_quantity: "1.000000000000000000", allocation_role: "open", sort_order: 0, generation: 2 },
      { cycle_revision: 2, native_fill_id: "open-1", allocation_quantity: "1.000000000000000000", allocation_role: "open", sort_order: 0, generation: 4 },
      { cycle_revision: 2, native_fill_id: "close-1", allocation_quantity: "1.000000000000000000", allocation_role: "close", sort_order: 1, generation: 4 },
    ]);

    await database.exec(`
      insert into public.trading_fills (
        connection_id, owner_id, provider, native_fill_id, native_order_id,
        symbol, native_symbol, product, side, position_side, action,
        price, quantity, contract_multiplier, occurred_at, realized_pnl,
        realized_pnl_asset, fee, fee_asset, liquidity, generation
      ) values (
        '${connectionOne}', '${ownerOne}', 'binance', 'wrong-fill', 'wrong-order',
        'BTCUSDT', 'BTCUSDT', 'usdt_perpetual', 'buy', 'both', 'open',
        100, 1, 1, now(), 0, 'USDT', 0, 'USDT', 'taker', 4
      )
    `);

    const invalidAllocationCases = [
      {
        name: "unrelated same-account fill",
        allocations: [
          { native_fill_id: "open-1", quantity: "1", role: "open", sort_order: 0 },
          { native_fill_id: "wrong-fill", quantity: "1", role: "close", sort_order: 1 },
        ],
      },
      {
        name: "missing declared fill",
        allocations: [{ native_fill_id: "open-1", quantity: "1", role: "open", sort_order: 0 }],
      },
      {
        name: "duplicate sort order",
        allocations: [
          { native_fill_id: "open-1", quantity: "1", role: "open", sort_order: 0 },
          { native_fill_id: "close-1", quantity: "1", role: "close", sort_order: 0 },
        ],
      },
      {
        name: "non-contiguous sort order",
        allocations: [
          { native_fill_id: "open-1", quantity: "1", role: "open", sort_order: 0 },
          { native_fill_id: "close-1", quantity: "1", role: "close", sort_order: 2 },
        ],
      },
    ];
    for (const invalid of invalidAllocationCases) {
      await assert.rejects(
        publish(database, {
          expectedGeneration: 4,
          capturedAt: "2026-11-24T09:06:00.000Z",
          fills: [],
          cycles: [cycle({
            revision: 2,
            fillIds: ["open-1", "close-1"],
            closedAt,
            allocations: invalid.allocations,
          })],
        }),
        /invalid_trade_cycle_allocations/,
        invalid.name,
      );
      const rolledBackInvalid = await database.query(`
        select sync_generation from public.exchange_connections where id = $1
      `, [connectionOne]);
      assert.equal(Number(rolledBackInvalid.rows[0]?.sync_generation), 4, invalid.name);
    }

    const immutableIdentityCases = [
      { name: "changed anchor", override: { anchor_fill_id: "close-1" } },
      { name: "changed stable key", override: { stable_key: "changed-stable-key" } },
      { name: "changed fill digest", override: { fill_digest: "changed-fill-digest" } },
    ];
    for (const immutable of immutableIdentityCases) {
      await assert.rejects(
        publish(database, {
          expectedGeneration: 4,
          capturedAt: "2026-11-24T09:07:00.000Z",
          fills: [],
          cycles: [{
            ...cycle({
              revision: 2,
              fillIds: ["open-1", "close-1"],
              closedAt,
              allocations: [
                { native_fill_id: "open-1", quantity: "1", role: "open", sort_order: 0 },
                { native_fill_id: "close-1", quantity: "1", role: "close", sort_order: 1 },
              ],
            }),
            ...immutable.override,
          }],
        }),
        /immutable_trade_cycle_revision/,
        immutable.name,
      );
      const rolledBackIdentity = await database.query(`
        select sync_generation from public.exchange_connections where id = $1
      `, [connectionOne]);
      assert.equal(Number(rolledBackIdentity.rows[0]?.sync_generation), 4, immutable.name);
    }

    await database.exec(`
      insert into public.exchange_credential_sets (owner_id, provider, label)
      values ('${ownerTwo}', 'binance', 'Other owner');
      insert into public.exchange_connections (
        id, owner_id, exchange, market, label, public_enabled, status,
        api_key_last_four, read_only_ack_at, started_at, provider,
        credential_set_id, account_label, account_identifier_mask,
        account_currency, capabilities, equity_tracking_started_at
      ) values (
        '${connectionTwo}', '${ownerTwo}', 'binance', 'usdm_futures', 'Other account', false, 'active',
        'WXYZ', now(), now(), 'binance',
        (select id from public.exchange_credential_sets where owner_id = '${ownerTwo}'),
        'Other account', 'masked-WXYZ', 'USDT', '{}'::jsonb, now()
      );
      insert into public.trading_fills (
        connection_id, owner_id, provider, native_fill_id, native_order_id,
        symbol, native_symbol, product, side, position_side, action,
        price, quantity, contract_multiplier, occurred_at, realized_pnl,
        realized_pnl_asset, fee, fee_asset, liquidity, generation
      ) values (
        '${connectionTwo}', '${ownerTwo}', 'binance', 'alien-fill', 'alien-order',
        'BTCUSDT', 'BTCUSDT', 'usdt_perpetual', 'buy', 'both', 'open',
        100, 1, 1, now(), 0, 'USDT', 0, 'USDT', 'taker', 1
      );
    `);

    await assert.rejects(
      publish(database, {
        expectedGeneration: 4,
        capturedAt: "2026-11-24T09:10:00.000Z",
        fills: [],
        cycles: [{
          ...cycle({
            revision: 1,
            fillIds: ["alien-fill"],
            allocations: [{ native_fill_id: "alien-fill", quantity: "1", role: "open", sort_order: 0 }],
          }),
          id: cycleTwo,
          stable_key: "alien-cycle",
          anchor_fill_id: "alien-fill",
        }],
      }),
      /trade_cycle_allocation_fill_not_found/,
    );
    const rolledBack = await database.query(`
      select sync_generation from public.exchange_connections where id = $1
    `, [connectionOne]);
    assert.equal(Number(rolledBack.rows[0]?.sync_generation), 4);
    const cycleCount = await database.query(`
      select count(*)::integer as count from public.trading_trade_cycles where connection_id = $1
    `, [connectionOne]);
    assert.equal(cycleCount.rows[0]?.count, 1);

    const alienFill = await database.query(`
      select id from public.trading_fills where connection_id = $1 and native_fill_id = 'alien-fill'
    `, [connectionTwo]);
    await assert.rejects(
      database.query(`
        insert into public.trading_trade_cycle_fills (
          cycle_id, cycle_revision, owner_id, connection_id, fill_id,
          native_fill_id, allocation_quantity, allocation_role, sort_order, generation
        ) values ($1, 2, $2, $3, $4, 'alien-fill', 1, 'open', 9, 4)
      `, [cycleOne, ownerOne, connectionOne, alienFill.rows[0]?.id]),
      /trading_trade_cycle_fills_fill_owner_fkey/,
    );
  } finally {
    await database.close();
  }
});

test("a legacy locale-ordered fill set can advance to a code-point-ordered revision", async () => {
  const database = await migratedDatabase();
  try {
    const occurredAt = "2026-11-24T07:00:00.000Z";
    const oldRevision = {
      ...cycle({
        revision: 1,
        fillIds: ["a", "Z"],
        allocations: [
          { native_fill_id: "a", quantity: "1", role: "open", sort_order: 0 },
          { native_fill_id: "Z", quantity: "1", role: "add", sort_order: 1 },
        ],
        allocationDigest: "legacy-allocation-digest",
      }),
      stable_key: "binance:connection:BTCUSDT:long:a",
      anchor_fill_id: "a",
      fill_digest: "same-unordered-fill-digest",
    };
    const newRevision = {
      ...cycle({
        revision: 2,
        fillIds: ["Z", "a"],
        allocations: [
          { native_fill_id: "Z", quantity: "1", role: "open", sort_order: 0 },
          { native_fill_id: "a", quantity: "1", role: "add", sort_order: 1 },
        ],
        allocationDigest: "code-point-allocation-digest",
      }),
      stable_key: "binance:connection:BTCUSDT:long:Z",
      anchor_fill_id: "Z",
      fill_digest: "same-unordered-fill-digest",
    };

    const first = await publish(database, {
      expectedGeneration: 0,
      capturedAt: "2026-11-24T09:00:00.000Z",
      fills: [fill("a", occurredAt), fill("Z", occurredAt)],
      cycles: [oldRevision],
    });
    assert.equal(Number(first.rows[0]?.generation), 1);

    const second = await publish(database, {
      expectedGeneration: 1,
      capturedAt: "2026-11-24T09:05:00.000Z",
      fills: [fill("a", occurredAt), fill("Z", occurredAt)],
      cycles: [newRevision],
    });
    assert.equal(Number(second.rows[0]?.generation), 2);

    const revisions = await database.query(`
      select revision, facts->>'anchor_fill_id' as anchor_fill_id,
             facts->'fill_ids' as fill_ids
      from public.trading_trade_cycle_revisions
      where cycle_id = $1
      order by revision
    `, [cycleOne]);
    assert.deepEqual(revisions.rows, [
      { revision: 1, anchor_fill_id: "a", fill_ids: ["a", "Z"] },
      { revision: 2, anchor_fill_id: "Z", fill_ids: ["Z", "a"] },
    ]);
  } finally {
    await database.close();
  }
});

test("annotation and chart writes lock the current cycle row before validating its revision", async () => {
  const migration = await fs.readFile(privateChartMigrationUrl, "utf8");
  assert.equal(
    migration.match(/from public\.trading_trade_cycles cycle[\s\S]{0,500}?for update of cycle/giu)?.length,
    2,
    "both private write RPCs must hold the cycle lock through their state write",
  );
});

test("private trade chart schema exposes bounded owner state, private storage, and the deployment marker", async () => {
  const database = await migratedDatabase();
  try {
    const tables = await database.query(`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name in (
        'trading_fill_annotations', 'trading_fill_annotation_images',
        'trading_chart_states', 'trading_candle_cache'
      ) order by table_name
    `);
    assert.deepEqual(tables.rows.map((row) => row.table_name), [
      "trading_candle_cache",
      "trading_chart_states",
      "trading_fill_annotation_images",
      "trading_fill_annotations",
    ]);

    const annotationColumns = await database.query(`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'trading_fill_annotations'
      order by ordinal_position
    `);
    assert.deepEqual(annotationColumns.rows.map((row) => row.column_name), [
      "id", "owner_id", "cycle_id", "fill_id", "native_fill_id", "cycle_revision",
      "body", "tags", "remap_status", "remapped_from_revision", "version",
      "created_at", "updated_at", "deleted_at",
    ]);
    const chartColumns = await database.query(`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'trading_chart_states'
      order by ordinal_position
    `);
    assert.deepEqual(chartColumns.rows.map((row) => row.column_name), [
      "cycle_id", "owner_id", "cycle_revision", "schema_version", "timeframe",
      "price_type", "viewport", "indicators", "drawings", "version",
      "created_at", "updated_at",
    ]);
    const candleColumns = await database.query(`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'trading_candle_cache'
      order by ordinal_position
    `);
    assert.deepEqual(candleColumns.rows.map((row) => row.column_name), [
      "provider", "product", "native_symbol", "timeframe", "scope_kind", "scope_hash",
      "price_type", "open_time", "close_time", "open_price", "high_price", "low_price",
      "close_price", "volume", "is_final", "source_host_kind", "source_timestamp",
      "coverage_status", "gap_before", "gap_after", "fetched_at", "expires_at",
    ]);

    const security = await database.query(`
      select relname, relrowsecurity, relforcerowsecurity
      from pg_class where oid in (
        'public.trading_fill_annotations'::regclass,
        'public.trading_fill_annotation_images'::regclass,
        'public.trading_chart_states'::regclass,
        'public.trading_candle_cache'::regclass
      ) order by relname
    `);
    assert.deepEqual(security.rows, [
      { relname: "trading_candle_cache", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "trading_chart_states", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "trading_fill_annotation_images", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "trading_fill_annotations", relrowsecurity: true, relforcerowsecurity: true },
    ]);

    const bucket = await database.query(`
      select public, file_size_limit, allowed_mime_types
      from storage.buckets where id = 'trade-chart-annotation-images'
    `);
    assert.deepEqual(bucket.rows[0], {
      public: false,
      file_size_limit: 2097152,
      allowed_mime_types: ["image/jpeg", "image/png", "image/webp"],
    });
    const storagePolicies = await database.query(`
      select policyname, permissive, cmd from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname like 'trade_chart_annotation_images_%'
      order by policyname
    `);
    assert.deepEqual(storagePolicies.rows, [
      { policyname: "trade_chart_annotation_images_anon_no_delete", permissive: "RESTRICTIVE", cmd: "DELETE" },
      { policyname: "trade_chart_annotation_images_anon_no_insert", permissive: "RESTRICTIVE", cmd: "INSERT" },
      { policyname: "trade_chart_annotation_images_anon_no_select", permissive: "RESTRICTIVE", cmd: "SELECT" },
      { policyname: "trade_chart_annotation_images_delete_bound", permissive: "RESTRICTIVE", cmd: "DELETE" },
      { policyname: "trade_chart_annotation_images_delete_own", permissive: "PERMISSIVE", cmd: "DELETE" },
      { policyname: "trade_chart_annotation_images_insert_bound", permissive: "RESTRICTIVE", cmd: "INSERT" },
      { policyname: "trade_chart_annotation_images_insert_own", permissive: "PERMISSIVE", cmd: "INSERT" },
      { policyname: "trade_chart_annotation_images_no_update", permissive: "RESTRICTIVE", cmd: "UPDATE" },
      { policyname: "trade_chart_annotation_images_select_bound", permissive: "RESTRICTIVE", cmd: "SELECT" },
      { policyname: "trade_chart_annotation_images_select_own", permissive: "PERMISSIVE", cmd: "SELECT" },
    ]);

    const functions = await database.query(`
      select to_regprocedure('public.upsert_trading_fill_annotation(uuid,uuid,bigint,integer,text,text[],jsonb,integer,boolean)')::text as annotation,
             to_regprocedure('public.upsert_trading_chart_state(uuid,integer,text,text,text,jsonb,jsonb,jsonb,integer,timestamp with time zone)')::text as chart
    `);
    assert.ok(functions.rows[0]?.annotation);
    assert.ok(functions.rows[0]?.chart);
    const functionDefinitions = await database.query(`
      select pg_get_functiondef(
        'public.upsert_trading_fill_annotation(uuid,uuid,bigint,integer,text,text[],jsonb,integer,boolean)'::regprocedure
      ) as annotation,
      pg_get_functiondef(
        'public.upsert_trading_chart_state(uuid,integer,text,text,text,jsonb,jsonb,jsonb,integer,timestamp with time zone)'::regprocedure
      ) as chart
    `);
    for (const name of ["annotation", "chart"]) {
      assert.match(
        functionDefinitions.rows[0]?.[name] ?? "",
        /from public\.trading_trade_cycles cycle[\s\S]*?for update of cycle/iu,
        `${name} RPC must lock the current cycle row through its write`,
      );
    }
    assert.equal((await database.query("select public.wavekb_schema_version() as version")).rows[0]?.version, "202611260001");
  } finally {
    await database.close();
  }
});

test("private chart read RPC returns one owner-bound snapshot and keeps same-revision allocations from older generations", async () => {
  const database = await migratedDatabase();
  try {
    await seedPrivateChartFacts(database);
    await database.exec("reset role");
    await database.query(
      "update public.exchange_connections set sync_generation = 3 where id = $1",
      [connectionOne],
    );
    await database.query(
      "update public.trading_trade_cycles set generation = 3 where id = $1",
      [cycleOne],
    );
    const storedAllocation = await database.query(`
      select generation from public.trading_trade_cycle_fills
      where owner_id = $1 and cycle_id = $2 and cycle_revision = 1
    `, [ownerOne, cycleOne]);
    assert.equal(storedAllocation.rows[0]?.generation, 1);

    const procedure = await database.query(`
      select to_regprocedure('public.load_private_trade_chart_facts(uuid,uuid)')::text as procedure
    `);
    assert.ok(procedure.rows[0]?.procedure, "the atomic private chart read RPC must exist");

    await actor(database, ownerOne);
    await assert.rejects(
      database.query("select public.load_private_trade_chart_facts($1, $2)", [ownerOne, cycleOne]),
      /permission denied/u,
    );

    await actor(database, null, "service_role");
    const loaded = await database.query(`
      select public.load_private_trade_chart_facts($1, $2) as facts
    `, [ownerOne, cycleOne]);
    const chart = loaded.rows[0]?.facts;
    assert.equal(chart?.snapshot_token?.cycle_revision, 1);
    assert.equal(chart?.snapshot_token?.cycle_generation, 3);
    assert.equal(chart?.snapshot_token?.sync_generation, 3);
    assert.deepEqual(chart?.allocations?.map((allocation) => allocation.native_fill_id), ["open-1"]);
    assert.deepEqual(chart?.fills?.map((fillRow) => fillRow.native_fill_id), ["open-1"]);
    const serialized = JSON.stringify(chart);
    for (const privateField of [
      "credential_set_id", "external_account_id_hash", "stable_key", "fill_digest",
      "native_position_id", "lease_owner", "storage_path", "raw_payload", "access_point",
    ]) {
      assert.equal(serialized.includes(privateField), false, `snapshot must omit ${privateField}`);
    }

    const crossOwner = await database.query(`
      select public.load_private_trade_chart_facts($1, $2) as facts
    `, [ownerOne, cycleTwo]);
    assert.equal(crossOwner.rows[0]?.facts, null);
  } finally {
    await database.exec("reset role").catch(() => {});
    await database.close();
  }
});

test("publishing a new cycle revision remaps only exact fill identities and marks missing fills for confirmation", async () => {
  const database = await migratedDatabase();
  try {
    const { ownerOneFillId } = await seedPrivateChartFacts(database);
    const annotationId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    await actor(database, ownerOne);
    await upsertAnnotation(database, {
      fillId: ownerOneFillId,
      annotationId,
      body: "revision one note",
    });

    await database.exec("reset role");
    const lateAt = "2026-11-24T08:00:00.000Z";
    await publish(database, {
      expectedGeneration: 1,
      capturedAt: "2026-11-24T10:00:00.000Z",
      fills: [fill("open-1", "2026-11-24T07:00:00.000Z"), fill("late-1", lateAt, { action: "close", side: "sell" })],
      cycles: [cycle({
        revision: 2,
        fillIds: ["open-1", "late-1"],
        allocations: [
          { native_fill_id: "open-1", quantity: "1", role: "open", sort_order: 0 },
          { native_fill_id: "late-1", quantity: "1", role: "close", sort_order: 1 },
        ],
        closedAt: lateAt,
      })],
    });
    let annotation = (await database.query(`
      select fill_id, native_fill_id, cycle_revision, remap_status,
             remapped_from_revision, version
      from public.trading_fill_annotations where id = $1
    `, [annotationId])).rows[0];
    assert.deepEqual(annotation, {
      fill_id: ownerOneFillId,
      native_fill_id: "open-1",
      cycle_revision: 2,
      remap_status: "remapped",
      remapped_from_revision: 1,
      version: 2,
    });

    await publish(database, {
      expectedGeneration: 2,
      capturedAt: "2026-11-24T11:00:00.000Z",
      fills: [fill("late-1", lateAt, { action: "close", side: "sell" })],
      cycles: [cycle({
        revision: 3,
        fillIds: ["late-1"],
        allocations: [{ native_fill_id: "late-1", quantity: "1", role: "close", sort_order: 0 }],
        closedAt: lateAt,
      })],
    });
    annotation = (await database.query(`
      select fill_id, native_fill_id, cycle_revision, remap_status,
             remapped_from_revision, version
      from public.trading_fill_annotations where id = $1
    `, [annotationId])).rows[0];
    assert.deepEqual(annotation, {
      fill_id: ownerOneFillId,
      native_fill_id: "open-1",
      cycle_revision: 3,
      remap_status: "needs_confirmation",
      remapped_from_revision: 1,
      version: 3,
    });

    await publish(database, {
      expectedGeneration: 3,
      capturedAt: "2026-11-24T12:00:00.000Z",
      fills: [fill("late-1", lateAt, { action: "close", side: "sell" })],
      cycles: [cycle({
        revision: 3,
        fillIds: ["late-1"],
        allocations: [{ native_fill_id: "late-1", quantity: "1", role: "close", sort_order: 0 }],
        closedAt: lateAt,
      })],
    });
    assert.equal((await database.query(`
      select version from public.trading_fill_annotations where id = $1
    `, [annotationId])).rows[0]?.version, 3, "same-revision replay must not mutate annotations");

    await actor(database, null, "service_role");
    const loaded = await database.query(`
      select public.load_private_trade_chart_facts($1, $2) as facts
    `, [ownerOne, cycleOne]);
    assert.deepEqual(loaded.rows[0]?.facts?.annotations?.map((item) => ({
      fill_id: item.fill_id,
      native_fill_id: item.native_fill_id,
      remap_status: item.remap_status,
    })), [{
      fill_id: String(ownerOneFillId),
      native_fill_id: "open-1",
      remap_status: "needs_confirmation",
    }]);
  } finally {
    await database.exec("reset role").catch(() => {});
    await database.close();
  }
});

test("annotation RPC normalizes bounded content, preserves remap state, and isolates image ownership", async () => {
  const database = await migratedDatabase();
  try {
    const { ownerOneFillId, ownerTwoFillId } = await seedPrivateChartFacts(database);
    const annotationId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const firstImage = annotationImage(ownerOne, annotationId, "11111111-aaaa-4111-8111-111111111111");
    const secondImage = annotationImage(ownerOne, annotationId, "22222222-aaaa-4222-8222-222222222222", { mime_type: "image/jpeg" });

    await actor(database, ownerOne);
    const created = await upsertAnnotation(database, {
      fillId: ownerOneFillId,
      annotationId,
      body: "  Followed the plan.  ",
      tags: ["  Discipline ", "risk", "discipline", "  RISK  "],
      images: [firstImage, secondImage],
    });
    assert.deepEqual(created.rows.map((row) => ({
      owner_id: row.owner_id,
      cycle_revision: row.cycle_revision,
      body: row.body,
      tags: row.tags,
      remap_status: row.remap_status,
      version: row.version,
      deleted_at: row.deleted_at,
    })), [{
      owner_id: ownerOne,
      cycle_revision: 1,
      body: "  Followed the plan.  ",
      tags: ["discipline", "risk"],
      remap_status: "current",
      version: 1,
      deleted_at: null,
    }]);
    const orderedImages = await database.query(`
      select id, storage_path, mime_type, byte_size, sort_order, deleted_at
      from public.trading_fill_annotation_images where annotation_id = $1 order by sort_order
    `, [annotationId]);
    assert.deepEqual(orderedImages.rows.map((row) => ({ ...row, byte_size: Number(row.byte_size) })), [
      { ...firstImage, sort_order: 0, deleted_at: null },
      { ...secondImage, sort_order: 1, deleted_at: null },
    ]);

    await database.query(`
      insert into storage.objects(bucket_id, name, metadata)
      values ('trade-chart-annotation-images', $1, '{"mimetype":"image/png","size":1024}'::jsonb)
    `, [firstImage.storage_path]);
    for (const metadata of [
      { mimetype: "image/png", size: 1024 },
      { mimetype: "image/jpeg", size: 1025 },
    ]) {
      await assert.rejects(
        database.query(`
          insert into storage.objects(bucket_id, name, metadata)
          values ('trade-chart-annotation-images', $1, $2::jsonb)
        `, [secondImage.storage_path, JSON.stringify(metadata)]),
        /row-level security/u,
      );
    }
    await actor(database, null, "anon");
    assert.equal((await database.query(
      "select count(*)::integer as count from storage.objects where bucket_id = 'trade-chart-annotation-images'",
    )).rows[0]?.count, 0);
    await assert.rejects(
      database.query(`
        insert into storage.objects(bucket_id, name, metadata)
        values ('trade-chart-annotation-images', $1, '{"mimetype":"image/png","size":1024}'::jsonb)
      `, [`${ownerOne}/${annotationId}/77777777-aaaa-4777-8777-777777777777.png`]),
      /row-level security/u,
    );
    await database.query(`
      delete from storage.objects
      where bucket_id = 'trade-chart-annotation-images' and name = $1
    `, [firstImage.storage_path]);
    await database.exec("reset role");
    assert.equal((await database.query(`
      select count(*)::integer as count from storage.objects
      where bucket_id = 'trade-chart-annotation-images' and name = $1
    `, [firstImage.storage_path])).rows[0]?.count, 1, "a broad legacy anon DELETE policy must not delete private images");
    await actor(database, ownerOne);
    await assert.rejects(
      database.query("insert into storage.objects(bucket_id, name) values ('trade-chart-annotation-images', $1)", [
        `${ownerOne}/${annotationId}/33333333-aaaa-4333-8333-333333333333.png`,
      ]),
      /row-level security/u,
    );

    for (const invalid of [
      { expectedVersion: null },
      { deleted: null },
      { images: null },
      { body: "x".repeat(5001) },
      { tags: Array.from({ length: 11 }, (_, index) => `tag-${index}`) },
      { tags: ["x".repeat(41)] },
      { images: Array.from({ length: 6 }, (_, index) => annotationImage(ownerOne, annotationId, `00000000-0000-4000-8000-00000000000${index}`)) },
      { images: [annotationImage(ownerOne, annotationId, "33333333-aaaa-4333-8333-333333333333", { mime_type: "image/svg+xml" })] },
      { images: [annotationImage(ownerOne, annotationId, "44444444-aaaa-4444-8444-444444444444", { byte_size: 2097153 })] },
      { images: [annotationImage(ownerOne, annotationId, "55555555-aaaa-4555-8555-555555555555", { storage_path: `${ownerTwo}/stolen.png` })] },
    ]) {
      await assert.rejects(
        upsertAnnotation(database, { fillId: ownerOneFillId, annotationId, expectedVersion: 1, ...invalid }),
        /invalid_trade_chart_annotation|invalid_trade_chart_annotation_images/u,
      );
    }
    for (const replacement of [
      annotationImage(ownerOne, annotationId, firstImage.id, { mime_type: "image/jpeg" }),
      annotationImage(ownerOne, annotationId, firstImage.id, { byte_size: 2048 }),
    ]) {
      await assert.rejects(
        upsertAnnotation(database, {
          fillId: ownerOneFillId,
          annotationId,
          expectedVersion: 1,
          images: [replacement, secondImage],
        }),
        /invalid_trade_chart_annotation_images/u,
        "an existing image UUID cannot replace its path, MIME, or byte size",
      );
    }
    const unchangedImage = await database.query(`
      select storage_path, mime_type, byte_size, deleted_at
      from public.trading_fill_annotation_images where id = $1
    `, [firstImage.id]);
    assert.deepEqual({
      ...unchangedImage.rows[0],
      byte_size: Number(unchangedImage.rows[0]?.byte_size),
    }, {
      storage_path: firstImage.storage_path,
      mime_type: firstImage.mime_type,
      byte_size: firstImage.byte_size,
      deleted_at: null,
    });
    assert.equal((await database.query(`
      select count(*)::integer as count from storage.objects
      where bucket_id = 'trade-chart-annotation-images' and name = $1
    `, [firstImage.storage_path])).rows[0]?.count, 1, "rejected replacement must not orphan the stored object");
    await assert.rejects(
      upsertAnnotation(database, { fillId: ownerOneFillId, annotationId, expectedVersion: 0 }),
      /stale_trade_chart_annotation/u,
    );
    await assert.rejects(
      database.query("update public.trading_fill_annotations set body = 'bypass' where id = $1", [annotationId]),
      /permission denied/u,
    );
    await assert.rejects(
      database.query(`
        insert into public.trading_trade_cycle_fills (
          cycle_id, cycle_revision, owner_id, connection_id, fill_id, native_fill_id,
          allocation_quantity, allocation_role, sort_order, generation
        ) values ($1, 1, $2, $3, $4, 'open-1', 1, 'open', 9, 1)
      `, [cycleOne, ownerOne, connectionOne, ownerOneFillId]),
      /permission denied/u,
    );

    await actor(database, ownerTwo);
    assert.equal((await database.query("select count(*)::integer as count from public.trading_fill_annotations")).rows[0]?.count, 0);
    assert.equal((await database.query(
      "select count(*)::integer as count from public.trading_fill_annotation_images",
    )).rows[0]?.count, 0);
    assert.equal((await database.query("select count(*)::integer as count from storage.objects where bucket_id = 'trade-chart-annotation-images'")).rows[0]?.count, 0);
    await assert.rejects(
      upsertAnnotation(database, { fillId: ownerOneFillId, annotationId: "aaaaaaaa-eeee-4eee-8eee-eeeeeeeeeeee" }),
      /trade_chart_fill_not_owned/u,
    );
    const otherAnnotationId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const otherImage = annotationImage(
      ownerTwo,
      otherAnnotationId,
      "66666666-aaaa-4666-8666-666666666666",
    );
    await upsertAnnotation(database, {
      cycleId: cycleTwo,
      fillId: ownerTwoFillId,
      annotationId: otherAnnotationId,
      body: "Other owner",
      images: [otherImage],
    });
    assert.equal((await database.query("select count(*)::integer as count from public.trading_fill_annotations")).rows[0]?.count, 1);

    await actor(database, ownerOne);
    assert.equal((await database.query("select count(*)::integer as count from public.trading_fill_annotations")).rows[0]?.count, 1);
    assert.equal((await database.query(
      "select count(*)::integer as count from public.trading_fill_annotation_images",
    )).rows[0]?.count, 2);
    await assert.rejects(
      database.query(
        "update public.trading_fill_annotation_images set sort_order = 4 where id = $1",
        [otherImage.id],
      ),
      /permission denied/u,
    );
    await assert.rejects(
      upsertAnnotation(database, {
        cycleId: cycleTwo,
        fillId: ownerTwoFillId,
        annotationId: otherAnnotationId,
        expectedVersion: 1,
      }),
      /trade_chart_fill_not_owned/u,
    );
    assert.equal((await database.query("select count(*)::integer as count from storage.objects where bucket_id = 'trade-chart-annotation-images'")).rows[0]?.count, 1);
    const blockedUpdate = await database.query(
      "update storage.objects set metadata = '{\"changed\":true}'::jsonb where bucket_id = 'trade-chart-annotation-images' returning id",
    );
    assert.equal(blockedUpdate.rows.length, 0);
    await database.query(
      "delete from storage.objects where bucket_id = 'trade-chart-annotation-images' and name = $1",
      [firstImage.storage_path],
    );
    await database.exec("reset role");
    assert.equal((await database.query(
      "select count(*)::integer as count from storage.objects where bucket_id = 'trade-chart-annotation-images' and name = $1",
      [firstImage.storage_path],
    )).rows[0]?.count, 0);
    await actor(database, ownerOne);
    await database.query(`
      insert into storage.objects(bucket_id, name, metadata)
      values ('trade-chart-annotation-images', $1, '{"mimetype":"image/png","size":1024}'::jsonb)
    `, [firstImage.storage_path]);

    await database.exec("reset role");
    await database.query("update public.trading_trade_cycles set revision = 2 where id = $1", [cycleOne]);
    await database.query(`
      insert into public.trading_trade_cycle_revisions(cycle_id, owner_id, revision, fill_digest, facts)
      values ($1, $2, 2, 'digest-2', '{"fill_ids":["open-1"],"anchor_fill_id":"open-1"}'::jsonb)
    `, [cycleOne, ownerOne]);
    await database.query(`
      insert into public.trading_trade_cycle_fills(
        cycle_id, cycle_revision, owner_id, connection_id, fill_id, native_fill_id,
        allocation_quantity, allocation_role, sort_order, generation
      ) values ($1, 2, $2, $3, $4, 'open-1', 1, 'open', 0, 2)
    `, [cycleOne, ownerOne, connectionOne, ownerOneFillId]);
    await actor(database, ownerOne);
    const remapped = await upsertAnnotation(database, {
      fillId: ownerOneFillId,
      annotationId,
      cycleRevision: 2,
      expectedVersion: 1,
      images: [firstImage],
    });
    assert.deepEqual({
      cycle_revision: remapped.rows[0]?.cycle_revision,
      remap_status: remapped.rows[0]?.remap_status,
      remapped_from_revision: remapped.rows[0]?.remapped_from_revision,
      version: remapped.rows[0]?.version,
    }, { cycle_revision: 2, remap_status: "remapped", remapped_from_revision: 1, version: 2 });

    const removed = await upsertAnnotation(database, {
      fillId: ownerOneFillId,
      annotationId,
      cycleRevision: 2,
      expectedVersion: 2,
      images: [firstImage],
      deleted: true,
    });
    assert.ok(removed.rows[0]?.deleted_at);
    assert.equal(removed.rows[0]?.version, 3);
    assert.equal((await database.query(`
      select count(*)::integer as count from public.trading_fill_annotation_images
      where annotation_id = $1 and deleted_at is null
    `, [annotationId])).rows[0]?.count, 0);
    assert.equal((await database.query("select count(*)::integer as count from storage.objects where bucket_id = 'trade-chart-annotation-images'")).rows[0]?.count, 0);
    await database.exec("reset role");
    await database.query(
      "delete from storage.objects where bucket_id = 'trade-chart-annotation-images' and name = $1",
      [firstImage.storage_path],
    );
    assert.equal((await database.query(
      "select count(*)::integer as count from storage.objects where bucket_id = 'trade-chart-annotation-images' and name = $1",
      [firstImage.storage_path],
    )).rows[0]?.count, 0);
  } finally {
    await database.exec("reset role").catch(() => {});
    await database.close();
  }
});

test("chart state RPC uses owner and optimistic guards while candle facts remain service-only", async () => {
  const database = await migratedDatabase();
  try {
    await seedPrivateChartFacts(database);
    await actor(database, ownerOne);
    const validDrawing = {
      id: "line-1",
      tool: "trend-line",
      points: [{ time: 100, price: 100 }, { time: 200, price: 110 }],
      style: { color: "#2962ff", lineWidth: 2, lineStyle: "solid" },
      paneIndex: 0,
      zIndex: 1,
    };
    const drawingPointCounts = {
      "trend-line": 2, ray: 2, "horizontal-line": 1, "vertical-line": 1,
      rectangle: 2, text: 1, "long-position": 2, "short-position": 2,
      "fib-retracement": 2, "fib-extension": 3, "fib-time-zone": 2,
      "fib-fan": 2, "fib-channel": 3, "elliott-impulse": 6,
      "elliott-correction": 4, "elliott-triangle": 6,
      "elliott-double-combo": 4, "elliott-triple-combo": 6,
    };
    const supportedIndicatorIds = [
      "sma", "ema", "wma", "hma", "vwap", "bollinger", "rsi", "macd",
      "stochastic", "adx", "atr", "supertrend", "ichimoku", "donchian",
      "keltner-channel", "chandelier-exit", "zigzag", "williams-fractals",
      "pivot-points", "cpr", "obv", "mfi", "chaikin-money-flow",
    ];
    const supportedDrawingTools = [
      "trend-line", "ray", "horizontal-line", "vertical-line", "rectangle", "text",
      "long-position", "short-position", "fib-retracement", "fib-extension",
      "fib-time-zone", "fib-fan", "fib-channel", "elliott-impulse",
      "elliott-correction", "elliott-triangle", "elliott-double-combo", "elliott-triple-combo",
    ];
    const created = await upsertChartState(database, {
      indicators: supportedIndicatorIds.map((indicatorId, index) => ({
        instanceId: `${indicatorId}-${index}`,
        indicatorId,
        ...(indicatorId === "rsi" ? { paneIndex: 1, settings: { length: 14, source: "close" } } : {}),
      })),
      drawings: supportedDrawingTools.map((tool, index) => ({
        ...validDrawing,
        id: `${tool}-${index}`,
        tool,
        points: Array.from({ length: drawingPointCounts[tool] }, (_, pointIndex) => ({
          time: 100 + pointIndex,
          price: 100 + pointIndex,
        })),
        style: tool === "trend-line" || tool === "ray"
          ? { showStats: true }
          : tool === "long-position" || tool === "short-position"
            ? { accountSize: 100000, risk: 1 }
            : {},
        ...(tool === "long-position" || tool === "short-position"
          ? { properties: { stopTime: 240, stopPrice: 80 } }
          : {}),
        ...(tool === "text" ? { text: { value: "note" } } : {}),
      })),
    });
    assert.deepEqual({
      owner_id: created.rows[0]?.owner_id,
      schema_version: created.rows[0]?.schema_version,
      timeframe: created.rows[0]?.timeframe,
      price_type: created.rows[0]?.price_type,
      version: created.rows[0]?.version,
    }, {
      owner_id: ownerOne,
      schema_version: "wavekb-trade-chart-v1",
      timeframe: "15m",
      price_type: "trade",
      version: 1,
    });
    const firstUpdatedAt = created.rows[0]?.updated_at;
    await assert.rejects(
      upsertChartState(database, { expectedVersion: 0, expectedUpdatedAt: firstUpdatedAt }),
      /stale_trade_chart_state/u,
    );
    await assert.rejects(
      upsertChartState(database, { expectedVersion: 1, expectedUpdatedAt: "2020-01-01T00:00:00.000Z" }),
      /stale_trade_chart_state/u,
    );
    const updated = await upsertChartState(database, {
      timeframe: "1h",
      expectedVersion: 1,
      expectedUpdatedAt: firstUpdatedAt,
    });
    assert.equal(updated.rows[0]?.version, 2);
    assert.equal(updated.rows[0]?.timeframe, "1h");

    for (const invalid of [
      { expectedVersion: null },
      { schemaVersion: "future-v2" },
      { timeframe: "13m" },
      { priceType: "mid" },
      { viewport: { from: 2 } },
      { viewport: { from: 1, to: 2, onVisibleRangeChanged: "alert(1)" } },
      { indicators: Array.from({ length: 33 }, (_, index) => ({ instanceId: `rsi-${index}`, indicatorId: "rsi" })) },
      { indicators: [{ instanceId: "unknown-1", indicatorId: "remote-script" }] },
      { indicators: [{ instanceId: "rsi-1", indicatorId: "rsi", execute: "alert(1)" }] },
      { indicators: [{ instanceId: "rsi-1", indicatorId: "rsi", settings: { length: 14, callback: "<script>alert(1)</script>" } }] },
      { indicators: [{ instanceId: "rsi-1", indicatorId: "rsi", settings: { length: 14, source: "study:rsi" } }] },
      { indicators: [{ instanceId: "rsi-1", indicatorId: "rsi", paneIndex: 16 }] },
      { indicators: [
        { instanceId: "duplicate", indicatorId: "rsi" },
        { instanceId: "duplicate", indicatorId: "ema" },
      ] },
      { indicators: [{ instanceId: "rsi-1", indicatorId: "rsi", settings: { timeframe: "1h" } }] },
      { drawings: Array.from({ length: 201 }, (_, index) => ({ ...validDrawing, id: `line-${index}` })) },
      { drawings: [{ ...validDrawing, id: "unknown", tool: "execute-script" }] },
      { drawings: [{ ...validDrawing, onClick: "alert(1)" }] },
      { drawings: [{ ...validDrawing, points: [{ time: 100, price: "100" }] }] },
      { drawings: [{ ...validDrawing, points: [{ time: 100, price: 100, command: "run" }] }] },
      { drawings: [{ ...validDrawing, points: [{ time: 10000000000001, price: 100 }] }] },
      { drawings: [{ ...validDrawing, points: [{ time: 100, price: Number.POSITIVE_INFINITY }] }] },
      { drawings: [{ ...validDrawing, points: [validDrawing.points[0]] }] },
      { drawings: [{ ...validDrawing, style: { levels: [{ ratio: 0.618 }] } }] },
      { drawings: [{ ...validDrawing, id: "vertical-1", tool: "vertical-line", points: [validDrawing.points[0]], text: { color: "#fff" } }] },
      { drawings: [{ ...validDrawing, id: "elliott-1", tool: "elliott-impulse", points: Array.from({ length: 6 }, (_, index) => ({ time: 100 + index, price: 100 + index })), properties: { showHeader: true } }] },
      { drawings: [{ ...validDrawing, id: "text-1", tool: "text", points: [validDrawing.points[0]], style: {}, text: { value: "<script>alert(1)</script>" } }] },
      { drawings: [{ ...validDrawing, id: "text-2", tool: "text", points: [validDrawing.points[0]], style: {} }] },
      { drawings: [{ ...validDrawing, id: "position-1", tool: "long-position", points: validDrawing.points, style: { accountSize: -1 } }] },
      { drawings: [{ ...validDrawing, id: "position-2", tool: "short-position", points: validDrawing.points, style: { accountSize: 1000000000000001 } }] },
      { drawings: [{ ...validDrawing, id: "position-3", tool: "long-position", points: validDrawing.points, style: { risk: 100.1 } }] },
      { drawings: [{ ...validDrawing, id: "position-4", tool: "short-position", points: [...validDrawing.points, { time: 300, price: 90 }], style: {} }] },
      { drawings: [{ ...validDrawing, id: "position-5", tool: "long-position", points: validDrawing.points, style: {}, text: { align: "center" } }] },
      { drawings: [{ ...validDrawing, id: "position-6", tool: "long-position", points: validDrawing.points, style: {}, properties: { stopTime: 240 } }] },
      { drawings: [{ ...validDrawing, id: "position-7", tool: "short-position", points: validDrawing.points, style: {}, properties: { stopPrice: 80 } }] },
      { drawings: [{ ...validDrawing, id: "position-8", tool: "long-position", points: validDrawing.points, style: {}, properties: { stopTime: 10000000000001, stopPrice: 80 } }] },
      { drawings: [{ ...validDrawing, id: "position-9", tool: "short-position", points: validDrawing.points, style: {}, properties: { stopTime: 240, stopPrice: 1100000000000000000 } }] },
      { drawings: [{ ...validDrawing, id: "position-10", tool: "long-position", points: validDrawing.points, style: {}, properties: { stopTime: 240, stopPrice: 80, controllerPoint: {} } }] },
      { drawings: [{ ...validDrawing, id: "trend-invalid-stats", tool: "trend-line", style: { showStats: "yes" } }] },
      { drawings: [{ ...validDrawing, id: "trend-enum-array", style: { lineStyle: ["solid"] } }] },
      { drawings: [{ ...validDrawing, id: "rectangle-enum-array", tool: "rectangle", text: { value: "note", align: ["left"] } }] },
      { priceType: "bid" },
    ]) {
      await assert.rejects(
        upsertChartState(database, {
          expectedVersion: 2,
          expectedUpdatedAt: updated.rows[0]?.updated_at,
          ...invalid,
        }),
        /invalid_trade_chart_state/u,
        `invalid chart state ${Object.keys(invalid)[0]}`,
      );
    }
    await database.exec("reset role");
    await database.query("update public.trading_trade_cycles set provider = 'exness' where id = $1", [cycleOne]);
    await actor(database, ownerOne);
    await assert.rejects(
      upsertChartState(database, {
        priceType: "trade",
        expectedVersion: 2,
        expectedUpdatedAt: updated.rows[0]?.updated_at,
      }),
      /invalid_trade_chart_state/u,
    );
    const exnessState = await upsertChartState(database, {
      priceType: "bid",
      expectedVersion: 2,
      expectedUpdatedAt: updated.rows[0]?.updated_at,
    });
    assert.equal(exnessState.rows[0]?.price_type, "bid");
    assert.equal(exnessState.rows[0]?.version, 3);
    const exnessBothState = await upsertChartState(database, {
      priceType: "both",
      expectedVersion: 3,
      expectedUpdatedAt: exnessState.rows[0]?.updated_at,
    });
    assert.equal(exnessBothState.rows[0]?.price_type, "both");
    assert.equal(exnessBothState.rows[0]?.version, 4);
    await assert.rejects(
      database.query("update public.trading_chart_states set timeframe = '1d' where cycle_id = $1", [cycleOne]),
      /permission denied/u,
    );

    await actor(database, ownerTwo);
    assert.equal((await database.query("select count(*)::integer as count from public.trading_chart_states")).rows[0]?.count, 0);
    await assert.rejects(upsertChartState(database), /trade_chart_cycle_not_owned/u);
    await upsertChartState(database, { cycleId: cycleTwo });
    assert.equal((await database.query("select count(*)::integer as count from public.trading_chart_states")).rows[0]?.count, 1);

    await database.exec("reset role");
    const validCandle = [
      "binance", "usdt_perpetual", "BTCUSDT", "15m", "public_market", "public-market-v1",
      "trade", "2026-11-24T07:00:00.000Z", "2026-11-24T07:15:00.000Z",
      "100", "110", "90", "105", "12.5", true, "public_api",
      "2026-11-24T07:15:01.000Z", "complete", false, false,
      "2026-11-24T07:15:02.000Z", "2026-11-24T07:20:02.000Z",
    ];
    const insertCandle = (values = validCandle) => database.query(`
      insert into public.trading_candle_cache(
        provider, product, native_symbol, timeframe, scope_kind, scope_hash,
        price_type, open_time, close_time, open_price, high_price, low_price,
        close_price, volume, is_final, source_host_kind, source_timestamp,
        coverage_status, gap_before, gap_after, fetched_at, expires_at
      ) values (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
      )
    `, values);
    await insertCandle();
    await assert.rejects(insertCandle(), /duplicate key/u);
    for (const [index, value] of [
      [0, "kraken"], [3, "13m"], [4, "private_account"], [6, "bid"],
      [15, "signed_account"], [17, "invented"],
    ]) {
      const invalid = [...validCandle];
      invalid[index] = value;
      invalid[7] = new Date(new Date(validCandle[7]).getTime() + (index + 1) * 86_400_000).toISOString();
      invalid[8] = new Date(new Date(invalid[7]).getTime() + 900_000).toISOString();
      await assert.rejects(insertCandle(invalid), /check constraint/u);
    }

    const exnessBid = [
      "exness", "cfd", "XAUUSD", "15m", "private_account",
      `hmac-sha256-v1:${"a".repeat(64)}`, "bid",
      "2026-11-24T07:00:00.000Z", "2026-11-24T07:15:00.000Z",
      "2000", "2010", "1990", "2005", null, true, "signed_account",
      "2026-11-24T07:15:01.000Z", "complete", false, false,
      "2026-11-24T07:15:02.000Z", "2026-11-24T07:20:02.000Z",
    ];
    await insertCandle(exnessBid);
    const exnessBoth = [...exnessBid];
    exnessBoth[6] = "both";
    exnessBoth[7] = "2026-11-25T07:00:00.000Z";
    exnessBoth[8] = "2026-11-25T07:15:00.000Z";
    await assert.rejects(insertCandle(exnessBoth), /check constraint/u);

    await actor(database, ownerOne);
    await assert.rejects(insertCandle([
      ...validCandle.slice(0, 7),
      "2026-11-25T07:00:00.000Z", "2026-11-25T07:15:00.000Z",
      ...validCandle.slice(9),
    ]), /permission denied/u);
    await assert.rejects(database.query("select * from public.trading_candle_cache"), /permission denied/u);
  } finally {
    await database.exec("reset role").catch(() => {});
    await database.close();
  }
});
