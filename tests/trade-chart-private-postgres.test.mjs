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
    create role service_role;
    create schema if not exists auth;
    create schema if not exists public;

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

function cycle({ revision, fillIds, allocations, closedAt = null }) {
  return {
    id: cycleOne,
    stable_key: "binance:connection:BTCUSDT:long:open-1",
    anchor_fill_id: "open-1",
    fill_ids: fillIds,
    allocations,
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

    const indexes = await database.query(`
      select indexname from pg_indexes
      where schemaname = 'public' and tablename = 'trading_trade_cycle_fills'
      order by indexname
    `);
    assert.deepEqual(indexes.rows.map((row) => row.indexname), [
      "trading_trade_cycle_fills_fill_lookup_idx",
      "trading_trade_cycle_fills_owner_cycle_order_idx",
      "trading_trade_cycle_fills_pkey",
    ]);

    const security = await database.query(`
      select relrowsecurity from pg_class where oid = 'public.trading_trade_cycle_fills'::regclass
    `);
    assert.equal(security.rows[0]?.relrowsecurity, true);
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

    const second = await publish(database, {
      expectedGeneration: 1,
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
    assert.equal(Number(second.rows[0]?.generation), 2);

    const revisions = await database.query(`
      select revision, facts->'fill_ids' as fill_ids
      from public.trading_trade_cycle_revisions
      where cycle_id = $1
      order by revision
    `, [cycleOne]);
    assert.deepEqual(revisions.rows, [
      { revision: 1, fill_ids: ["open-1"] },
      { revision: 2, fill_ids: ["open-1", "close-1"] },
    ]);

    const allocations = await database.query(`
      select cycle_revision, native_fill_id, allocation_quantity::text,
             allocation_role, sort_order, generation
      from public.trading_trade_cycle_fills
      where cycle_id = $1
      order by cycle_revision, sort_order
    `, [cycleOne]);
    assert.deepEqual(allocations.rows, [
      { cycle_revision: 1, native_fill_id: "open-1", allocation_quantity: "1.000000000000000000", allocation_role: "open", sort_order: 0, generation: 1 },
      { cycle_revision: 2, native_fill_id: "open-1", allocation_quantity: "1.000000000000000000", allocation_role: "open", sort_order: 0, generation: 2 },
      { cycle_revision: 2, native_fill_id: "close-1", allocation_quantity: "1.000000000000000000", allocation_role: "close", sort_order: 1, generation: 2 },
    ]);

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
        expectedGeneration: 2,
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
    assert.equal(Number(rolledBack.rows[0]?.sync_generation), 2);
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
        ) values ($1, 2, $2, $3, $4, 'alien-fill', 1, 'open', 9, 2)
      `, [cycleOne, ownerOne, connectionOne, alienFill.rows[0]?.id]),
      /trading_trade_cycle_fills_fill_owner_fkey/,
    );
  } finally {
    await database.close();
  }
});
