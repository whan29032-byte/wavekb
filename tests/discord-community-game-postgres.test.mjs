import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/202611250002_discord_community_game.sql",
  import.meta.url,
);

const users = {
  one: { id: "11111111-1111-4111-8111-111111111111", discord: "111111111111111111", name: "One" },
  two: { id: "22222222-2222-4222-8222-222222222222", discord: "222222222222222222", name: "Two" },
  three: { id: "33333333-3333-4333-8333-333333333333", discord: "333333333333333333", name: "Three" },
};

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create table public.profiles (
      id uuid primary key references auth.users(id),
      public_uid integer unique,
      display_name text not null,
      avatar_url text,
      display_title text,
      nameplate_style text not null default 'classic',
      account_status text not null default 'active',
      discord_user_id text unique
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
    create table public.reward_daily_checkins (
      user_id uuid not null references public.profiles(id) on delete cascade,
      checkin_date date not null,
      streak integer not null check (streak > 0),
      points integer not null check (points > 0),
      created_at timestamptz not null default now(),
      primary key (user_id, checkin_date)
    );
    create or replace function public.ensure_reward_wallet(p_user uuid)
    returns public.reward_wallets language plpgsql security definer set search_path=public as $$
    declare v_wallet public.reward_wallets%rowtype;
    begin
      insert into public.reward_wallets(user_id) values (p_user) on conflict do nothing;
      select * into v_wallet from public.reward_wallets where user_id = p_user;
      return v_wallet;
    end; $$;
    create or replace function public.award_reward_points(
      p_user uuid, p_action text, p_reference text, p_points integer, p_note text default ''
    ) returns jsonb language plpgsql security definer set search_path=public as $$
    declare v_id bigint; v_balance integer;
    begin
      perform public.ensure_reward_wallet(p_user);
      insert into public.reward_ledger(user_id,action_key,reference_key,points,note)
      values(p_user,p_action,p_reference,p_points,p_note)
      on conflict do nothing returning id into v_id;
      if v_id is null then
        select balance into v_balance from public.reward_wallets where user_id=p_user;
        return jsonb_build_object('awarded',false,'balance',v_balance);
      end if;
      update public.reward_wallets set balance=balance+p_points,
        lifetime_earned=lifetime_earned+p_points,updated_at=now()
      where user_id=p_user returning balance into v_balance;
      update public.reward_ledger set balance_after=v_balance where id=v_id;
      return jsonb_build_object('awarded',true,'points',p_points,'balance',v_balance);
    end; $$;
    create or replace function public.wavekb_schema_version() returns text
    language sql stable as $$ select '202611250001'::text $$;
    insert into auth.users(id) values
      ('${users.one.id}'), ('${users.two.id}'), ('${users.three.id}');
    insert into public.profiles(id,public_uid,display_name,discord_user_id) values
      ('${users.one.id}',10001,'${users.one.name}','${users.one.discord}'),
      ('${users.two.id}',10002,'${users.two.name}','${users.two.discord}'),
      ('${users.three.id}',10003,'${users.three.name}','${users.three.discord}');
    insert into public.reward_wallets(user_id,balance,lifetime_earned) values
      ('${users.one.id}',1000,1000), ('${users.two.id}',1000,1000), ('${users.three.id}',1000,1000);
  `);
  await database.exec(await readFile(migrationUrl, "utf8"));
  return database;
}

let requestSequence = 100000000000000000n;
function requestId() {
  requestSequence += 1n;
  return String(requestSequence);
}

async function action(database, user, actionName, payload, now, id = requestId()) {
  const result = await database.query(
    "select public.discord_game_action_at($1,$2,$3,$4::jsonb,$5::timestamptz) as value",
    [user.discord, id, actionName, JSON.stringify(payload), now],
  );
  return result.rows[0].value;
}

test("game migration exposes only the service-role RPC and advances the schema marker", async () => {
  const database = await createDatabase();
  try {
    const tables = await database.query(`
      select relname, relrowsecurity from pg_class
      where (relname like 'discord_game_%' or relname like 'discord_market_%')
        and relkind='r'
      order by relname
    `);
    assert.ok(tables.rows.length >= 10);
    assert.ok(tables.rows.every((row) => row.relrowsecurity));
    assert.equal(
      (await database.query("select public.wavekb_schema_version() as value")).rows[0].value,
      "202611250002",
    );

    await database.exec("set role anon");
    await assert.rejects(
      database.query("select public.discord_game_action($1,$2,$3,$4::jsonb)", [
        users.one.discord, requestId(), "status", "{}",
      ]),
      /permission denied/i,
    );
    await database.exec("reset role; set role service_role");
    const result = await database.query(
      "select public.discord_game_action($1,$2,$3,$4::jsonb) as value",
      [users.one.discord, requestId(), "status", "{}"],
    );
    assert.equal(result.rows[0].value.balance, 1000);
  } finally {
    await database.close();
  }
});

test("Discord and website share one daily check-in and request replay returns the original result", async () => {
  const database = await createDatabase();
  const now = "2026-11-25T00:00:00+08:00";
  const replayId = requestId();
  try {
    const first = await action(database, users.one, "daily_checkin", {}, now, replayId);
    assert.deepEqual(first, {
      action: "daily_checkin", awarded: true, balance: 1005, points: 5, streak: 1,
    });
    assert.deepEqual(
      await action(database, users.one, "daily_checkin", {}, now, replayId),
      first,
    );
    const second = await action(database, users.one, "daily_checkin", {}, now, requestId());
    assert.deepEqual(second, {
      action: "daily_checkin", awarded: false, balance: 1005, points: 5, streak: 1,
    });
    assert.equal(
      (await database.query("select count(*)::int as count from public.reward_ledger where user_id=$1", [users.one.id])).rows[0].count,
      1,
    );
  } finally {
    await database.close();
  }
});

test("work enforces four-hour cooldown and science/magic skill pity stays independent", async () => {
  const database = await createDatabase();
  try {
    const first = await action(database, users.one, "work", { path: "esper" }, "2026-11-25T08:00:00+08:00");
    assert.equal(first.action, "work");
    assert.equal(first.path, "esper");
    assert.ok(first.points >= 25 && first.points <= 60);
    await assert.rejects(
      action(database, users.one, "work", { path: "esper" }, "2026-11-25T11:59:59+08:00"),
      /work_cooldown/,
    );
    const second = await action(database, users.one, "work", { path: "magician" }, "2026-11-25T12:00:00+08:00");
    assert.equal(second.path, "magician");

    await database.query(`
      insert into public.discord_game_skill_pity(user_id,path,epic_pity,legendary_pity)
      values($1,'esper',9,49)
      on conflict(user_id,path) do update set epic_pity=9,legendary_pity=49
    `, [users.one.id]);
    await database.query(`
      insert into public.discord_game_skills(user_id,path,skill_key,skill_name,rarity,quantity)
      values
        ($1,'esper','vector_control','矢量操作','legendary',1),
        ($1,'esper','dark_matter','未元物质','legendary',1)
    `, [users.one.id]);
    const draw = await action(database, users.one, "skill_draw", { path: "esper", count: 1 }, "2026-11-25T12:01:00+08:00");
    assert.equal(draw.draws[0].rarity, "legendary");
    assert.equal(draw.draws[0].isNew, false);
    assert.equal(draw.draws[0].compensation, 250);
    assert.equal(draw.cost, 100);
    const magicPity = await database.query(
      "select epic_pity,legendary_pity from public.discord_game_skill_pity where user_id=$1 and path='magician'",
      [users.one.id],
    );
    assert.equal(magicPity.rows.length, 0);
  } finally {
    await database.close();
  }
});

test("egg purchase and hatch are atomic while free adoption is daily", async () => {
  const database = await createDatabase();
  const now = "2026-11-25T09:00:00+08:00";
  try {
    const bought = await action(database, users.one, "pet_buy_egg", {
      eggType: "route", quantity: 2, path: "esper",
    }, now);
    assert.deepEqual(bought, {
      action: "pet_buy_egg", balance: 300, cost: 700, eggType: "route", eggs: 2, quantity: 2,
    });
    const hatched = await action(database, users.one, "pet_hatch", {
      eggType: "route", quantity: 1, path: "esper",
    }, now);
    assert.equal(hatched.pets.length, 1);
    assert.equal(hatched.pets[0].route, "esper");
    assert.equal(hatched.eggsRemaining, 1);

    const adopted = await action(database, users.one, "pet_adopt", { path: "esper" }, now);
    assert.equal(adopted.action, "pet_adopt");
    assert.equal(adopted.pet.ownerUid, 10001);
    await assert.rejects(
      action(database, users.one, "pet_adopt", { path: "esper" }, "2026-11-25T23:00:00+08:00"),
      /pet_adoption_already_used/,
    );
  } finally {
    await database.close();
  }
});

test("market closes at 21:00, settles at 22:00, and pays only the correct direction once", async () => {
  const database = await createDatabase();
  try {
    const open = await action(database, users.one, "market_view", {}, "2026-11-25T20:59:59+08:00");
    assert.equal(open.phase, "open");
    assert.equal(open.symbols.length, 3);
    const up = await action(database, users.one, "market_bet", {
      symbol: "academy", direction: "up", stake: 100,
    }, "2026-11-25T20:59:59+08:00");
    const down = await action(database, users.two, "market_bet", {
      symbol: "academy", direction: "down", stake: 100,
    }, "2026-11-25T20:59:59+08:00");
    assert.equal(up.balance, 900);
    assert.equal(down.balance, 900);

    const closed = await action(database, users.one, "market_view", {}, "2026-11-25T21:00:00+08:00");
    assert.equal(closed.phase, "closed");
    assert.equal(closed.symbols[0].changeBps, null);
    await assert.rejects(
      action(database, users.three, "market_bet", {
        symbol: "academy", direction: "up", stake: 10,
      }, "2026-11-25T21:00:00+08:00"),
      /market_closed/,
    );

    const settled = await action(database, users.one, "market_view", {}, "2026-11-25T22:00:00+08:00");
    assert.equal(settled.phase, "settled");
    assert.notEqual(settled.symbols[0].changeBps, null);
    const balances = await database.query(
      "select user_id,balance from public.reward_wallets where user_id in ($1,$2) order by user_id",
      [users.one.id, users.two.id],
    );
    assert.deepEqual(balances.rows.map((row) => row.balance).sort((a, b) => a - b), [900, 1080]);
    await action(database, users.two, "market_view", {}, "2026-11-25T23:00:00+08:00");
    const payouts = await database.query(
      "select count(*)::int as count from public.reward_ledger where action_key='discord_market_payout'",
    );
    assert.equal(payouts.rows[0].count, 1);
  } finally {
    await database.close();
  }
});

test("marriage proposals are target-controlled and each member has at most one active marriage", async () => {
  const database = await createDatabase();
  const now = "2026-11-25T12:00:00+08:00";
  try {
    const proposal = await action(database, users.one, "marriage_propose", {
      targetDiscordUserId: users.two.discord,
    }, now);
    assert.equal(proposal.target.displayName, "Two");
    const competing = await action(database, users.three, "marriage_propose", {
      targetDiscordUserId: users.two.discord,
    }, now);
    await assert.rejects(
      action(database, users.three, "marriage_respond", {
        proposalId: proposal.proposalId, accept: true,
      }, now),
      /marriage_proposal_forbidden/,
    );
    const accepted = await action(database, users.two, "marriage_respond", {
      proposalId: proposal.proposalId, accept: true,
    }, now);
    assert.equal(accepted.accepted, true);
    assert.equal(accepted.partner.displayName, "One");
    const status = await action(database, users.one, "marriage_status", {}, now);
    assert.equal(status.active, true);
    assert.equal(status.partner.displayName, "Two");

    await assert.rejects(
      action(database, users.two, "marriage_respond", {
        proposalId: competing.proposalId, accept: true,
      }, now),
      /already_married/,
    );
    const divorced = await action(database, users.one, "marriage_divorce", {}, now);
    assert.equal(divorced.divorced, true);
    assert.equal((await action(database, users.two, "marriage_status", {}, now)).active, false);
  } finally {
    await database.close();
  }
});
