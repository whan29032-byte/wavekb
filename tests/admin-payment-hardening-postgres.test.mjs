import assert from "node:assert/strict";
import test from "node:test";
import { checkoutIds as ids, checkoutMigration, createCheckoutDatabase, setCheckoutActor, submitCheckout } from "./helpers/mentor-checkout-database.mjs";

async function fixture(run) {
  const db = await createCheckoutDatabase();
  try {
    await db.exec(await checkoutMigration("202610100001_admin_payment_hardening.sql"));
    await db.exec(`grant usage on schema auth to anon,authenticated,service_role;
      update profiles set role='admin' where id='${ids.other}';`);
    await run(db);
  } finally { await db.close(); }
}

async function asRole(db, role, actor, run) {
  const previous = (await db.query("select auth.uid() as actor")).rows[0].actor;
  await setCheckoutActor(db, actor);
  await db.exec(`set role ${role}`);
  try { return await run(); } finally { await db.exec("reset role"); await setCheckoutActor(db, previous); }
}

const transition = async (db, order, before, after, reason = "verified test decision") =>
  (await db.query("select admin_transition_mentor_order($1,$2,$3,$4) as result", [order, before, after, reason])).rows[0].result;

async function hostedOrder(db) {
  await setCheckoutActor(db, ids.buyer);
  const order = (await db.query("select create_mentor_order($1) as id", [ids.offer])).rows[0].id;
  await asRole(db, "service_role", null, () => db.query("select register_mentor_checkout_session($1,$2,'cs_test_hardening')", [ids.buyer, order]));
  return order;
}

const payment = async (db, order, event = "evt_test_paid", overrides = {}) => {
  const value = { type: "checkout.session.completed", session: "cs_test_hardening", amount: 10000, currency: "USDT", status: "paid", ...overrides };
  return (await db.query("select apply_verified_mentor_payment_event($1,$2,$3,$4,$5,$6,$7) as result", [event, value.type, order, value.session, value.amount, value.currency, value.status])).rows[0].result;
};

test("active-admin helpers reject banned administrators and ordinary members in actual database calls", () => fixture(async (db) => {
  assert.deepEqual(await asRole(db, "authenticated", ids.other, async () => (await db.query("select is_admin() as admin,mentor_is_admin() as mentor_admin")).rows[0]), { admin: true, mentor_admin: true });
  await db.exec(`update profiles set account_status='banned' where id='${ids.other}'`);
  assert.deepEqual(await asRole(db, "authenticated", ids.other, async () => (await db.query("select is_admin() as admin,mentor_is_admin() as mentor_admin")).rows[0]), { admin: false, mentor_admin: false });
  assert.equal((await asRole(db, "anon", null, () => db.query("select is_admin() as admin"))).rows[0].admin, false);
  const order = (await submitCheckout(db)).order_id;
  await assert.rejects(asRole(db, "authenticated", ids.other, () => transition(db, order, "pending", "paid")), /admin_required/);
  await assert.rejects(asRole(db, "authenticated", ids.buyer, () => transition(db, order, "pending", "paid")), /admin_required/);
  await assert.rejects(asRole(db, "authenticated", ids.other, () => db.query("insert into mentor_profiles(id,display_name) values($1,'banned admin catalog write')", [ids.request2])), /row-level security/);
  await assert.rejects(asRole(db, "authenticated", ids.buyer, () => db.query("insert into mentor_profiles(id,display_name) values($1,'ordinary member catalog write')", [ids.request2])), /row-level security/);
  assert.equal((await db.query("select status from mentor_orders where id=$1", [order])).rows[0].status, "pending");
}));

test("browser table writes cannot bypass the audited admin order transaction", () => fixture(async (db) => {
  const { order_id: order } = await submitCheckout(db);
  await assert.rejects(asRole(db, "authenticated", ids.other, () => db.query("update mentor_orders set status='paid' where id=$1", [order])), /permission denied/);
  assert.deepEqual(await asRole(db, "authenticated", ids.other, () => transition(db, order, "pending", "paid")), { id: order, status: "paid" });
  await assert.rejects(asRole(db, "authenticated", ids.other, () => transition(db, order, "pending", "cancelled")), /order_changed_concurrently/);
  await asRole(db, "authenticated", ids.other, () => transition(db, order, "paid", "refunded", "Refund approved after verification"));
  await assert.rejects(asRole(db, "authenticated", ids.other, () => transition(db, order, "refunded", "paid")), /order_transition_invalid/);
  await assert.rejects(db.query("update mentor_orders set amount_cents=1 where id=$1", [order]), /order_terms_immutable/);
  const audit = (await db.query("select actor_id,source,reason,after_state->>'status' as status from mentor_order_audit order by id")).rows;
  assert.equal(audit.length, 2);
  assert.equal(audit[0].actor_id, ids.other);
  assert.equal(audit[1].source, "admin");
  assert.equal(audit[1].reason, "Refund approved after verification");
  assert.equal((await db.query("select status from mentor_entitlements where order_id=$1", [order])).rows[0].status, "refunded");
  assert.equal((await asRole(db, "authenticated", ids.buyer, () => db.query("select * from mentor_order_audit"))).rows.length, 0);
  await db.exec(`update profiles set account_status='banned' where id='${ids.other}'`);
  assert.equal((await asRole(db, "authenticated", ids.other, () => db.query("select * from mentor_order_audit"))).rows.length, 0);
}));

test("ordinary mentor confirmation preserves manual quotes, retry IDs and rights, while auditing the transition", () => fixture(async (db) => {
  const receipt = await submitCheckout(db);
  await asRole(db, "authenticated", ids.owner, () => db.query("select review_mentor_payment_claim($1,true)", [receipt.claim_id]));
  await setCheckoutActor(db, ids.buyer);
  assert.deepEqual(await submitCheckout(db), receipt);
  assert.equal((await db.query("select count(*)::int as n from mentor_entitlements")).rows[0].n, 1);
  assert.equal((await db.query("select source from mentor_order_audit")).rows[0].source, "member");
}));

test("service-only session and event RPCs cannot be called by browser users", () => fixture(async (db) => {
  const order = await hostedOrder(db);
  await assert.rejects(asRole(db, "authenticated", ids.other, () => payment(db, order)), /permission denied/);
  await assert.rejects(asRole(db, "anon", null, () => payment(db, order)), /permission denied/);
  await assert.rejects(asRole(db, "authenticated", ids.buyer, () => db.query("select register_mentor_checkout_session($1,$2,'cs_other')", [ids.buyer, order])), /permission denied/);
  await assert.rejects(asRole(db, "service_role", null, () => db.query("select register_mentor_checkout_session($1,$2,'cs_other')", [ids.owner, order])), /order_access_denied/);
  await assert.rejects(asRole(db, "service_role", null, () => db.query("select register_mentor_checkout_session($1,$2,'cs_other')", [ids.buyer, order])), /order_payment_route_invalid/);
}));

test("manual purchases cannot be converted to Stripe and hosted-session registration rejects banned buyers", () => fixture(async (db) => {
  const manual = (await submitCheckout(db)).order_id;
  await assert.rejects(asRole(db, "service_role", null, () => db.query("select register_mentor_checkout_session($1,$2,'cs_test')", [ids.buyer, manual])), /order_payment_route_invalid/);
  await db.exec(`update profiles set account_status='banned' where id='${ids.buyer}'`);
  await assert.rejects(asRole(db, "service_role", null, () => db.query("select register_mentor_checkout_session($1,$2,'cs_test')", [ids.buyer, manual])), /account_ineligible/);
}));

test("unpaid completed events do not grant rights, and later verified paid events apply exactly once", () => fixture(async (db) => {
  const order = await hostedOrder(db);
  await asRole(db, "service_role", null, async () => {
    assert.equal((await payment(db, order, "evt_unpaid", { status: "unpaid" })).outcome, "ignored_unpaid");
    assert.equal((await payment(db, order, "evt_async", { type: "checkout.session.async_payment_succeeded" })).applied, true);
    assert.equal((await payment(db, order, "evt_async", { type: "checkout.session.async_payment_succeeded" })).duplicate, true);
  });
  assert.equal((await db.query("select count(*)::int as n from mentor_entitlements")).rows[0].n, 1);
  assert.equal((await db.query("select count(*)::int as n from mentor_order_audit")).rows[0].n, 1);
}));

test("amount, currency and session mismatches fail before event or rights persistence", () => fixture(async (db) => {
  const order = await hostedOrder(db);
  await asRole(db, "service_role", null, async () => {
    await assert.rejects(payment(db, order, "evt_bad_amount", { amount: 1 }), /payment_amount_mismatch/);
    await assert.rejects(payment(db, order, "evt_bad_currency", { currency: "USD" }), /payment_amount_mismatch/);
    await assert.rejects(payment(db, order, "evt_bad_session", { session: "cs_other" }), /order_payment_route_invalid/);
  });
  assert.equal((await db.query("select count(*)::int as n from mentor_payment_events")).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int as n from mentor_entitlements")).rows[0].n, 0);
}));

test("paid/expired event replay cannot reverse refunds", () => fixture(async (db) => {
  const order = await hostedOrder(db);
  await asRole(db, "service_role", null, () => payment(db, order));
  await asRole(db, "authenticated", ids.other, () => transition(db, order, "paid", "refunded"));
  await asRole(db, "service_role", null, async () => {
    assert.equal((await payment(db, order)).duplicate, true);
    assert.equal((await payment(db, order, "evt_paid_again")).applied, false);
    assert.equal((await payment(db, order, "evt_expired", { type: "checkout.session.expired", amount: null })).applied, false);
  });
  assert.equal((await db.query("select status from mentor_orders where id=$1", [order])).rows[0].status, "refunded");
  assert.equal((await db.query("select status from mentor_entitlements where order_id=$1", [order])).rows[0].status, "refunded");
  assert.equal((await db.query("select count(*)::int as n from mentor_order_audit")).rows[0].n, 2);
}));

test("cancelled hosted orders remain terminal even for fresh verified-paid events and direct service updates", () => fixture(async (db) => {
  const order = await hostedOrder(db);
  await asRole(db, "authenticated", ids.other, () => transition(db, order, "pending", "cancelled"));
  assert.equal((await asRole(db, "service_role", null, () => payment(db, order, "evt_cancelled_late"))).applied, false);
  await assert.rejects(db.query("update mentor_orders set status='paid',paid_at=now() where id=$1", [order]), /order_transition_invalid/);
  assert.equal((await db.query("select status from mentor_orders where id=$1", [order])).rows[0].status, "cancelled");
  assert.equal((await db.query("select count(*)::int as n from mentor_entitlements")).rows[0].n, 0);
}));

test("parallel duplicate event requests settle as one applied event and one rights activation", () => fixture(async (db) => {
  const order = await hostedOrder(db);
  await asRole(db, "service_role", null, async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => payment(db, order, "evt_parallel")));
    assert.equal(results.filter((result) => result.applied).length, 1);
    assert.equal(results.filter((result) => result.duplicate).length, 7);
  });
  assert.equal((await db.query("select count(*)::int as n from mentor_payment_events")).rows[0].n, 1);
  assert.equal((await db.query("select count(*)::int as n from mentor_entitlements")).rows[0].n, 1);
  assert.equal((await db.query("select count(*)::int as n from mentor_threads")).rows[0].n, 1);
  assert.equal((await db.query("select count(*)::int as n from mentor_order_audit")).rows[0].n, 1);
}));

test("a failed rights write rolls back the event and order so a provider retry can recover", () => fixture(async (db) => {
  const order = await hostedOrder(db);
  await db.exec("create function fail_test_rights() returns trigger language plpgsql as $$ begin raise exception 'test rights failure'; end $$; create trigger fail_test_rights before insert on mentor_entitlements for each row execute function fail_test_rights();");
  await assert.rejects(asRole(db, "service_role", null, () => payment(db, order)), /test rights failure/);
  assert.equal((await db.query("select count(*)::int as n from mentor_payment_events")).rows[0].n, 0);
  assert.equal((await db.query("select status from mentor_orders where id=$1", [order])).rows[0].status, "pending");
  await db.exec("drop trigger fail_test_rights on mentor_entitlements");
  assert.equal((await asRole(db, "service_role", null, () => payment(db, order))).applied, true);
}));
