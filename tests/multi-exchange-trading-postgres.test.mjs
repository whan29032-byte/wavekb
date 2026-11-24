import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/202611240001_multi_exchange_trade_review.sql",
  import.meta.url,
);

const ownerOne = "11111111-1111-4111-8111-111111111111";
const ownerTwo = "22222222-2222-4222-8222-222222222222";
const connectionOne = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const connectionTwo = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const credentialTwo = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const workerOne = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const workerTwo = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const cycleOne = "ffffffff-ffff-4fff-8fff-ffffffffffff";

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
      label text not null default '币安 U 本位合约',
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
    insert into public.trading_equity_snapshots (
      connection_id, owner_id, captured_at, equity_usdt, wallet_balance_usdt,
      unrealized_pnl_usdt, net_external_flow_usdt, period_return
    ) values ('${connectionOne}', '${ownerOne}', now() - interval '5 minutes', 1100, 1050, 50, 0, 0.1);
    insert into public.trading_return_summaries (
      connection_id, owner_id, return_factor, sample_count, updated_at,
      current_equity_usdt, cumulative_profit_usdt
    ) values ('${connectionOne}', '${ownerOne}', 1.1, 2, now() - interval '5 minutes', 1100, 100);
  `);
}

async function migratedDatabase() {
  const database = new PGlite();
  await createLegacyDatabase(database);
  await database.exec(await fs.readFile(migrationUrl, "utf8"));
  return database;
}

test("legacy Binance data migrates in place and credentials remain shared until the last connection disconnects", async () => {
  const database = await migratedDatabase();
  try {
    const migrated = await database.query(`
      select id, provider, credential_set_id, equity_tracking_started_at,
             public_amounts_consented_at, external_account_id_hash
      from public.exchange_connections where id = '${connectionOne}'
    `);
    assert.equal(migrated.rows[0].id, connectionOne);
    assert.equal(migrated.rows[0].provider, "binance");
    assert.ok(migrated.rows[0].credential_set_id);
    assert.ok(migrated.rows[0].equity_tracking_started_at);
    assert.ok(migrated.rows[0].public_amounts_consented_at);
    assert.equal(migrated.rows[0].external_account_id_hash, null);

    const copiedSecret = await database.query(`
      select secret.ciphertext, secret.active
      from public.exchange_credential_secrets secret
      join public.exchange_credential_sets credentials on credentials.id = secret.credential_set_id
      where credentials.owner_id = '${ownerOne}'
    `);
    assert.deepEqual(copiedSecret.rows, [{ ciphertext: "cipher", active: true }]);

    const credentialSetId = migrated.rows[0].credential_set_id;
    await database.query(`
      insert into public.exchange_connections (
        id, owner_id, exchange, market, label, public_enabled, status,
        api_key_last_four, read_only_ack_at, started_at, provider,
        credential_set_id, account_label, account_identifier_mask,
        account_currency, capabilities, equity_tracking_started_at
      ) values (
        $1, $2, 'binance', 'usdm_futures', 'Second account', false, 'active',
        'EFGH', now(), now(), 'binance', $3, 'Second account', '••••EFGH',
        'USDT', '{}'::jsonb, now()
      )
    `, [connectionTwo, ownerOne, credentialSetId]);

    await database.query(
      "select public.rotate_exchange_credential_set($1, $2, $3, $4, $5, $6, $7)",
      [ownerOne, credentialSetId, "••••WXYZ", "cipher-rotated", "iv-rotated", "tag-rotated", 2],
    );
    const rotated = await database.query(`
      select ciphertext, active, key_version
      from public.exchange_credential_secrets
      where credential_set_id = $1 order by created_at, key_version
    `, [credentialSetId]);
    assert.equal(rotated.rows.filter((row) => row.active).length, 1);
    assert.equal(rotated.rows.at(-1).ciphertext, "cipher-rotated");
    assert.equal(rotated.rows.at(-1).key_version, 2);

    await database.query("select public.disconnect_exchange_connection_v3($1, $2)", [ownerOne, connectionOne]);
    let secret = await database.query(
      "select active from public.exchange_credential_secrets where credential_set_id = $1",
      [credentialSetId],
    );
    assert.equal(secret.rows.some((row) => row.active), true);
    await database.query("select public.disconnect_exchange_connection_v3($1, $2)", [ownerOne, connectionTwo]);
    secret = await database.query(
      "select active from public.exchange_credential_secrets where credential_set_id = $1",
      [credentialSetId],
    );
    assert.equal(secret.rows.some((row) => row.active), false);

    await database.exec(`
      insert into public.exchange_credential_sets (id, owner_id, provider, label, status)
      values ('${credentialTwo}', '${ownerTwo}', 'binance', 'Other owner', 'active');
      insert into public.exchange_connections (
        owner_id, exchange, market, label, public_enabled, status,
        api_key_last_four, read_only_ack_at, started_at, provider,
        credential_set_id, external_account_id_hash, account_label,
        account_identifier_mask, account_currency, capabilities,
        equity_tracking_started_at
      ) values (
        '${ownerOne}', 'binance', 'usdm_futures', 'Reconnected', false, 'active',
        'ABCD', now(), now(), 'binance', (select credential_set_id from public.exchange_connections where id = '${connectionOne}'),
        'same-account-hmac', 'Reconnected', '••••ABCD', 'USDT', '{}'::jsonb, now()
      );
    `);
    await assert.rejects(
      database.exec(`
        insert into public.exchange_connections (
          owner_id, exchange, market, label, public_enabled, status,
          api_key_last_four, read_only_ack_at, started_at, provider,
          credential_set_id, external_account_id_hash, account_label,
          account_identifier_mask, account_currency, capabilities,
          equity_tracking_started_at
        ) values (
          '${ownerTwo}', 'binance', 'usdm_futures', 'Duplicate external', false, 'active',
          'IJKL', now(), now(), 'binance', '${credentialTwo}', 'same-account-hmac',
          'Duplicate external', '••••IJKL', 'USDT', '{}'::jsonb, now()
        )
      `),
      /exchange_connections_provider_account_unique/,
    );
  } finally {
    await database.close();
  }
});

test("public leaderboard keeps its response shape and aggregates opted-in connections into one user row", async () => {
  const database = await migratedDatabase();
  try {
    const migrated = await database.query(
      "select credential_set_id from public.exchange_connections where id = $1",
      [connectionOne],
    );
    await database.query(`
      insert into public.exchange_connections (
        id, owner_id, exchange, market, label, public_enabled, status,
        api_key_last_four, read_only_ack_at, started_at, last_synced_at,
        public_amounts_consented_at, provider, credential_set_id,
        account_label, account_identifier_mask, account_currency,
        capabilities, equity_tracking_started_at, sync_status
      ) values (
        $1, $2, 'binance', 'usdm_futures', 'Second public account', true, 'active',
        'EFGH', now(), now() - interval '5 days', now() - interval '4 minutes',
        now() - interval '5 days', 'binance', $3, 'Second public account',
        '••••EFGH', 'USDT', '{}'::jsonb, now() - interval '5 days', 'idle'
      )
    `, [connectionTwo, ownerOne, migrated.rows[0].credential_set_id]);
    await database.query(`
      insert into public.trading_return_summaries (
        connection_id, owner_id, return_factor, sample_count, updated_at,
        current_equity_usdt, cumulative_profit_usdt
      ) values ($1, $2, 1.1, 2, now() - interval '4 minutes', 500, 50)
    `, [connectionTwo, ownerOne]);

    const leaderboard = await database.query(
      "select * from public.list_trading_leaderboard('realtime', 50) where user_id = $1",
      [ownerOne],
    );
    assert.equal(leaderboard.rows.length, 1);
    assert.equal(Number(leaderboard.rows[0].current_equity_usdt), 1600);
    assert.equal(Number(leaderboard.rows[0].cumulative_profit_usdt), 150);
    assert.deepEqual(Object.keys(leaderboard.rows[0]).sort(), [
      "avatar_url", "cumulative_profit_usdt", "current_equity_usdt", "display_name",
      "display_title", "last_synced_at", "nameplate_style", "public_uid", "rank_no",
      "return_rate", "tracking_started_at", "user_id",
    ].sort());
  } finally {
    await database.close();
  }
});

test("legacy Binance reconnect rotates the prior credential envelope instead of leaving two active secrets", async () => {
  const database = await migratedDatabase();
  try {
    const previous = await database.query(
      "select credential_set_id from public.exchange_connections where id = $1",
      [connectionOne],
    );
    await database.query(
      "select public.create_binance_exchange_connection_v2($1, 'Replacement', false, false, 'WXYZ', 'new-cipher', 'new-iv', 'new-tag', 1, now(), 900, 900, 0)",
      [ownerOne],
    );
    const oldSecret = await database.query(
      "select active from public.exchange_credential_secrets where credential_set_id = $1",
      [previous.rows[0].credential_set_id],
    );
    assert.equal(oldSecret.rows[0].active, false);
    const activeSecrets = await database.query(`
      select count(*)::integer as count
      from public.exchange_credential_secrets where owner_id = $1 and active
    `, [ownerOne]);
    assert.equal(activeSecrets.rows[0].count, 1);
  } finally {
    await database.close();
  }
});

test("atomic publication uses leases, generation compare-and-swap and idempotent native facts", async () => {
  const database = await migratedDatabase();
  try {
    const claimed = await database.query(
      "select public.claim_exchange_sync_connection($1, $2, now(), 120) as claimed",
      [connectionOne, workerOne],
    );
    assert.equal(claimed.rows[0].claimed, true);
    const blocked = await database.query(
      "select public.claim_exchange_sync_connection($1, $2, now(), 120) as claimed",
      [connectionOne, workerTwo],
    );
    assert.equal(blocked.rows[0].claimed, false);

    const snapshot = JSON.stringify({
      captured_at: "2026-11-24T08:00:00.000Z", account_currency: "USDT",
      equity: "1200", wallet_balance: "1150", unrealized_pnl: "50",
      usd_equity: "1200", usd_wallet_balance: "1150", usd_unrealized_pnl: "50",
      valuation_status: "approximate", valuation_rate: "1",
      valuation_source: "usdt_usd_approximation", valuation_path: ["USDT", "USD"],
      valuation_quoted_at: "2026-11-24T08:00:00.000Z",
    });
    const fills = JSON.stringify([{ native_fill_id: "fill-1", native_order_id: "order-1", native_position_id: null,
      symbol: "BTCUSDT", native_symbol: "BTCUSDT", product: "usdt_perpetual", side: "buy",
      position_side: "long", action: "open", price: "60000", quantity: "0.01",
      contract_multiplier: "1", occurred_at: "2026-11-24T07:00:00.000Z",
      realized_pnl: "0", realized_pnl_asset: "USDT", realized_pnl_usd: "0",
      fee: "-0.24", fee_asset: "USDT", fee_usd: "-0.24", liquidity: "taker" }]);
    const cashEvents = JSON.stringify([{ native_event_id: "event-1", native_type: "FUNDING_FEE", type: "funding",
      amount: "-0.12", asset: "USDT", usd_value: "-0.12", occurred_at: "2026-11-24T07:30:00.000Z",
      symbol: "BTCUSDT", native_position_id: null }]);
    const cycles = JSON.stringify([{ id: cycleOne, stable_key: "cycle-anchor-fill-1", revision: 1,
      fill_digest: "digest-1", product: "usdt_perpetual", symbol: "BTCUSDT", direction: "long",
      native_position_id: null, opened_at: "2026-11-24T07:00:00.000Z", closed_at: null,
      entry_price: "60000", exit_price: null, quantity: "0.01", realized_pnl: "0", fees: "-0.24",
      funding_or_swap: "-0.12", dividends: "0", net_pnl: "-0.36", account_currency: "USDT",
      usd_net_pnl: "-0.36", valuation_status: "approximate", completeness: "open", is_current: true }]);

    const publish = async (expectedGeneration) => database.query(`
      select public.publish_exchange_sync_generation(
        $1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb,
        '[]'::jsonb, '{"kind":"time","value":"next"}'::jsonb,
        '2026-11-01T00:00:00.000Z'::timestamptz
      ) as generation
    `, [connectionOne, ownerOne, expectedGeneration, snapshot, fills, cashEvents, cycles]);

    const first = await publish(0);
    assert.equal(Number(first.rows[0].generation), 1);
    await assert.rejects(publish(0), /stale_sync_generation/);
    const retry = await publish(1);
    assert.equal(Number(retry.rows[0].generation), 2);

    for (const table of ["trading_account_snapshots", "trading_fills", "trading_cash_events", "trading_trade_cycles"]) {
      const count = await database.query(`select count(*)::integer as count from public.${table}`);
      assert.equal(count.rows[0].count, 1, table);
    }
    await assert.rejects(
      database.exec(`
        insert into public.trading_fills (
          connection_id, owner_id, provider, native_fill_id, native_order_id,
          symbol, native_symbol, product, side, position_side, action,
          price, quantity, contract_multiplier, occurred_at, realized_pnl,
          realized_pnl_asset, fee, fee_asset, liquidity, generation
        ) values (
          '${connectionOne}', '${ownerTwo}', 'binance', 'wrong-owner', 'order',
          'BTCUSDT', 'BTCUSDT', 'usdt_perpetual', 'buy', 'long', 'open',
          1, 1, 1, now(), 0, 'USDT', 0, 'USDT', 'taker', 2
        )
      `),
      /trading_fills_connection_owner_fkey/,
    );

    await database.query(
      "select public.save_trading_trade_review($1, $2, 1, 'Breakout', 'yes', 'Wait for retest', array['discipline'], null, null)",
      [ownerOne, cycleOne],
    );
    const review = await database.query("select reason, plan_compliance from public.trading_trade_reviews");
    assert.deepEqual(review.rows, [{ reason: "Breakout", plan_compliance: "yes" }]);

    await database.exec("set role anon");
    await assert.rejects(database.query("select * from public.trading_fills"), /permission denied/);
    await database.exec("reset role");
  } finally {
    await database.close();
  }
});

test("deletion hides immediately, hard-deletes within 30 days and expires minimal audit after 90 days", async () => {
  const database = await migratedDatabase();
  try {
    const queued = await database.query(
      "select * from public.request_trading_data_deletion($1, $2)",
      [ownerOne, connectionOne],
    );
    assert.ok(queued.rows[0].hard_delete_after);
    assert.ok(Date.parse(queued.rows[0].hard_delete_after) <= Date.now() + 30 * 86_400_000 + 5_000);
    const hidden = await database.query(
      "select status, data_hidden_at from public.exchange_connections where id = $1",
      [connectionOne],
    );
    assert.equal(hidden.rows[0].status, "deleting");
    assert.ok(hidden.rows[0].data_hidden_at);

    await database.exec("update public.trading_delete_queue set hard_delete_after = now() - interval '1 second'");
    const purged = await database.query("select public.purge_due_trading_data(now()) as count");
    assert.equal(purged.rows[0].count, 1);
    const connectionCount = await database.query(
      "select count(*)::integer as count from public.exchange_connections where id = $1",
      [connectionOne],
    );
    assert.equal(connectionCount.rows[0].count, 0);

    const columns = await database.query(`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'trading_deletion_audit'
      order by column_name
    `);
    assert.deepEqual(columns.rows.map((row) => row.column_name), ["deleted_at", "expires_at", "id", "owner_id", "provider"]);
    await database.exec("update public.trading_deletion_audit set expires_at = now() - interval '1 second'");
    await database.query("select public.purge_due_trading_data(now())");
    const auditCount = await database.query("select count(*)::integer as count from public.trading_deletion_audit");
    assert.equal(auditCount.rows[0].count, 0);
  } finally {
    await database.close();
  }
});
