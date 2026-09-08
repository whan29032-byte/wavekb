import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/202609080003_public_trading_amounts.sql",
  import.meta.url,
);

const ownerOne = "11111111-1111-4111-8111-111111111111";
const connectionOne = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ownerTwo = "22222222-2222-4222-8222-222222222222";
const connectionTwo = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ownerThree = "33333333-3333-4333-8333-333333333333";

const expectedPublicKeys = [
  "avatar_url",
  "cumulative_profit_usdt",
  "current_equity_usdt",
  "display_name",
  "display_title",
  "last_synced_at",
  "nameplate_style",
  "public_uid",
  "rank_no",
  "return_rate",
  "tracking_started_at",
  "user_id",
].sort();

async function createVersionTwoDatabase(database) {
  await database.exec(`
    create role anon;
    create role authenticated;
    create role service_role;

    create schema if not exists public;

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
      owner_id uuid not null references public.profiles(id),
      public_enabled boolean not null default true,
      status text not null default 'active',
      started_at timestamptz not null,
      last_synced_at timestamptz,
      last_error_code text not null default '',
      consecutive_failures integer not null default 0
    );

    create table public.trading_equity_snapshots (
      id bigint generated always as identity primary key,
      connection_id uuid not null references public.exchange_connections(id) on delete cascade,
      owner_id uuid not null references public.profiles(id) on delete cascade,
      captured_at timestamptz not null,
      equity_usdt numeric(30, 8) not null,
      wallet_balance_usdt numeric(30, 8) not null,
      unrealized_pnl_usdt numeric(30, 8) not null,
      net_external_flow_usdt numeric(30, 8) not null default 0,
      period_return numeric(20, 12),
      unique (connection_id, captured_at)
    );

    create table public.trading_return_summaries (
      connection_id uuid primary key references public.exchange_connections(id) on delete cascade,
      owner_id uuid not null references public.profiles(id) on delete cascade,
      return_factor numeric not null default 1,
      sample_count bigint not null default 0,
      updated_at timestamptz not null
    );

    create function public.create_binance_exchange_connection(
      p_owner_id uuid,
      p_label text,
      p_public_enabled boolean,
      p_api_key_last_four text,
      p_ciphertext text,
      p_iv text,
      p_auth_tag text,
      p_key_version integer,
      p_captured_at timestamptz,
      p_equity_usdt numeric,
      p_wallet_balance_usdt numeric,
      p_unrealized_pnl_usdt numeric
    )
    returns public.exchange_connections
    language plpgsql
    as $$
    declare
      connection public.exchange_connections;
    begin
      insert into public.exchange_connections (
        owner_id, public_enabled, status, started_at, last_synced_at
      ) values (
        p_owner_id, coalesce(p_public_enabled, true), 'active',
        p_captured_at, p_captured_at
      ) returning * into connection;
      insert into public.trading_equity_snapshots (
        connection_id, owner_id, captured_at, equity_usdt,
        wallet_balance_usdt, unrealized_pnl_usdt,
        net_external_flow_usdt, period_return
      ) values (
        connection.id, p_owner_id, p_captured_at, p_equity_usdt,
        p_wallet_balance_usdt, p_unrealized_pnl_usdt, 0, null
      );
      return connection;
    end;
    $$;

    create function public.list_trading_leaderboard(
      p_period text default 'realtime',
      p_limit integer default 50
    )
    returns table (
      rank_no bigint,
      user_id uuid,
      public_uid integer,
      display_name text,
      avatar_url text,
      display_title text,
      nameplate_style text,
      return_rate numeric,
      sample_count bigint,
      tracking_started_at timestamptz,
      last_synced_at timestamptz
    )
    language sql
    stable
    as $$ select null::bigint, null::uuid, null::integer, null::text,
      null::text, null::text, null::text, null::numeric, null::bigint,
      null::timestamptz, null::timestamptz where false $$;

    create function public.wavekb_schema_version()
    returns text language sql stable as $$ select '202609080002'::text $$;

    insert into public.profiles (id, public_uid, display_name)
    values ('${ownerOne}', 33333, 'Existing trader');

    insert into public.exchange_connections (
      id, owner_id, public_enabled, status, started_at, last_synced_at
    ) values (
      '${connectionOne}', '${ownerOne}', true, 'active',
      now() - interval '4 hours', now() - interval '1 hour'
    );

    insert into public.trading_equity_snapshots (
      connection_id, owner_id, captured_at, equity_usdt,
      wallet_balance_usdt, unrealized_pnl_usdt,
      net_external_flow_usdt, period_return
    ) values
      ('${connectionOne}', '${ownerOne}', now() - interval '4 hours', 1000, 1000, 0, 0, null),
      ('${connectionOne}', '${ownerOne}', now() - interval '3 hours', 1500, 1500, 0, 500, 0),
      ('${connectionOne}', '${ownerOne}', now() - interval '2 hours', 1600, 1600, 0, 0, 0.066666666667),
      ('${connectionOne}', '${ownerOne}', now() - interval '1 hour', 1470, 1470, 0, -200, 0.04375);

    insert into public.trading_return_summaries (
      connection_id, owner_id, return_factor, sample_count, updated_at
    ) values (
      '${connectionOne}', '${ownerOne}',
      1.066666666667 * 1.04375, 4, now() - interval '1 hour'
    );
  `);
}

test("schema 003 backfills and incrementally maintains public equity and cumulative profit", async () => {
  const database = new PGlite();
  try {
    await createVersionTwoDatabase(database);
    await database.exec(await fs.readFile(migrationUrl, "utf8"));

    const awaitingConsent = await database.query(
      "select * from public.list_trading_leaderboard('realtime', 50)",
    );
    assert.equal(awaitingConsent.rows.length, 0);
    await database.query(
      "select public.set_exchange_connection_public_amounts($1, $2, true, true)",
      [ownerOne, connectionOne],
    );
    const existing = await database.query(
      "select * from public.list_trading_leaderboard('realtime', 50)",
    );
    assert.equal(existing.rows.length, 1);
    assert.deepEqual(Object.keys(existing.rows[0]).sort(), expectedPublicKeys);
    assert.equal(Number(existing.rows[0].current_equity_usdt), 1470);
    assert.equal(Number(existing.rows[0].cumulative_profit_usdt), 170);
    assert.equal(typeof existing.rows[0].current_equity_usdt, "string");
    assert.equal(typeof existing.rows[0].cumulative_profit_usdt, "string");
    assert.ok(Math.abs(Number(existing.rows[0].return_rate) - 0.113333333334) < 1e-9);

    await database.exec(`
      insert into public.profiles (id, public_uid, display_name)
      values ('${ownerThree}', 55555, 'Versioned trader')
    `);
    await assert.rejects(
      database.query(
        "select public.create_binance_exchange_connection_v2($1, 'Test', true, false, 'ABCD', 'cipher', 'iv', 'tag', 1, now(), 500, 500, 0)",
        [ownerThree],
      ),
      /public amounts consent required/,
    );
    await database.query(
      "select public.create_binance_exchange_connection_v2($1, 'Test', true, true, 'ABCD', 'cipher', 'iv', 'tag', 1, now(), 500, 500, 0)",
      [ownerThree],
    );
    const versionedConnection = await database.query(`
      select public_enabled, public_amounts_consented_at
      from public.exchange_connections
      where owner_id = '${ownerThree}'
    `);
    assert.equal(versionedConnection.rows[0].public_enabled, true);
    assert.ok(versionedConnection.rows[0].public_amounts_consented_at);

    await database.exec(`
      insert into public.profiles (id, public_uid, display_name)
      values ('${ownerTwo}', 44444, 'New trader');
      insert into public.exchange_connections (
        id, owner_id, public_enabled, status, started_at, last_synced_at,
        public_amounts_consented_at
      ) values (
        '${connectionTwo}', '${ownerTwo}', true, 'active',
        now() - interval '4 hours', now() - interval '1 hour', now()
      );
      insert into public.trading_equity_snapshots (
        connection_id, owner_id, captured_at, equity_usdt,
        wallet_balance_usdt, unrealized_pnl_usdt,
        net_external_flow_usdt, period_return
      ) values
        ('${connectionTwo}', '${ownerTwo}', now() - interval '4 hours', 1000, 1000, 0, 0, null),
        ('${connectionTwo}', '${ownerTwo}', now() - interval '3 hours', 1500, 1500, 0, 500, 0),
        ('${connectionTwo}', '${ownerTwo}', now() - interval '2 hours', 1600, 1600, 0, 0, 0.066666666667),
        ('${connectionTwo}', '${ownerTwo}', now() - interval '1 hour', 1470, 1470, 0, -200, 0.04375);
    `);

    const summaries = await database.query(`
      select connection_id, current_equity_usdt, cumulative_profit_usdt,
             return_factor - 1 as return_rate, sample_count
      from public.trading_return_summaries
      where connection_id in ('${connectionOne}', '${connectionTwo}')
      order by connection_id
    `);
    assert.equal(summaries.rows.length, 2);
    for (const summary of summaries.rows) {
      assert.equal(Number(summary.current_equity_usdt), 1470);
      assert.equal(Number(summary.cumulative_profit_usdt), 170);
      assert.equal(Number(summary.sample_count), 4);
      assert.ok(Math.abs(Number(summary.return_rate) - 0.113333333334) < 1e-9);
    }

    await assert.rejects(
      database.exec(`
        insert into public.trading_equity_snapshots (
          connection_id, owner_id, captured_at, equity_usdt,
          wallet_balance_usdt, unrealized_pnl_usdt,
          net_external_flow_usdt, period_return
        ) values (
          '${connectionTwo}', '${ownerTwo}', now() - interval '5 hours',
          900, 900, 0, 0, 0
        )
      `),
      /stale exchange snapshot/,
    );
    const unchanged = await database.query(`
      select current_equity_usdt, cumulative_profit_usdt, sample_count
      from public.trading_return_summaries
      where connection_id = '${connectionTwo}'
    `);
    assert.equal(Number(unchanged.rows[0].current_equity_usdt), 1470);
    assert.equal(Number(unchanged.rows[0].cumulative_profit_usdt), 170);
    assert.equal(Number(unchanged.rows[0].sample_count), 4);

    const version = await database.query("select public.wavekb_schema_version() as version");
    assert.equal(version.rows[0].version, "202609080003");
  } finally {
    await database.close();
  }
});

test("schema 003 keeps private, stale, disabled and accounting-error accounts out of the public RPC", async () => {
  const database = new PGlite();
  try {
    await createVersionTwoDatabase(database);
    await database.exec(await fs.readFile(migrationUrl, "utf8"));
    await database.query(
      "select public.set_exchange_connection_public_amounts($1, $2, true, true)",
      [ownerOne, connectionOne],
    );

    for (const mutation of [
      "public_enabled = false",
      "status = 'disabled'",
      "last_synced_at = now() - interval '7 hours'",
      "status = 'error', last_error_code = 'exchange_sync_gap_too_large'",
    ]) {
      await database.exec(`update public.exchange_connections set ${mutation} where id = '${connectionOne}'`);
      const hidden = await database.query(
        "select * from public.list_trading_leaderboard('realtime', 50)",
      );
      assert.equal(hidden.rows.length, 0, mutation);
      await database.exec(`
        update public.exchange_connections
        set public_enabled = true, status = 'active',
            last_synced_at = now() - interval '1 hour', last_error_code = ''
        where id = '${connectionOne}'
      `);
    }

    await database.query(
      "select public.record_exchange_sync_failure($1, $2, $3)",
      [connectionOne, ownerOne, "binance_transfer_asset_not_supported"],
    );
    await database.query(
      "select public.record_exchange_sync_failure($1, $2, $3)",
      [connectionOne, ownerOne, "binance_unavailable"],
    );
    const stickyFailure = await database.query(`
      select last_error_code, consecutive_failures
      from public.exchange_connections
      where id = '${connectionOne}'
    `);
    assert.equal(stickyFailure.rows[0].last_error_code, "binance_transfer_asset_not_supported");
    assert.equal(stickyFailure.rows[0].consecutive_failures, 2);
  } finally {
    await database.close();
  }
});
