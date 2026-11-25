import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/202611250001_discord_account_link.sql",
  import.meta.url,
);

const userOne = "11111111-1111-4111-8111-111111111111";
const userTwo = "22222222-2222-4222-8222-222222222222";

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
      public_uid integer,
      display_name text not null,
      avatar_url text,
      display_title text,
      nameplate_style text not null default 'classic',
      account_status text not null default 'active'
    );
    insert into auth.users (id) values ('${userOne}'), ('${userTwo}');
    insert into public.profiles (id, public_uid, display_name)
    values ('${userOne}', 10001, 'One'), ('${userTwo}', 10002, 'Two');
  `);
  await database.exec(await readFile(migrationUrl, "utf8"));
  return database;
}

async function asUser(database, userId) {
  await database.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
}

async function insertToken(database, {
  hash,
  discordUserId,
  guildId = "1545731927733047306",
  expiresAt = "2099-01-01T00:00:00Z",
}) {
  await database.query(
    `insert into public.discord_link_tokens
      (token_hash, discord_user_id, guild_id, expires_at)
     values ($1, $2, $3, $4)`,
    [hash, discordUserId, guildId, expiresAt],
  );
}

async function issueToken(database, {
  hash,
  discordUserId,
  guildId = "1545731927733047306",
}) {
  const result = await database.query(
    `select public.issue_discord_link_token($1, $2, $3) as expires_at`,
    [hash, discordUserId, guildId],
  );
  return result.rows[0].expires_at;
}

test("migration enforces private hashed single-use Discord link storage", async () => {
  const database = await createDatabase();
  try {
    const columns = await database.query(`
      select column_name from information_schema.columns
      where table_schema = 'public'
        and table_name = 'profiles'
        and column_name in ('discord_user_id', 'discord_linked_at')
      order by column_name
    `);
    assert.deepEqual(columns.rows.map((row) => row.column_name), [
      "discord_linked_at",
      "discord_user_id",
    ]);

    const table = await database.query(`
      select relrowsecurity from pg_class
      where oid = 'public.discord_link_tokens'::regclass
    `);
    assert.equal(table.rows[0].relrowsecurity, true);

    await assert.rejects(
      database.query(`insert into public.discord_link_tokens
        (token_hash, discord_user_id, guild_id, expires_at)
        values ('raw-token', '12345678901234567', '1545731927733047306', now() + interval '10 minutes')`),
      /discord_link_tokens_token_hash_check|check constraint/i,
    );

    await database.exec("set role anon");
    await assert.rejects(
      database.query("select public.redeem_discord_link_token($1)", ["a".repeat(64)]),
      /permission denied/i,
    );
  } finally {
    await database.close();
  }
});

test("redeem function atomically links the authenticated profile and rejects replay", async () => {
  const database = await createDatabase();
  const hash = "a".repeat(64);
  try {
    await insertToken(database, { hash, discordUserId: "111111111111111111" });
    await asUser(database, userOne);

    const redeemed = await database.query(
      "select public.redeem_discord_link_token($1) as result",
      [hash],
    );
    assert.deepEqual(redeemed.rows[0].result, {
      discord_user_id: "111111111111111111",
      public_uid: 10001,
    });

    const state = await database.query(`
      select p.discord_user_id, p.discord_linked_at is not null as linked,
             t.redeemed_by, t.redeemed_at is not null as redeemed
      from public.profiles p
      join public.discord_link_tokens t on t.token_hash = $1
      where p.id = $2
    `, [hash, userOne]);
    assert.deepEqual(state.rows[0], {
      discord_user_id: "111111111111111111",
      linked: true,
      redeemed_by: userOne,
      redeemed: true,
    });

    await assert.rejects(
      database.query("select public.redeem_discord_link_token($1)", [hash]),
      /discord_link_token_used/,
    );
  } finally {
    await database.close();
  }
});

test("redeem function rejects anonymous, expired, occupied and banned bindings", async () => {
  const database = await createDatabase();
  try {
    await insertToken(database, {
      hash: "b".repeat(64),
      discordUserId: "222222222222222222",
      expiresAt: "2000-01-01T00:00:00Z",
    });
    await asUser(database, userOne);
    await assert.rejects(
      database.query("select public.redeem_discord_link_token($1)", ["b".repeat(64)]),
      /discord_link_token_expired/,
    );

    await database.query(
      "update public.profiles set discord_user_id = $1, discord_linked_at = now() where id = $2",
      ["333333333333333333", userTwo],
    );
    await insertToken(database, {
      hash: "c".repeat(64),
      discordUserId: "333333333333333333",
    });
    await assert.rejects(
      database.query("select public.redeem_discord_link_token($1)", ["c".repeat(64)]),
      /discord_identity_already_linked/,
    );

    await database.query(
      "update public.profiles set account_status = 'banned' where id = $1",
      [userOne],
    );
    await insertToken(database, {
      hash: "d".repeat(64),
      discordUserId: "444444444444444444",
    });
    await assert.rejects(
      database.query("select public.redeem_discord_link_token($1)", ["d".repeat(64)]),
      /account_restricted/,
    );

    await asUser(database, "");
    await assert.rejects(
      database.query("select public.redeem_discord_link_token($1)", ["d".repeat(64)]),
      /authentication_required/,
    );
  } finally {
    await database.close();
  }
});

test("issue function is executable only by service_role and computes expiry in the database", async () => {
  const database = await createDatabase();
  try {
    for (const role of ["anon", "authenticated"]) {
      await database.exec(`set role ${role}`);
      await assert.rejects(
        issueToken(database, {
          hash: role === "anon" ? "e".repeat(64) : "f".repeat(64),
          discordUserId: role === "anon" ? "555555555555555555" : "666666666666666666",
        }),
        /permission denied/i,
      );
      await database.exec("reset role");
    }

    const before = Date.now();
    await database.exec("set role service_role");
    const expiresAt = await issueToken(database, {
      hash: "7".repeat(64),
      discordUserId: "777777777777777777",
    });
    await database.exec("reset role");
    const lifetime = new Date(expiresAt).getTime() - before;
    assert.ok(lifetime >= 9 * 60 * 1000 + 50 * 1000, `lifetime was ${lifetime}ms`);
    assert.ok(lifetime <= 10 * 60 * 1000 + 10 * 1000, `lifetime was ${lifetime}ms`);
  } finally {
    await database.close();
  }
});

test("concurrent issuance leaves only the latest token valid for one Discord identity", async () => {
  const database = await createDatabase();
  const hashes = ["8".repeat(64), "9".repeat(64)];
  const discordUserId = "888888888888888888";
  const completionOrder = [];
  try {
    await Promise.all(hashes.map(async (hash) => {
      await issueToken(database, { hash, discordUserId });
      completionOrder.push(hash);
    }));

    const issued = await database.query(`
      select token_hash, revoked_at is null as active
      from public.discord_link_tokens
      where discord_user_id = $1
      order by token_hash
    `, [discordUserId]);
    assert.equal(issued.rows.length, 2);
    assert.equal(issued.rows.filter((row) => row.active).length, 1);
    const activeHash = issued.rows.find((row) => row.active).token_hash;
    const revokedHash = issued.rows.find((row) => !row.active).token_hash;
    assert.equal(activeHash, completionOrder.at(-1));

    await asUser(database, userOne);
    await assert.rejects(
      database.query("select public.redeem_discord_link_token($1)", [revokedHash]),
      /discord_link_token_revoked/,
    );
    const redeemed = await database.query(
      "select public.redeem_discord_link_token($1) as result",
      [activeHash],
    );
    assert.equal(redeemed.rows[0].result.discord_user_id, discordUserId);
  } finally {
    await database.close();
  }
});

test("failed insertion rolls back revocation of the previously active token", async () => {
  const database = await createDatabase();
  const originalHash = "a1".repeat(32);
  const duplicateHash = "b2".repeat(32);
  const discordUserId = "999999999999999999";
  try {
    await issueToken(database, { hash: originalHash, discordUserId });
    await issueToken(database, {
      hash: duplicateHash,
      discordUserId: "101010101010101010",
    });

    await assert.rejects(
      issueToken(database, { hash: duplicateHash, discordUserId }),
      /duplicate key|unique constraint/i,
    );
    const original = await database.query(`
      select revoked_at, redeemed_at
      from public.discord_link_tokens
      where token_hash = $1
    `, [originalHash]);
    assert.deepEqual(original.rows[0], { revoked_at: null, redeemed_at: null });
  } finally {
    await database.close();
  }
});
