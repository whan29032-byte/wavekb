import assert from "node:assert/strict";
import test from "node:test";
import { checkoutIds as ids, checkoutMigration, createCheckoutDatabase, setCheckoutActor, submitCheckout } from "./helpers/mentor-checkout-database.mjs";

async function asRole(db, role, actor, run) {
  const previous = (await db.query("select auth.uid() as actor")).rows[0].actor;
  await setCheckoutActor(db, actor);
  await db.exec(`set role ${role}`);
  try { return await run(); } finally { await db.exec("reset role"); await setCheckoutActor(db, previous); }
}

async function baseDatabase() {
  const db = await createCheckoutDatabase();
  await db.exec(await checkoutMigration("202609090001_mentor_avatar_precedence.sql"));
  await db.exec(await checkoutMigration("202610100001_admin_payment_hardening.sql"));
  await db.exec(await checkoutMigration("202610220001_atomic_admin_mentor_publish.sql"));
  await db.exec(`grant usage on schema auth to anon,authenticated,service_role; update profiles set role='admin' where id='${ids.other}';`);
  return db;
}

async function migratedFixture(run) {
  const db = await baseDatabase();
  try {
    await db.exec(await checkoutMigration("202610220002_mentor_service_lifecycle.sql"));
    await run(db);
  } finally { await db.close(); }
}

async function paidThread(db) {
  await setCheckoutActor(db, ids.buyer);
  const receipt = await submitCheckout(db);
  const thread = await asRole(db, "authenticated", ids.owner, async () =>
    (await db.query("select review_mentor_payment_claim($1,true) as thread", [receipt.claim_id])).rows[0].thread);
  return { ...receipt, thread };
}

test("migration repairs only the deterministic paid/submitted mismatch and advances the marker", async () => {
  const db = await baseDatabase();
  try {
    const receipt = await submitCheckout(db);
    await asRole(db, "authenticated", ids.other, () => db.query(
      "select admin_transition_mentor_order($1,'pending','paid','verified before lifecycle migration')", [receipt.order_id],
    ));
    assert.equal((await db.query("select status from mentor_payment_claims where id=$1", [receipt.claim_id])).rows[0].status, "submitted");
    await db.exec(await checkoutMigration("202610220002_mentor_service_lifecycle.sql"));
    assert.equal((await db.query("select status from mentor_payment_claims where id=$1", [receipt.claim_id])).rows[0].status, "confirmed");
    assert.equal((await db.query("select wavekb_schema_version() as marker")).rows[0].marker, "202610220002");
  } finally { await db.close(); }
});

test("admin payment decisions synchronize declarations and rights in the same transaction", () => migratedFixture(async (db) => {
  const receipt = await submitCheckout(db);
  await asRole(db, "authenticated", ids.other, () => db.query(
    "select admin_transition_mentor_order($1,'pending','paid','bank receipt verified')", [receipt.order_id],
  ));
  assert.deepEqual((await db.query("select o.status as order_status,c.status as claim_status from mentor_orders o join mentor_payment_claims c on c.order_id=o.id where o.id=$1", [receipt.order_id])).rows[0], { order_status: "paid", claim_status: "confirmed" });
  assert.equal((await db.query("select count(*)::int as n from mentor_entitlements where order_id=$1", [receipt.order_id])).rows[0].n, 1);
  assert.equal((await db.query("select count(*)::int as n from mentor_threads")).rows[0].n, 1);
}));

test("unbound legacy orders can be cancelled only by their buyer after an explicit no-transfer confirmation", () => migratedFixture(async (db) => {
  await setCheckoutActor(db, ids.buyer);
  const legacy = (await db.query("select create_mentor_order($1) as id", [ids.offer])).rows[0].id;
  await assert.rejects(db.query("select cancel_unsubmitted_mentor_order($1,false)", [legacy]), /unpaid_confirmation_required/);
  await asRole(db, "authenticated", ids.other, async () => assert.rejects(db.query("select cancel_unsubmitted_mentor_order($1,true)", [legacy]), /order_access_denied/));
  await setCheckoutActor(db, ids.buyer);
  await db.query("select cancel_unsubmitted_mentor_order($1,true)", [legacy]);
  assert.equal((await db.query("select status from mentor_orders where id=$1", [legacy])).rows[0].status, "cancelled");
}));

test("mentor request, student confirmation and dispute resolution form an audited service lifecycle", () => migratedFixture(async (db) => {
  const first = await paidThread(db);
  await asRole(db, "authenticated", ids.buyer, async () => assert.rejects(db.query("select request_mentor_service_completion($1,'student cannot request')", [first.thread]), /thread_access_denied/));
  await asRole(db, "authenticated", ids.owner, () => db.query("select request_mentor_service_completion($1,'约定周期已完成')", [first.thread]));
  assert.equal((await db.query("select status from mentor_entitlements where order_id=$1", [first.order_id])).rows[0].status, "completion_requested");
  await asRole(db, "authenticated", ids.buyer, () => db.query("select send_mentor_message($1,'确认前补充最后一个问题')", [first.thread]));
  await asRole(db, "authenticated", ids.buyer, () => db.query("select respond_mentor_service_completion($1,true,'确认完成')", [first.thread]));
  assert.equal((await db.query("select status from mentor_entitlements where order_id=$1", [first.order_id])).rows[0].status, "completed");
  await asRole(db, "authenticated", ids.owner, async () => assert.rejects(db.query("select send_mentor_message($1,'服务完成后的回复')", [first.thread]), /tutoring_access_closed/));
  await setCheckoutActor(db, ids.buyer);
  assert.ok((await submitCheckout(db, ids.request2, "renew after confirmed completion")).order_id);
  assert.deepEqual((await db.query("select event from mentor_service_audit order by id")).rows.map((row) => row.event), ["completion_requested", "completion_confirmed"]);
}));

test("student disputes stay open for mentor replies until an administrator records a resolution", () => migratedFixture(async (db) => {
  const purchase = await paidThread(db);
  await asRole(db, "authenticated", ids.owner, () => db.query("select request_mentor_service_completion($1,'申请结束')", [purchase.thread]));
  await asRole(db, "authenticated", ids.buyer, () => db.query("select respond_mentor_service_completion($1,false,'仍有一个问题未回复')", [purchase.thread]));
  await asRole(db, "authenticated", ids.owner, () => db.query("select send_mentor_message($1,'补充完整回复说明')", [purchase.thread]));
  const entitlement = (await db.query("select id,status from mentor_entitlements where order_id=$1", [purchase.order_id])).rows[0];
  assert.equal(entitlement.status, "disputed");
  await setCheckoutActor(db, ids.buyer);
  await assert.rejects(submitCheckout(db, ids.request2, "duplicate while disputed"), /mentor_access_active/);
  await asRole(db, "authenticated", ids.other, () => db.query(
    "select admin_transition_mentor_service($1,'disputed','completed','双方补充说明后确认完成')", [entitlement.id],
  ));
  assert.equal((await db.query("select status from mentor_entitlements where id=$1", [entitlement.id])).rows[0].status, "completed");
  assert.equal((await db.query("select actor_role,event from mentor_service_audit order by id desc limit 1")).rows[0].actor_role, "admin");
}));

test("service RPC grants stay participant-scoped and closed to anonymous users", () => migratedFixture(async (db) => {
  const privileges = (await db.query("select has_function_privilege('authenticated','public.request_mentor_service_completion(uuid,text)','execute') as member, has_function_privilege('anon','public.request_mentor_service_completion(uuid,text)','execute') as anonymous, has_function_privilege('authenticated','public.admin_transition_mentor_service(uuid,text,text,text)','execute') as admin_entry")).rows[0];
  assert.deepEqual(privileges, { member: true, anonymous: false, admin_entry: true });
  await assert.rejects(asRole(db, "anon", null, () => db.query("select request_mentor_service_completion($1,'anonymous')", [ids.request])), /permission denied/);
}));
