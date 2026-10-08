import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createCheckoutDatabase, checkoutIds, setCheckoutActor, submitCheckout } from "./helpers/mentor-checkout-database.mjs";
import { loadMentorNotificationConfig } from "../ai-gateway/src/mentor-notifications/config.ts";
import { MentorNotificationWorker } from "../ai-gateway/src/mentor-notifications/worker.ts";

const migration = await readFile(new URL("../supabase/migrations/202610080003_mentor_payment_notifications.sql", import.meta.url), "utf8");
const buyerId = "11111111-1111-4111-8111-111111111111";
const ownerId = "22222222-2222-4222-8222-222222222222";
const otherOwnerId = "33333333-3333-4333-8333-333333333333";
const mentorId = "44444444-4444-4444-8444-444444444444";
const offerId = "55555555-5555-4555-8555-555555555555";
const providerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const from = "WaveKB <notify@example.test>";
const manageUrl = "https://wavekb.example.test/mentor/manage";
const uuid = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;

async function fixture({ existingClaim = false } = {}) {
  const database = new PGlite();
  await database.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
    create table public.profiles (id uuid primary key);
    create table public.mentor_profiles (id uuid primary key, owner_id uuid references public.profiles(id));
    create table public.mentor_offers (id uuid primary key, mentor_id uuid, name text);
    create table public.mentor_orders (
      id uuid primary key, buyer_id uuid, mentor_id uuid, offer_id uuid,
      status text default 'pending', amount_cents integer, currency text, offer_name_snapshot text
    );
    create table public.mentor_payment_claims (
      id uuid primary key, order_id uuid unique references public.mentor_orders(id),
      buyer_id uuid, mentor_id uuid, status text default 'submitted',
      submitted_at timestamptz default now()
    );
    insert into public.profiles values ('${buyerId}'), ('${ownerId}'), ('${otherOwnerId}');
    insert into auth.users values
      ('${ownerId}', 'mentor@example.test', now()),
      ('${otherOwnerId}', 'other@example.test', now());
    insert into public.mentor_profiles values ('${mentorId}', '${ownerId}');
    insert into public.mentor_offers values ('${offerId}', '${mentorId}', '一对一辅导');
  `);
  if (existingClaim) await insertClaim(database);
  await database.exec(migration);
  return database;
}

async function insertClaim(database, number = 1, status = "submitted") {
  const orderId = uuid(1000 + number);
  const claimId = uuid(2000 + number);
  await database.query("insert into public.mentor_orders (id,buyer_id,mentor_id,offer_id,status,amount_cents,currency,offer_name_snapshot) values ($1,$2,$3,$4,'pending',12999,'USDT','购买时方案')", [orderId, buyerId, mentorId, offerId]);
  await database.query("insert into public.mentor_payment_claims (id,order_id,buyer_id,mentor_id,status) values ($1,$2,$3,$4,$5)", [claimId, orderId, buyerId, mentorId, status]);
  return { orderId, claimId };
}

async function claim(database, size = 5) {
  return (await database.query("select * from public.claim_mentor_payment_notifications($1)", [size])).rows;
}

async function prepare(database, job, sender = from, url = manageUrl) {
  return (await database.query("select public.prepare_mentor_payment_notification($1,$2,$3,$4) as value", [job.id, job.lease_token, sender, url])).rows[0].value;
}

async function finish(database, job, outcome, { provider = null, code = null, retryable = false } = {}) {
  return (await database.query("select public.finish_mentor_payment_notification($1,$2,$3,$4,$5,$6) as value", [job.id, job.lease_token, outcome, provider, code, retryable])).rows[0].value;
}

test("new claims queue atomically once; updates/retries and historical claims never send a new event", async () => {
  const database = await fixture({ existingClaim: true });
  try {
    assert.equal((await database.query("select count(*)::int as count from public.mentor_payment_notification_outbox")).rows[0].count, 0);
    const { claimId } = await insertClaim(database, 2);
    await database.query("update public.mentor_payment_claims set submitted_at=now() where id=$1", [claimId]);
    const rows = (await database.query("select claim_id,event_key,status,recipient_owner_id from public.mentor_payment_notification_outbox")).rows;
    assert.deepEqual(rows, [{ claim_id: claimId, event_key: `mentor-payment-claim:${claimId}`, status: "queued", recipient_owner_id: ownerId }]);
    await database.exec("begin;");
    await insertClaim(database, 3);
    await database.exec("rollback;");
    assert.equal((await database.query("select count(*)::int as count from public.mentor_payment_notification_outbox")).rows[0].count, 1);
    assert.equal((await database.query("select status from public.mentor_orders where id=$1", [uuid(1002)])).rows[0].status, "pending");
    assert.equal((await database.query("select public.wavekb_schema_version() as marker")).rows[0].marker, "202610080003");
  } finally { await database.close(); }
});

test("mail queue and every recipient RPC are private to service_role", async () => {
  const database = await fixture();
  try {
    await insertClaim(database);
    const privileges = (await database.query(`select
      has_table_privilege('anon','public.mentor_payment_notification_outbox','select') as anon_read,
      has_table_privilege('authenticated','public.mentor_payment_notification_outbox','select') as member_read,
      has_function_privilege('authenticated','public.claim_mentor_payment_notifications(integer)','execute') as member_claim,
      has_function_privilege('authenticated','public.prepare_mentor_payment_notification(uuid,uuid,text,text)','execute') as member_prepare,
      has_function_privilege('anon','public.finish_mentor_payment_notification(uuid,uuid,text,uuid,text,boolean,integer)','execute') as anon_finish,
      has_function_privilege('service_role','public.claim_mentor_payment_notifications(integer)','execute') as server_claim
    `)).rows[0];
    assert.deepEqual(privileges, { anon_read: false, member_read: false, member_claim: false, member_prepare: false, anon_finish: false, server_claim: true });
    await database.exec("set role authenticated;");
    await assert.rejects(database.query("select * from public.mentor_payment_notification_outbox"), /permission denied/);
    await assert.rejects(database.query("select * from public.claim_mentor_payment_notifications(5)"), /permission denied/);
    await database.exec("reset role; grant select on public.mentor_payment_notification_outbox to authenticated; set role authenticated;");
    assert.deepEqual((await database.query("select * from public.mentor_payment_notification_outbox")).rows, []);
    await database.exec("reset role; set role service_role;");
    assert.equal((await claim(database)).length, 1);
  } finally { await database.close(); }
});

test("bounded leased batches exclude active work, recover expired leases, and fence stale workers", async () => {
  const database = await fixture();
  try {
    for (let number = 1; number <= 6; number++) await insertClaim(database, number);
    const jobs = await claim(database, 100);
    assert.equal(jobs.length, 5);
    assert.equal((await claim(database)).length, 1);
    assert.equal((await claim(database)).length, 0);
    const first = jobs[0];
    await database.query("update public.mentor_payment_notification_outbox set locked_until=now()-interval '1 second' where id=$1", [first.id]);
    const recovered = (await claim(database))[0];
    assert.equal(recovered.id, first.id);
    assert.equal(recovered.attempts, 2);
    assert.notEqual(recovered.lease_token, first.lease_token);
    assert.deepEqual(await prepare(database, first), { state: "lease_lost" });
    assert.equal(await finish(database, first, "failed", { code: "provider_unavailable", retryable: true }), false);
    const result = await prepare(database, recovered);
    assert.equal(result.state, "ready");
    assert.deepEqual(result.payload.to, ["mentor@example.test"]);
    assert.match(result.payload.subject, /学员声明已付款，待核实/);
    assert.match(result.payload.text, /不代表平台已确认到账/);
    assert.match(result.payload.text, /购买时方案/);
    assert.match(result.payload.text, /https:\/\/wavekb\.example\.test\/mentor\/manage/);
    assert.equal(await finish(database, recovered, "accepted", { provider: providerId }), true);
    const accepted = (await database.query("select status,provider_message_id,provider_accepted_at from public.mentor_payment_notification_outbox where id=$1", [recovered.id])).rows[0];
    assert.equal(accepted.status, "accepted");
    assert.equal(accepted.provider_message_id, providerId);
    assert.ok(accepted.provider_accepted_at);
    assert.equal(await finish(database, recovered, "accepted", { provider: providerId }), false);
  } finally { await database.close(); }
});

test("recipients are confirmed auth users, missing ownership/email never rolls back the claim", async () => {
  const database = await fixture();
  try {
    await database.exec("update auth.users set email_confirmed_at=null;");
    await insertClaim(database);
    const job = (await claim(database))[0];
    assert.deepEqual(await prepare(database, job), { state: "unavailable", code: "recipient_unavailable" });
    assert.equal((await database.query("select count(*)::int as count from public.mentor_payment_claims")).rows[0].count, 1);
    await database.exec("update auth.users set email_confirmed_at=now();");
    await database.query("update public.mentor_profiles set owner_id=$1 where id=$2", [otherOwnerId, mentorId]);
    assert.deepEqual(await prepare(database, job), { state: "unavailable", code: "recipient_changed" });
    await database.exec("update public.mentor_profiles set owner_id=null;");
    await insertClaim(database, 2);
    const unbound = (await claim(database))[0];
    assert.deepEqual(await prepare(database, unbound), { state: "unavailable", code: "recipient_unavailable" });
    assert.equal((await database.query("select count(*)::int as count from public.mentor_payment_claims")).rows[0].count, 2);
  } finally { await database.close(); }
});

test("resolved claims skip mail; sealed payloads remain stable and cannot change recipient on retry", async () => {
  const database = await fixture();
  try {
    const { claimId } = await insertClaim(database);
    const job = (await claim(database))[0];
    const initial = await prepare(database, job);
    await database.exec("update public.mentor_offers set name='已修改的目录名称';");
    assert.deepEqual(await prepare(database, job, "Changed <new@example.test>", "https://new.example.test/mentor/manage"), initial);
    assert.match(initial.payload.text, /购买时方案/);
    assert.doesNotMatch(initial.payload.text, /已修改的目录名称/);
    await database.query("update auth.users set email='changed@example.test' where id=$1", [ownerId]);
    assert.deepEqual(await prepare(database, job), { state: "unavailable", code: "recipient_changed" });
    await database.query("update public.mentor_payment_claims set status='confirmed' where id=$1", [claimId]);
    assert.deepEqual(await prepare(database, job), { state: "skipped" });
    assert.equal((await database.query("select status from public.mentor_payment_notification_outbox where id=$1", [job.id])).rows[0].status, "skipped");
  } finally { await database.close(); }
});

test("retries use bounded exponential delays, exhaust safely, and do not outlive provider idempotency", async () => {
  const database = await fixture();
  try {
    await insertClaim(database);
    let job = (await claim(database))[0];
    await prepare(database, job);
    for (let attempt = 1; attempt <= 6; attempt++) {
      assert.equal(job.attempts, attempt);
      assert.equal(await finish(database, job, "failed", { code: "provider_unavailable", retryable: true }), true);
      const result = (await database.query("select status,attempts,extract(epoch from available_at-updated_at)::int as delay from public.mentor_payment_notification_outbox where id=$1", [job.id])).rows[0];
      assert.equal(result.delay, 30 * 2 ** (attempt - 1));
      assert.equal(result.status, attempt < 6 ? "waiting_retry" : "failed");
      if (attempt < 6) {
        await database.query("update public.mentor_payment_notification_outbox set available_at=now()-interval '1 second' where id=$1", [job.id]);
        job = (await claim(database))[0];
      }
    }
    assert.equal((await claim(database)).length, 0);
    await insertClaim(database, 2);
    const oldRequest = (await claim(database))[0];
    await prepare(database, oldRequest);
    await database.query("update public.mentor_payment_notification_outbox set first_request_at=now()-interval '24 hours' where id=$1", [oldRequest.id]);
    assert.deepEqual(await prepare(database, oldRequest), { state: "unavailable", code: "idempotency_window_expired" });
    await finish(database, oldRequest, "failed", { code: "private@example.test api-key-sensitive", retryable: false });
    assert.equal((await database.query("select last_error_code from public.mentor_payment_notification_outbox where id=$1", [oldRequest.id])).rows[0].last_error_code, "worker_request_failed");
  } finally { await database.close(); }
});

test("the complete manual checkout transaction queues once and provider failure never undoes the payment declaration", async () => {
  const database = await createCheckoutDatabase();
  try {
    await database.exec("alter table auth.users add column email text;");
    await database.query("update auth.users set email='checkout-mentor@example.test' where id=$1", [checkoutIds.owner]);
    await database.exec(migration);
    const first = await submitCheckout(database);
    const repeated = await submitCheckout(database);
    assert.deepEqual(repeated, first);
    const rows = (await database.query("select * from public.mentor_payment_notification_outbox")).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].claim_id, first.claim_id);
    assert.equal(rows[0].recipient_owner_id, checkoutIds.owner);
    assert.equal(rows[0].event_key, `mentor-payment-claim:${first.claim_id}`);
    await database.query("update public.mentor_offers set name='以后出售的新方案' where id=$1", [checkoutIds.offer]);
    const leased = (await claim(database))[0];
    const prepared = await prepare(database, leased);
    assert.deepEqual(prepared.payload.to, ["checkout-mentor@example.test"]);
    assert.match(prepared.payload.text, /30 天辅导/);
    assert.doesNotMatch(prepared.payload.text, /以后出售的新方案/);
    await finish(database, leased, "failed", { code: "provider_unauthorized" });
    assert.equal((await database.query("select status from public.mentor_payment_claims where id=$1", [first.claim_id])).rows[0].status, "submitted");
    assert.equal((await database.query("select status from public.mentor_orders where id=$1", [first.order_id])).rows[0].status, "pending");
    assert.equal((await database.query("select count(*)::int as count from public.mentor_entitlements")).rows[0].count, 0);
    await setCheckoutActor(database, checkoutIds.owner);
    const reviewed = (await database.query("select public.review_mentor_payment_claim($1,true) as thread", [first.claim_id])).rows[0];
    assert.ok(reviewed.thread);
    assert.equal((await database.query("select status from public.mentor_orders where id=$1", [first.order_id])).rows[0].status, "paid");
    assert.equal((await database.query("select count(*)::int as count from public.mentor_entitlements")).rows[0].count, 1);
  } finally { await database.close(); }
});

test("a declared order confirmed before dispatch is skipped using actual checkout/review functions", async () => {
  const database = await createCheckoutDatabase();
  try {
    await database.exec("alter table auth.users add column email text;");
    await database.query("update auth.users set email='checkout-mentor@example.test' where id=$1", [checkoutIds.owner]);
    await database.exec(migration);
    const receipt = await submitCheckout(database);
    const leased = (await claim(database))[0];
    await setCheckoutActor(database, checkoutIds.owner);
    await database.query("select public.review_mentor_payment_claim($1,true)", [receipt.claim_id]);
    assert.deepEqual(await prepare(database, leased), { state: "skipped" });
    assert.equal((await database.query("select status from public.mentor_payment_notification_outbox where id=$1", [leased.id])).rows[0].status, "skipped");
  } finally { await database.close(); }
});

test("remote Retry-After is honored but bounded; an exhausted crashed lease becomes failed", async () => {
  const database = await fixture();
  try {
    for (const [number, requested, expected] of [[1, 120, 120], [2, 999999, 1800]]) {
      await insertClaim(database, number);
      const leased = (await claim(database))[0];
      await database.query("select public.finish_mentor_payment_notification($1,$2,'failed',null,'provider_rate_limited',true,$3)", [leased.id, leased.lease_token, requested]);
      assert.equal((await database.query("select extract(epoch from available_at-updated_at)::int as delay from public.mentor_payment_notification_outbox where id=$1", [leased.id])).rows[0].delay, expected);
    }
    await insertClaim(database, 3);
    const exhausted = (await claim(database))[0];
    await database.query("update public.mentor_payment_notification_outbox set attempts=6,locked_until=now()-interval '1 second' where id=$1", [exhausted.id]);
    assert.equal((await claim(database)).length, 0);
    assert.deepEqual((await database.query("select status,last_error_code from public.mentor_payment_notification_outbox where id=$1", [exhausted.id])).rows[0], { status: "failed", last_error_code: "retry_exhausted" });
  } finally { await database.close(); }
});

test("worker crash after provider acceptance recovers with identical frozen payload/key and one provider action", async () => {
  const database = await fixture();
  try {
    await insertClaim(database);
    const notificationConfig = loadMentorNotificationConfig({
      MENTOR_EMAIL_ENABLED: "true", MENTOR_EMAIL_FROM: from, MENTOR_EMAIL_API_KEY: "test-only-mail-key",
      SUPABASE_URL: "https://database.example.test", SUPABASE_SERVICE_ROLE_KEY: "test-only-service-key",
      MENTOR_EMAIL_SITE_URL: "https://wavekb.example.test",
    });
    let acknowledgements = 0;
    let providerActions = 0;
    const requests = [];
    const acceptedByKey = new Map();
    const repository = {
      async claimBatch() {
        return (await claim(database)).map((row) => ({ id: row.id, leaseToken: row.lease_token, attempts: row.attempts, eventKey: row.event_key }));
      },
      async prepare(job, sender, url) { return prepare(database, { ...job, lease_token: job.leaseToken }, sender, url); },
      async finish(job, outcome) {
        if (++acknowledgements === 1) throw new Error("test-only lost database acknowledgement");
        return finish(database, { ...job, lease_token: job.leaseToken }, outcome.outcome, { provider: outcome.providerMessageId });
      },
    };
    const sender = { async send(envelope, key) {
      const encoded = JSON.stringify(envelope);
      requests.push({ encoded, key });
      if (acceptedByKey.has(key)) assert.equal(acceptedByKey.get(key), encoded);
      else { acceptedByKey.set(key, encoded); providerActions++; }
      return { providerMessageId: providerId };
    } };
    const worker = new MentorNotificationWorker(notificationConfig, { repository, sender, wait: async () => {} });
    assert.equal(await worker.pollOnce(), 1);
    assert.equal((await database.query("select status from public.mentor_payment_notification_outbox")).rows[0].status, "processing");
    await database.exec("update public.mentor_payment_notification_outbox set locked_until=now()-interval '1 second'; update public.mentor_offers set name='changed after first request';");
    const recoveredWorker = new MentorNotificationWorker(notificationConfig, { repository, sender });
    assert.equal(await recoveredWorker.pollOnce(), 1);
    assert.equal(providerActions, 1);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0], requests[1]);
    assert.deepEqual((await database.query("select status,attempts,provider_message_id from public.mentor_payment_notification_outbox")).rows[0], { status: "accepted", attempts: 2, provider_message_id: providerId });
  } finally { await database.close(); }
});
