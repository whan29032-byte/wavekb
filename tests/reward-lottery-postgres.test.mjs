import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL("../supabase/migrations/202609090002_reward_lottery.sql", import.meta.url);
const manualFulfillmentMigrationUrl = new URL("../supabase/migrations/202609100001_reward_lottery_manual_fulfillment.sql", import.meta.url);
const adminId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const userOne = "11111111-1111-4111-8111-111111111111";
const userTwo = "22222222-2222-4222-8222-222222222222";
const bannedUser = "33333333-3333-4333-8333-333333333333";
const noUidUser = "44444444-4444-4444-8444-444444444444";

function value(row) {
  const result = row.value;
  return typeof result === "string" ? JSON.parse(result) : result;
}

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create schema extensions;

    create function auth.uid()
    returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

    create function extensions.gen_random_bytes(p_length integer)
    returns bytea language sql volatile
    as $$ select decode(repeat('01', p_length), 'hex') $$;

    create table public.profiles (
      id uuid primary key,
      public_uid integer,
      account_status text not null default 'active'
    );

    create table public.reward_wallets (
      user_id uuid primary key references public.profiles(id) on delete cascade,
      balance integer not null default 0 check (balance >= 0),
      lifetime_earned integer not null default 0 check (lifetime_earned >= 0),
      updated_at timestamptz not null default now()
    );

    create table public.reward_ledger (
      id bigint generated always as identity primary key,
      user_id uuid not null references public.profiles(id) on delete cascade,
      action_key text not null,
      reference_key text not null,
      points integer not null check (points <> 0),
      balance_after integer not null default 0,
      note text not null default '',
      created_at timestamptz not null default now(),
      unique (user_id, action_key, reference_key)
    );

    create function public.mentor_is_admin()
    returns boolean language sql stable
    as $$ select coalesce(nullif(current_setting('app.is_admin', true), ''), 'false')::boolean $$;

    create function public.wavekb_schema_version()
    returns text language sql stable
    as $$ select '202609090001'::text $$;

    insert into public.profiles(id, public_uid, account_status) values
      ('${adminId}', 90001, 'active'),
      ('${userOne}', 10001, 'active'),
      ('${userTwo}', 10002, 'active'),
      ('${bannedUser}', 10003, 'banned'),
      ('${noUidUser}', null, 'active');

    insert into public.reward_wallets(user_id, balance, lifetime_earned) values
      ('${userOne}', 1000, 1000),
      ('${userTwo}', 1000, 1000),
      ('${bannedUser}', 1000, 1000),
      ('${noUidUser}', 1000, 1000);
  `);
  await database.exec(await readFile(migrationUrl, "utf8"));
  await database.exec(await readFile(manualFulfillmentMigrationUrl, "utf8"));
  return database;
}

async function actor(database, userId, admin = false) {
  await database.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await database.query("select set_config('app.is_admin', $1, false)", [admin ? "true" : "false"]);
}

async function createCampaign(database, {
  title = "九月研究抽奖",
  cost = 100,
  startsAt = "2026-09-09T00:00:00.000Z",
  endsAt = "2026-09-30T00:00:00.000Z",
} = {}) {
  const result = await database.query(
    "select public.admin_upsert_reward_lottery_campaign(null, $1, '完成研究任务后参与一次。', null, $2, $3, $4) as value",
    [title, cost, startsAt, endsAt],
  );
  return result.rows[0].value;
}

async function createPrize(database, campaignId, {
  name = "研究积分 50",
  probability = 10000,
  stock = 10,
  fulfillment = "manual",
  rewardPoints = null,
  sortOrder = 10,
} = {}) {
  const result = await database.query(
    "select public.admin_upsert_reward_lottery_prize(null, $1, $2, '独立抽奖奖品', null, $3, $4, $5, $6, $7) as value",
    [campaignId, name, probability, stock, fulfillment, rewardPoints, sortOrder],
  );
  return result.rows[0].value;
}

async function activate(database, campaignId) {
  await database.query("select public.admin_set_reward_lottery_campaign_status($1, 'active')", [campaignId]);
}

async function setBucket(database, bucket) {
  await database.exec(`
    create or replace function public.reward_lottery_random_bucket()
    returns integer language sql volatile security definer set search_path = ''
    as $$ select ${bucket}::integer $$;
  `);
}

async function draw(database, userId, campaignId, requestId) {
  await actor(database, userId, false);
  const result = await database.query(
    "select public.draw_reward_lottery($1, $2) as value",
    [campaignId, requestId],
  );
  return value(result.rows[0]);
}

test("manual prizes debit once, stay pending, and retries return the immutable draw", async () => {
  const database = await createDatabase();
  try {
    await actor(database, adminId, true);
    const campaignId = await createCampaign(database);
    await createPrize(database, campaignId);
    await activate(database, campaignId);
    await setBucket(database, 0);

    const first = await draw(database, userOne, campaignId, "10101010-1010-4010-8010-101010101010");
    const retry = await draw(database, userOne, campaignId, "20202020-2020-4020-8020-202020202020");

    assert.equal(first.outcome, "won");
    assert.equal(first.prize.fulfillment_type, "manual");
    assert.equal(first.fulfillment_status, "pending");
    assert.equal(first.balance, 900);
    assert.equal(retry.draw_id, first.draw_id);
    const wallet = await database.query("select balance, lifetime_earned from public.reward_wallets where user_id = $1", [userOne]);
    assert.deepEqual(wallet.rows[0], { balance: 900, lifetime_earned: 1000 });
    const ledger = await database.query("select action_key, points, balance_after from public.reward_ledger where user_id = $1 order by id", [userOne]);
    assert.deepEqual(ledger.rows, [
      { action_key: "lottery_entry", points: -100, balance_after: 900 },
    ]);
    const draws = await database.query("select count(*)::integer as count from public.reward_lottery_draws where campaign_id = $1 and user_id = $2", [campaignId, userOne]);
    assert.equal(draws.rows[0].count, 1);

    const marker = await database.query("select public.wavekb_schema_version() as version");
    assert.equal(marker.rows[0].version, "202609100001");
    const privileges = await database.query("select has_function_privilege('authenticated', 'public.draw_reward_lottery(uuid, uuid)', 'execute') as member, has_function_privilege('anon', 'public.draw_reward_lottery(uuid, uuid)', 'execute') as anonymous");
    assert.deepEqual(privileges.rows[0], { member: true, anonymous: false });
  } finally {
    await database.close();
  }
});

test("a depleted prize range becomes no-prize without increasing other odds", async () => {
  const database = await createDatabase();
  try {
    await actor(database, adminId, true);
    const campaignId = await createCampaign(database);
    const prizeId = await createPrize(database, campaignId, { name: "人工研究权益", probability: 10000, stock: 1, fulfillment: "manual", rewardPoints: null });
    await activate(database, campaignId);
    await setBucket(database, 0);

    const winner = await draw(database, userOne, campaignId, "30303030-3030-4030-8030-303030303030");
    const miss = await draw(database, userTwo, campaignId, "40404040-4040-4040-8040-404040404040");

    assert.equal(winner.outcome, "won");
    assert.equal(winner.prize.id, prizeId);
    assert.equal(winner.fulfillment_status, "pending");
    assert.equal(miss.outcome, "miss");
    assert.equal(miss.prize, null);
    assert.equal(miss.balance, 900);

    await actor(database, userTwo, false);
    const stateResult = await database.query("select public.get_my_reward_lottery() as value");
    const state = value(stateResult.rows[0]);
    assert.equal(state.effective_miss_probability_bps, 10000);
    assert.equal(state.prizes[0].stock_remaining, 0);
  } finally {
    await database.close();
  }
});

test("ineligible accounts and insufficient balances cannot create partial draws", async () => {
  const database = await createDatabase();
  try {
    await actor(database, adminId, true);
    const campaignId = await createCampaign(database, { cost: 1100 });
    await createPrize(database, campaignId);
    await activate(database, campaignId);
    await setBucket(database, 0);

    await assert.rejects(draw(database, bannedUser, campaignId, "50505050-5050-4050-8050-505050505050"), /lottery_account_ineligible/);
    await assert.rejects(draw(database, noUidUser, campaignId, "60606060-6060-4060-8060-606060606060"), /lottery_account_ineligible/);
    await assert.rejects(draw(database, userOne, campaignId, "70707070-7070-4070-8070-707070707070"), /lottery_balance_insufficient/);

    const state = await database.query("select balance from public.reward_wallets where user_id = $1", [userOne]);
    assert.equal(state.rows[0].balance, 1000);
    const draws = await database.query("select count(*)::integer as count from public.reward_lottery_draws");
    assert.equal(draws.rows[0].count, 0);
    const ledger = await database.query("select count(*)::integer as count from public.reward_ledger");
    assert.equal(ledger.rows[0].count, 0);

    await database.query("delete from public.reward_wallets where user_id = $1", [userTwo]);
    await actor(database, userTwo, false);
    const emptyWalletResult = await database.query("select public.get_my_reward_lottery() as value");
    const emptyWalletState = value(emptyWalletResult.rows[0]);
    assert.equal(emptyWalletState.balance, 0);
    assert.equal(emptyWalletState.eligible, false);
    assert.equal(emptyWalletState.eligibility_reason, "insufficient_balance");
  } finally {
    await database.close();
  }
});

test("only administrators can configure a valid single active campaign", async () => {
  const database = await createDatabase();
  try {
    await actor(database, userOne, false);
    await assert.rejects(createCampaign(database), /admin_required/);

    await actor(database, adminId, true);
    const manualOnlyCampaign = await createCampaign(database, { title: "仅人工发放" });
    await assert.rejects(
      createPrize(database, manualOnlyCampaign, { fulfillment: "points", rewardPoints: 50 }),
      /manual_fulfillment|lottery_prize_invalid/,
    );

    const invalidCampaign = await createCampaign(database, { title: "无效概率活动" });
    await createPrize(database, invalidCampaign, { name: "奖品 A", probability: 6000 });
    await createPrize(database, invalidCampaign, { name: "奖品 B", probability: 5000, sortOrder: 20 });
    await assert.rejects(activate(database, invalidCampaign), /lottery_configuration_invalid/);

    const activeCampaign = await createCampaign(database, { title: "当前活动" });
    await createPrize(database, activeCampaign, { probability: 5000 });
    await activate(database, activeCampaign);

    const secondCampaign = await createCampaign(database, { title: "下一活动" });
    await createPrize(database, secondCampaign, { probability: 5000 });
    await assert.rejects(activate(database, secondCampaign), /lottery_campaign_conflict/);

    const active = await database.query("select count(*)::integer as count from public.reward_lottery_campaigns where status = 'active'");
    assert.equal(active.rows[0].count, 1);
  } finally {
    await database.close();
  }
});
