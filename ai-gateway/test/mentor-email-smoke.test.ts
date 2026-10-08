import assert from "node:assert/strict";
import test from "node:test";
import { emailSmokePresence, readEmailSmokeSettings, verifyTestEmail } from "../src/mentor-email-smoke.ts";

const testId = "17171717-1717-4717-8717-171717171717";
const messageId = "28282828-2828-4828-8828-282828282828";
const settings = { MENTOR_EMAIL_API_KEY: "private-test-key", MENTOR_EMAIL_FROM: "WaveKB <mail@example.com>" };
const input = { recipient: "owner@example.com", testId, confirmation: "SEND_ONE_TEST_EMAIL" };
function fixture() {
  let receipt: any = null;
  let sends = 0;
  const store = { read: () => receipt, save: (_id: string, value: any) => { receipt = structuredClone(value); } };
  const sender = { send: async (payload: any, key: string) => {
    sends++;
    assert.equal(key, `mentor-email-smoke:${testId}`);
    assert.deepEqual(payload.to, [input.recipient]);
    assert.match(payload.text, /不是付款声明/);
    return { providerMessageId: messageId };
  } };
  const fetchImpl = async (url: string | URL | Request, options?: RequestInit) => {
    assert.equal(url, `https://api.resend.com/emails/${messageId}`);
    assert.equal(options?.redirect, "error");
    return Response.json({ id: messageId, last_event: "delivered", to: [input.recipient], html: "private content" });
  };
  return { store, sender, fetchImpl, count: () => sends, receipt: () => receipt };
}

test("mail config probe returns only presence and never loads other server keys", () => {
  const value = readEmailSmokeSettings('MENTOR_EMAIL_API_KEY="private-test-key"\nMENTOR_EMAIL_FROM="WaveKB <mail@example.com>"\nSUPABASE_SERVICE_ROLE_KEY=never-read');
  assert.equal(Object.hasOwn(value, "SUPABASE_SERVICE_ROLE_KEY"), false);
  assert.deepEqual(emailSmokePresence(value), { api_key_configured: true, from_configured: true });
  assert.throws(() => readEmailSmokeSettings("MENTOR_EMAIL_FROM=a\nMENTOR_EMAIL_FROM=b"), /duplicate_mail_setting/);
});
test("missing sending configuration never sends, creates a receipt, or contacts provider", async () => {
  const f = fixture();
  const result = await verifyTestEmail({}, input, f);
  assert.equal(result.status, "blocked_unconfigured");
  assert.equal(f.count(), 0); assert.equal(f.receipt(), null);
});
test("a test requires explicit confirmation and exactly one safe recipient", async () => {
  for (const change of [{ confirmation: "" }, { recipient: "a@example.com,b@example.com" }, { recipient: "a@example.com\r\nBcc:b@example.com" }, { testId: "../other" }]) {
    const f = fixture();
    await assert.rejects(verifyTestEmail(settings, { ...input, ...change }, f), /invalid_mail_test_request/);
    assert.equal(f.count(), 0);
  }
});
test("one accepted test is never resent; only matched provider delivery is reported", async () => {
  const f = fixture();
  const first = await verifyTestEmail(settings, input, f);
  const second = await verifyTestEmail(settings, input, f);
  assert.equal(first.last_event, "delivered"); assert.equal(second.last_event, "delivered");
  assert.equal(first.inbox_receipt_verified, false);
  assert.equal(f.count(), 1);
  const report = JSON.stringify(first);
  for (const privateValue of [input.recipient, settings.MENTOR_EMAIL_API_KEY, "private content"]) assert.equal(report.includes(privateValue), false);
});
test("changed test envelope and unknown attempts outside idempotency window cannot resend", async () => {
  const f = fixture();
  await verifyTestEmail(settings, input, f);
  await assert.rejects(verifyTestEmail(settings, { ...input, recipient: "other@example.com" }, f), /payload_conflict/);
  const g = fixture();
  const sender = { send: async () => { throw new Error("ambiguous_response"); } };
  const now = () => new Date("2026-10-08T00:00:00Z");
  await assert.rejects(verifyTestEmail(settings, input, { ...g, sender, now }), /ambiguous_response/);
  await assert.rejects(verifyTestEmail(settings, input, { ...g, now: () => new Date("2026-10-09T00:00:00Z") }), /idempotency_expired/);
  assert.equal(g.count(), 0);
});
test("send-only permission and 429 do not fabricate delivery or cause another send", async () => {
  for (const status of [403, 429]) {
    const f = fixture();
    const result = await verifyTestEmail(settings, input, { ...f, fetchImpl: async () => new Response("secret body", { status }) });
    assert.equal(result.status, "accepted"); assert.equal(result.last_event, "unverified");
    assert.equal(result.delivery_lookup, status === 403 ? "not_permitted" : "rate_limited");
    assert.equal(f.count(), 1);
  }
});
test("a provider response with a different message ID never proves delivered", async () => {
  const f = fixture();
  const result = await verifyTestEmail(settings, input, { ...f, fetchImpl: async () => Response.json({ id: testId, last_event: "delivered" }) });
  assert.equal(result.last_event, "unverified");
});
