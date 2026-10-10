import assert from "node:assert/strict";
import test from "node:test";
import { checkoutIds as ids, checkoutMigration, createCheckoutDatabase, setCheckoutActor, submitCheckout } from "./helpers/mentor-checkout-database.mjs";

async function fixture(run) {
  const database = await createCheckoutDatabase();
  try {
    await database.exec(await checkoutMigration("202610100001_admin_payment_hardening.sql"));
    await run(database);
  } finally { await database.close(); }
}

test("atomic checkout preserves one order, declaration and timestamp across lost-response retries", () => fixture(async (db) => {
  const first = await submitCheckout(db);
  const before = (await db.query("select submitted_at,buyer_note from mentor_payment_claims where id=$1", [first.claim_id])).rows[0];
  assert.deepEqual(await submitCheckout(db), first);
  assert.equal((await db.query("select count(*)::int as count from mentor_orders")).rows[0].count, 1);
  assert.equal((await db.query("select count(*)::int as count from mentor_payment_claims")).rows[0].count, 1);
  assert.deepEqual((await db.query("select submitted_at,buyer_note from mentor_payment_claims where id=$1", [first.claim_id])).rows[0], before);
  await assert.rejects(submitCheckout(db, ids.request, "changed note"), /request_conflict/);
}));

test("a second request cannot create duplicate pending work for the same mentor", () => fixture(async (db) => {
  await submitCheckout(db);
  await assert.rejects(submitCheckout(db, ids.request2), /checkout_pending_exists/);
  assert.equal((await db.query("select count(*)::int as count from mentor_orders")).rows[0].count, 1);
}));

test("checkout transaction rolls back its order if declaration persistence fails", () => fixture(async (db) => {
  await db.exec("create function reject_test_claim() returns trigger language plpgsql as $$ begin raise exception 'test claim write rejected'; end $$; create trigger reject_test_claim before insert on mentor_payment_claims for each row execute function reject_test_claim();");
  await assert.rejects(submitCheckout(db), /test claim write rejected/);
  assert.equal((await db.query("select count(*)::int as count from mentor_orders")).rows[0].count, 0);
}));

test("anonymous, banned, unverified and unactivated buyers cannot submit", () => fixture(async (db) => {
  await setCheckoutActor(db, null);
  await assert.rejects(submitCheckout(db), /authentication_required/);
  await setCheckoutActor(db, ids.buyer);
  await db.exec(`update profiles set account_status='banned' where id='${ids.buyer}'`);
  await assert.rejects(submitCheckout(db), /account_ineligible/);
  await db.exec(`update profiles set account_status='active', public_uid=null where id='${ids.buyer}'`);
  await assert.rejects(submitCheckout(db), /account_ineligible/);
  await db.exec(`update profiles set public_uid=11111 where id='${ids.buyer}'; update auth.users set email_confirmed_at=null where id='${ids.buyer}'`);
  await assert.rejects(submitCheckout(db), /account_ineligible/);
  assert.equal((await db.query("select count(*)::int as count from mentor_orders")).rows[0].count, 0);
}));

test("inactive mentor and cross-mentor payment method are rejected before order creation", () => fixture(async (db) => {
  await db.exec(`update mentor_profiles set active=false where id='${ids.mentor}'`);
  await assert.rejects(submitCheckout(db), /mentor_unavailable/);
  await assert.rejects(db.query("select create_manual_mentor_order($1,$2)", [ids.offer, ids.method]), /mentor_unavailable/);
  await db.exec(`update mentor_profiles set active=true where id='${ids.mentor}'; insert into mentor_profiles(id,owner_id,display_name,active) values('${ids.other}',null,'其他导师',true); update mentor_payment_methods set mentor_id='${ids.other}' where id='${ids.method}'`);
  await assert.rejects(submitCheckout(db), /payment_method_unavailable/);
}));

test("legacy create and submit calls reuse pending rows without refreshing the declaration", () => fixture(async (db) => {
  const create = async () => (await db.query("select create_manual_mentor_order($1,$2) as id", [ids.offer, ids.method])).rows[0].id;
  const order = await create();
  assert.equal(await create(), order);
  const first = (await db.query("select submit_mentor_payment_claim($1,'original') as id", [order])).rows[0].id;
  const before = (await db.query("select submitted_at,buyer_note from mentor_payment_claims where id=$1", [first])).rows[0];
  assert.equal((await db.query("select submit_mentor_payment_claim($1,'retry') as id", [order])).rows[0].id, first);
  assert.deepEqual((await db.query("select submitted_at,buyer_note from mentor_payment_claims where id=$1", [first])).rows[0], before);
}));

test("legacy unclaimed orders can be resumed by their buyer without creating another order", () => fixture(async (db) => {
  const order = (await db.query("select create_manual_mentor_order($1,$2) as id", [ids.offer, ids.method])).rows[0].id;
  await setCheckoutActor(db, ids.other);
  await assert.rejects(db.query("select submit_mentor_payment_claim($1,'not mine')", [order]), /order_access_denied/);
  await setCheckoutActor(db, ids.buyer);
  await db.query("select submit_mentor_payment_claim($1,'recovered transfer')", [order]);
  assert.equal((await db.query("select count(*)::int as count from mentor_orders")).rows[0].count, 1);
  assert.equal((await db.query("select count(*)::int as count from mentor_payment_claims")).rows[0].count, 1);
}));

test("unclaimed cancellation requires explicit unpaid confirmation and never cancels a submitted transfer", () => fixture(async (db) => {
  const order = (await db.query("select create_manual_mentor_order($1,$2) as id", [ids.offer, ids.method])).rows[0].id;
  await assert.rejects(db.query("select cancel_unsubmitted_mentor_order($1,false)", [order]), /unpaid_confirmation_required/);
  await setCheckoutActor(db, ids.other);
  await assert.rejects(db.query("select cancel_unsubmitted_mentor_order($1,true)", [order]), /order_access_denied/);
  await setCheckoutActor(db, ids.buyer);
  await db.query("select cancel_unsubmitted_mentor_order($1,true)", [order]);
  await db.query("select cancel_unsubmitted_mentor_order($1,true)", [order]);
  const claimed = await submitCheckout(db);
  await assert.rejects(db.query("select cancel_unsubmitted_mentor_order($1,true)", [claimed.order_id]), /order_not_cancellable/);
}));

test("mentor rejection terminates the order without reopening its reviewed declaration", () => fixture(async (db) => {
  const receipt = await submitCheckout(db);
  await setCheckoutActor(db, ids.owner);
  await db.query("select review_mentor_payment_claim($1,false)", [receipt.claim_id]);
  assert.deepEqual((await db.query("select o.status as order_status,c.status as claim_status from mentor_orders o join mentor_payment_claims c on c.order_id=o.id where o.id=$1", [receipt.order_id])).rows[0], { order_status: "failed", claim_status: "rejected" });
  await setCheckoutActor(db, ids.buyer);
  await assert.rejects(submitCheckout(db), /order_not_pending/);
  await assert.rejects(db.query("select submit_mentor_payment_claim($1,'again')", [receipt.order_id]), /order_not_pending/);
  assert.ok((await submitCheckout(db, ids.request2)).order_id);
}));

test("confirmation uses purchased terms even if the mentor later changes the offer", () => fixture(async (db) => {
  const receipt = await submitCheckout(db);
  await db.exec(`update mentor_offers set name='新方案', duration_days=90,weekly_questions=9 where id='${ids.offer}'`);
  await setCheckoutActor(db, ids.other);
  await assert.rejects(db.query("select review_mentor_payment_claim($1,true)", [receipt.claim_id]), /claim_access_denied/);
  await setCheckoutActor(db, ids.owner);
  assert.ok((await db.query("select review_mentor_payment_claim($1,true) as thread", [receipt.claim_id])).rows[0].thread);
  const entitlement = (await db.query("select weekly_question_limit,extract(day from ends_at-starts_at)::int as days from mentor_entitlements where order_id=$1", [receipt.order_id])).rows[0];
  assert.deepEqual(entitlement, { weekly_question_limit: 3, days: 30 });
  await setCheckoutActor(db, ids.buyer);
  assert.deepEqual(await submitCheckout(db), receipt);
  await assert.rejects(submitCheckout(db, ids.request2, "test-only declaration", { price_cents: 10000, currency: "USDT", duration_days: 90, weekly_questions: 9 }), /mentor_access_active/);
  assert.equal((await db.query("select count(*)::int as count from mentor_threads")).rows[0].count, 1);
}));

test("request IDs never reveal another buyer's receipt and internal helpers stay private", () => fixture(async (db) => {
  await submitCheckout(db);
  await setCheckoutActor(db, ids.other);
  await assert.rejects(submitCheckout(db), /request_conflict/);
  const privilege = (await db.query("select has_function_privilege('anon','public.submit_manual_mentor_payment(uuid,uuid,text,uuid,jsonb)','execute') as anonymous,has_function_privilege('authenticated','public.submit_manual_mentor_payment(uuid,uuid,text,uuid,jsonb)','execute') as member,has_function_privilege('authenticated','public.mentor_checkout_order(uuid,uuid,uuid,jsonb)','execute') as helper")).rows[0];
  assert.deepEqual(privilege, { anonymous: false, member: true, helper: false });
}));

test("a quote changed between rendering and transfer submission is never silently re-priced", () => fixture(async (db) => {
  await db.exec(`update mentor_offers set price_cents=15000 where id='${ids.offer}'`);
  await assert.rejects(submitCheckout(db), /offer_changed/);
  assert.equal((await db.query("select count(*)::int as count from mentor_orders")).rows[0].count, 0);
}));

test("the generic hosted-payment RPC shares pending locks and cannot create a second order after an atomic claim", () => fixture(async (db) => {
  await submitCheckout(db);
  await assert.rejects(db.query("select create_mentor_order($1)", [ids.offer]), /checkout_pending_exists/);
  assert.equal((await db.query("select count(*)::int as count from mentor_orders")).rows[0].count, 1);
}));

test("the generic checkout rejects self-purchase, inactive mentors and inactive buyers", () => fixture(async (db) => {
  await setCheckoutActor(db, ids.owner);
  await assert.rejects(db.query("select create_mentor_order($1)", [ids.offer]), /mentor_self_purchase/);
  await setCheckoutActor(db, ids.buyer);
  await db.exec(`update mentor_profiles set active=false where id='${ids.mentor}'`);
  await assert.rejects(db.query("select create_mentor_order($1)", [ids.offer]), /mentor_unavailable/);
  await db.exec(`update mentor_profiles set active=true where id='${ids.mentor}'; update profiles set account_status='banned' where id='${ids.buyer}'`);
  await assert.rejects(db.query("select create_mentor_order($1)", [ids.offer]), /account_ineligible/);
}));

test("generic orders reuse their hosted route but cannot be fabricated into manual claims or cancelled by manual controls", () => fixture(async (db) => {
  const create = async () => (await db.query("select create_mentor_order($1) as id", [ids.offer])).rows[0].id;
  const order = await create();
  assert.equal(await create(), order);
  assert.deepEqual((await db.query("select payment_method_id,payment_provider from mentor_orders where id=$1", [order])).rows[0], { payment_method_id: null, payment_provider: null });
  await assert.rejects(db.query("select submit_mentor_payment_claim($1,'fabricated manual claim')", [order]), /payment_method_required/);
  await assert.rejects(db.query("select cancel_unsubmitted_mentor_order($1,true)", [order]), /order_payment_route_invalid/);
  await assert.rejects(db.query("update mentor_orders set payment_provider='stripe',payment_method_id=$1 where id=$2", [ids.method, order]), /order_terms_immutable/);
  await assert.rejects(db.query("select submit_mentor_payment_claim($1,'still not manual')", [order]), /payment_method_required/);
  assert.equal((await db.query("select count(*)::int as count from mentor_payment_claims")).rows[0].count, 0);
}));

test("the generic checkout also refuses new orders while purchased tutoring access is active", () => fixture(async (db) => {
  const receipt = await submitCheckout(db);
  await setCheckoutActor(db, ids.owner);
  await db.query("select review_mentor_payment_claim($1,true)", [receipt.claim_id]);
  await setCheckoutActor(db, ids.buyer);
  await assert.rejects(db.query("select create_mentor_order($1)", [ids.offer]), /mentor_access_active/);
}));
