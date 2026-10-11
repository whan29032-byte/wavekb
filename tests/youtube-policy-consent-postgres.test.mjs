import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { youtubeIds as ids, youtubeSecret as secret, beginYouTubeOAuth as legacyBegin, connectYouTube as legacyConnect, createYouTubeDatabase } from "./helpers/youtube-sync-database.mjs";

const policyVersion = "2026-10-11-youtube-v1";
const migrations = new URL("../supabase/migrations/", import.meta.url);
const migrationFiles = (await readdir(migrations)).filter(name => /^\d+_youtube_policy_consent\.sql$/.test(name));
assert.equal(migrationFiles.length, 1, "one policy consent migration must exist");
const migration = await readFile(new URL(migrationFiles[0], migrations), "utf8");

async function fixture(run, beforeMigration) {
  const db = await createYouTubeDatabase();
  try {
    // Supabase's server service role bypasses RLS; browser roles still have no
    // grants. Match that role shape when verifying private audit read access.
    await db.exec("alter role service_role bypassrls");
    const previous = beforeMigration ? await beforeMigration(db) : undefined;
    await db.exec(migration);
    await run(db, previous);
  } finally { await db.close(); }
}
async function count(db, table) { return (await db.query(`select count(*)::int as n from ${table}`)).rows[0].n; }
async function begin(db, { owner = ids.owner, hash = "a".repeat(64), history = false, autoSync = false, accepted = true, version = policyVersion } = {}) {
  return (await db.query("select youtube_begin_oauth($1,$2,$3::jsonb,$4,$5,$6,$7) as id", [owner, hash, JSON.stringify(secret), history, autoSync, accepted, version])).rows[0].id;
}
async function complete(db, state, owner = ids.owner, channel = ids.channel, refreshSecret = secret) {
  return (await db.query("select youtube_complete_oauth($1,$2,$3,'政策验收频道','UUaaaaaaaaaaaaaaaaaaaaaa',$4::jsonb) as connection", [owner, state, channel, JSON.stringify(refreshSecret)])).rows[0].connection;
}
async function connect(db, options = {}) {
  const owner = options.owner ?? ids.owner, hash = options.hash ?? "a".repeat(64);
  const state = await begin(db, { ...options, owner, hash });
  await db.query("select youtube_consume_oauth($1,$2)", [owner, hash]);
  return { state, connection: await complete(db, state, owner, options.channel ?? ids.channel) };
}

test("SQL rejects missing, false and outdated policy consent before changing existing OAuth state", () => fixture(async db => {
  const prior = await begin(db);
  for (const consent of [{ accepted: false }, { accepted: null }, { version: null }, { version: "2026-10-10-youtube-v0" }, { version: "" }]) {
    await assert.rejects(begin(db, { hash: "b".repeat(64), ...consent }), /youtube_policy_consent_required/);
    assert.equal((await db.query("select id from youtube_oauth_states")).rows[0].id, prior);
  }
  await assert.rejects(legacyBegin(db), /youtube_policy_consent_required/);
  assert.equal(await count(db, "youtube_oauth_states"), 1);
  assert.equal(await count(db, "youtube_connections"), 0);
}));

test("SQL atomically records server consent time and transfers the same receipt on owner-bound completion", () => fixture(async db => {
  const state = await begin(db, { history: true, autoSync: false });
  const pending = (await db.query("select owner_id,privacy_terms_policy_version,privacy_terms_accepted_at,import_history,auto_sync,privacy_terms_accepted_at<=now() and privacy_terms_accepted_at>now()-interval '1 minute' as server_time from youtube_oauth_states where id=$1", [state])).rows[0];
  assert.equal(pending.owner_id, ids.owner);
  assert.equal(pending.privacy_terms_policy_version, policyVersion);
  assert.equal(pending.server_time, true);
  assert.equal(pending.import_history, true); assert.equal(pending.auto_sync, false);
  await assert.rejects(db.query("select youtube_consume_oauth($1,$2)", [ids.other, "a".repeat(64)]), /youtube_state_invalid/);
  await assert.rejects(complete(db, state, ids.other), /youtube_state_invalid/);
  assert.equal(await count(db, "youtube_connections"), 0);
  await db.query("select youtube_consume_oauth($1,$2)", [ids.owner, "a".repeat(64)]);
  const view = await complete(db, state);
  assert.equal(view.importHistory, true); assert.equal(view.syncEnabled, false);
  assert.ok(!JSON.stringify(view).includes("privacy_terms"));
  const stored = (await db.query("select c.owner_id,c.privacy_terms_policy_version,c.privacy_terms_accepted_at=s.privacy_terms_accepted_at as same_receipt,s.completed_at is not null as completed from youtube_connections c join youtube_oauth_states s on s.owner_id=c.owner_id where s.id=$1", [state])).rows[0];
  assert.deepEqual(stored, { owner_id: ids.owner, privacy_terms_policy_version: policyVersion, same_receipt: true, completed: true });
  await assert.rejects(complete(db, state), /youtube_state_invalid/);
}));

test("SQL refuses pre-migration OAuth states without fabricating consent or exchanging ownership", () => fixture(async (db, oldState) => {
  const row = (await db.query("select privacy_terms_policy_version,privacy_terms_accepted_at from youtube_oauth_states where id=$1", [oldState])).rows[0];
  assert.deepEqual(row, { privacy_terms_policy_version: null, privacy_terms_accepted_at: null });
  await assert.rejects(db.query("select youtube_consume_oauth($1,$2)", [ids.owner, "a".repeat(64)]), /youtube_policy_consent_required/);
  await db.exec("update youtube_oauth_states set consumed_at=now()");
  await assert.rejects(complete(db, oldState), /youtube_policy_consent_required/);
  assert.equal(await count(db, "youtube_connections"), 0);
}, db => legacyBegin(db)));

test("SQL completion failure rolls back consent, connection, secrets and state completion together", () => fixture(async db => {
  const state = await begin(db);
  await db.query("select youtube_consume_oauth($1,$2)", [ids.owner, "a".repeat(64)]);
  await assert.rejects(complete(db, state, ids.owner, ids.channel, { ...secret, key_version: 2 }), /check constraint/);
  assert.equal(await count(db, "youtube_connections"), 0);
  assert.equal(await count(db, "youtube_connection_secrets"), 0);
  assert.equal((await db.query("select completed_at from youtube_oauth_states where id=$1", [state])).rows[0].completed_at, null);
  assert.equal((await complete(db, state)).channelId, ids.channel);
}));

test("SQL keeps account eligibility and one-owner channel binding rules with current policy consent", () => fixture(async db => {
  await connect(db);
  await assert.rejects(connect(db, { owner: ids.other, hash: "b".repeat(64), channel: ids.channel }), /youtube_channel_already_bound/);
  await assert.rejects(connect(db, { channel: ids.otherChannel }), /youtube_already_connected/);
  for (const restriction of ["muted_until=now()+interval '1 day'", "account_status='banned'", "public_uid=null"]) {
    await db.exec(`update profiles set ${restriction} where id='${ids.owner}'`);
    await assert.rejects(begin(db), /youtube_account_ineligible/);
    await db.exec(`update profiles set muted_until=null,account_status='active',public_uid=11111 where id='${ids.owner}'`);
  }
  await db.exec(`update auth.users set email_confirmed_at=null where id='${ids.owner}'`);
  await assert.rejects(begin(db), /youtube_account_ineligible/);
  assert.equal(await count(db, "youtube_connections"), 1);
}));

test("browser roles cannot read, forge or submit consent; only service role can use the new begin RPC", () => fixture(async db => {
  await connect(db);
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    for (const table of ["youtube_connections", "youtube_oauth_states"]) {
      await assert.rejects(db.query(`select privacy_terms_policy_version,privacy_terms_accepted_at from ${table}`), /permission denied/);
      await assert.rejects(db.query(`update ${table} set privacy_terms_policy_version=$1,privacy_terms_accepted_at=now()`, [policyVersion]), /permission denied/);
    }
    await assert.rejects(begin(db), /permission denied/);
    await assert.rejects(legacyBegin(db), /permission denied/);
    await db.exec("reset role");
  }
  const rls = (await db.query("select relname,relrowsecurity from pg_class where oid in('public.youtube_connections'::regclass,'public.youtube_oauth_states'::regclass) order by relname")).rows;
  assert.ok(rls.every(row => row.relrowsecurity));
  await db.exec("set role service_role");
  for (const table of ["youtube_connections", "youtube_oauth_states"]) {
    assert.equal((await db.query(`select privacy_terms_policy_version from ${table}`)).rows[0].privacy_terms_policy_version, policyVersion);
  }
  await assert.rejects(legacyBegin(db), /permission denied/);
  assert.ok(await begin(db));
  await db.exec("reset role");
}));

test("legacy connections retain null consent while settings, history restart and disconnect remain usable", () => fixture(async (db, previous) => {
  const row = (await db.query("select privacy_terms_policy_version,privacy_terms_accepted_at,sync_enabled,import_history from youtube_connections where id=$1", [previous.id])).rows[0];
  assert.deepEqual(row, { privacy_terms_policy_version: null, privacy_terms_accepted_at: null, sync_enabled: false, import_history: false });
  assert.equal((await db.query("select youtube_get_connection($1) as v", [ids.other])).rows[0].v, null);
  assert.equal((await db.query("select youtube_settings($1,true,false) as v", [ids.owner])).rows[0].v.syncEnabled, true);
  const history = (await db.query("select youtube_settings($1,false,true) as v", [ids.owner])).rows[0].v;
  assert.equal(history.syncEnabled, false); assert.equal(history.historyStatus, "pending");
  const receipt = (await db.query("select youtube_disconnect($1,true) as v", [ids.owner])).rows[0].v;
  assert.equal(receipt.disconnected, true); assert.equal(receipt.remoteRevocationPending, true);
  assert.equal(await count(db, "youtube_connection_secrets"), 0);
  assert.equal(await count(db, "youtube_oauth_states"), 0);
  await assert.rejects(begin(db), /youtube_revocation_pending/);
  await db.query("select youtube_complete_revocation($1,null)", [receipt.revocationId]);
  assert.equal((await db.query("select youtube_get_connection($1) as v", [ids.owner])).rows[0].v, null);
  const rebound = await connect(db);
  assert.equal(rebound.connection.syncEnabled, false); assert.equal(rebound.connection.importHistory, false);
  assert.equal((await db.query("select privacy_terms_policy_version from youtube_connections where id=$1", [previous.id])).rows[0].privacy_terms_policy_version, policyVersion);
}, db => legacyConnect(db, ids.owner, ids.channel, false, false)));

test("policy receipt columns require a complete pair and expose the new schema marker", () => fixture(async db => {
  await begin(db);
  await assert.rejects(db.exec("update youtube_oauth_states set privacy_terms_accepted_at=null"), /check constraint/);
  await assert.rejects(db.exec("update youtube_oauth_states set privacy_terms_policy_version='old-policy'"), /check constraint/);
  assert.equal((await db.query("select wavekb_schema_version() as marker")).rows[0].marker, migrationFiles[0].split("_")[0]);
}));
