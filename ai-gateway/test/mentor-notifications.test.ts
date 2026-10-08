import assert from "node:assert/strict";
import test from "node:test";
import { loadMentorNotificationConfig } from "../src/mentor-notifications/config.ts";
import type { MentorNotificationConfig } from "../src/mentor-notifications/config.ts";
import { MailProviderError } from "../src/mentor-notifications/contracts.ts";
import type { ClaimedNotification, MailEnvelope, NotificationOutcome, NotificationRepository, Preparation } from "../src/mentor-notifications/contracts.ts";
import { SupabaseNotificationRepository } from "../src/mentor-notifications/repository.ts";
import { ResendMailSender, retryAfterSeconds } from "../src/mentor-notifications/resend.ts";
import { MentorNotificationWorker } from "../src/mentor-notifications/worker.ts";
import type { NotificationLogCode } from "../src/mentor-notifications/worker.ts";

const notificationId = "11111111-1111-4111-8111-111111111111";
const leaseToken = "22222222-2222-4222-8222-222222222222";
const claimId = "33333333-3333-4333-8333-333333333333";
const providerId = "44444444-4444-4444-8444-444444444444";
const eventKey = `mentor-payment-claim:${claimId}`;
const env = {
  MENTOR_EMAIL_ENABLED: "true",
  SUPABASE_URL: "https://database.example.test",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-placeholder",
  MENTOR_EMAIL_SITE_URL: "https://wavekb.example.test/",
  MENTOR_EMAIL_API_KEY: "re_test_placeholder",
  MENTOR_EMAIL_FROM: "WaveKB <notify@example.test>",
};
const config = loadMentorNotificationConfig(env);
const payload: MailEnvelope = {
  from: env.MENTOR_EMAIL_FROM,
  to: ["mentor@example.test"],
  subject: "WaveKB：学员声明已付款，待核实",
  text: "学员已提交付款声明，不代表平台已确认到账。\nhttps://wavekb.example.test/mentor/manage",
};
const job: ClaimedNotification = { id: notificationId, leaseToken, attempts: 1, eventKey };
const json = (value: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(value), { status, ...(headers ? { headers } : {}) });

test("mail defaults disabled; incomplete enabled configuration remains idle without AI keys", () => {
  const disabled = loadMentorNotificationConfig({});
  assert.equal(disabled.readiness, "disabled");
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.pollMs, 15_000);
  assert.equal(loadMentorNotificationConfig({ MENTOR_EMAIL_ENABLED: "true" }).readiness, "unconfigured");
  assert.equal(config.readiness, "ready");
  assert.equal(config.manageUrl, "https://wavekb.example.test/mentor/manage");
  assert.equal(loadMentorNotificationConfig({ ...env, MENTOR_EMAIL_SITE_URL: "", AUTH_SITE_URL: "http://legacy.invalid/path" }).manageUrl, "https://wavekb.com/mentor/manage");
});

test("configuration rejects header injection, non HTTPS/credentialed URLs, and invalid polling without printing values", () => {
  for (const override of [
    { MENTOR_EMAIL_FROM: "secret-value\r\nBcc: attacker@example.test" },
    { MENTOR_EMAIL_API_KEY: "secret-value\r\n" },
    { MENTOR_EMAIL_SITE_URL: "http://insecure.example.test" },
    { MENTOR_EMAIL_SITE_URL: "https://user:secret-value@example.test" },
    { SUPABASE_URL: "https://database.example.test?secret-value=yes" },
    { MENTOR_EMAIL_ENABLED: "secret-value" },
    { MENTOR_EMAIL_POLL_SECONDS: "secret-value" },
  ]) {
    assert.throws(() => loadMentorNotificationConfig({ ...env, ...override }), (error: unknown) => (
      error instanceof Error && /^mentor_notification_/.test(error.message)
      && !/secret-value|attacker/.test(error.message)
    ));
  }
});

test("Resend sends only a fixed text envelope with server key, no redirect, and a stable idempotency request", async () => {
  const requests: Array<{ url: string; options: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (url, options) => {
    requests.push({ url: String(url), options: options ?? {} });
    return json({ id: providerId });
  };
  const sender = new ResendMailSender(env.MENTOR_EMAIL_API_KEY, fetchImpl);
  assert.deepEqual(await sender.send(payload, eventKey), { providerMessageId: providerId });
  await sender.send(payload, eventKey);
  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.url, "https://api.resend.com/emails");
  assert.equal(requests[0]?.options.redirect, "error");
  const headers = new Headers(requests[0]?.options.headers);
  assert.equal(headers.get("authorization"), `Bearer ${env.MENTOR_EMAIL_API_KEY}`);
  assert.equal(headers.get("idempotency-key"), eventKey);
  assert.deepEqual(JSON.parse(String(requests[0]?.options.body)), payload);
  assert.equal(requests[0]?.options.body, requests[1]?.options.body);
  assert.ok(requests[0]?.options.signal);
});

test("provider rate limits and bounded Retry-After are retryable, unauthorized/content mismatches are terminal", async () => {
  const cases: Array<{ status: number; body: unknown; code: string; retryable: boolean; after?: string }> = [
    { status: 429, body: { message: "private@example.test sensitive-key" }, code: "provider_rate_limited", retryable: true, after: "120" },
    { status: 503, body: { message: "private@example.test sensitive-key" }, code: "provider_unavailable", retryable: true },
    { status: 409, body: { name: "concurrent_idempotent_requests" }, code: "provider_unavailable", retryable: true },
    { status: 409, body: { name: "invalid_idempotent_request" }, code: "provider_rejected", retryable: false },
    { status: 401, body: { message: "private@example.test sensitive-key" }, code: "provider_unauthorized", retryable: false },
    { status: 403, body: { message: "private@example.test sensitive-key" }, code: "provider_unauthorized", retryable: false },
    { status: 422, body: { message: "private@example.test sensitive-key" }, code: "provider_rejected", retryable: false },
  ];
  for (const item of cases) {
    const fetchImpl: typeof fetch = async () => json(item.body, item.status, item.after ? { "retry-after": item.after } : {});
    await assert.rejects(new ResendMailSender(env.MENTOR_EMAIL_API_KEY, fetchImpl).send(payload, eventKey), (error: unknown) => {
      assert.ok(error instanceof MailProviderError);
      assert.equal(error.code, item.code);
      assert.equal(error.retryable, item.retryable);
      if (item.after) assert.equal(error.retryAfterSeconds, 120);
      assert.doesNotMatch(error.message, /private@|sensitive-key/);
      return true;
    });
  }
  assert.equal(retryAfterSeconds("999999"), 1800);
  assert.equal(retryAfterSeconds("garbage"), null);
  assert.equal(retryAfterSeconds("-1"), null);
  assert.equal(retryAfterSeconds("Thu, 01 Jan 1970 00:02:00 GMT", 0), 120);
});

test("malformed successful JSON and network failure retry safely; malformed terminal responses never expose their body", async () => {
  for (const response of [new Response("sensitive-key private@example.test"), json(null), json({ id: "private@example.test" })]) {
    const fetchImpl: typeof fetch = async () => response;
    await assert.rejects(new ResendMailSender(env.MENTOR_EMAIL_API_KEY, fetchImpl).send(payload, eventKey), (error: unknown) => (
      error instanceof MailProviderError && error.code === "provider_response_invalid" && error.retryable
    ));
  }
  const network: typeof fetch = async () => { throw new Error("sensitive-key private@example.test"); };
  await assert.rejects(new ResendMailSender(env.MENTOR_EMAIL_API_KEY, network).send(payload, eventKey), /provider_unavailable/);
  const malformed: typeof fetch = async () => new Response("sensitive-key private@example.test", { status: 401 });
  await assert.rejects(new ResendMailSender(env.MENTOR_EMAIL_API_KEY, malformed).send(payload, eventKey), (error: unknown) => (
    error instanceof MailProviderError && error.code === "provider_unauthorized" && !error.retryable
  ));
});

test("sender rejects multi-recipient and injected envelopes before making any request", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => { calls++; return json({ id: providerId }); };
  const sender = new ResendMailSender(env.MENTOR_EMAIL_API_KEY, fetchImpl);
  for (const override of [
    { to: ["mentor@example.test", "attacker@example.test"] },
    { to: ["mentor@example.test\r\nBcc: attacker@example.test"] },
    { from: "notify@example.test\r\nBcc: attacker@example.test" },
    { subject: "hello\r\nBcc: attacker@example.test" },
  ]) await assert.rejects(sender.send({ ...payload, ...override }, eventKey), /provider_rejected/);
  await assert.rejects(sender.send(payload, "browser-controlled-key"), /provider_rejected/);
  assert.equal(calls, 0);
});

test("repository uses privileged fixed RPCs, carries the lease, and strips private response fields", async () => {
  const requests: Array<{ url: string; body: Record<string, unknown>; headers: Headers }> = [];
  const fetchImpl: typeof fetch = async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(String(options?.body)), headers: new Headers(options?.headers) });
    if (String(url).endsWith("claim_mentor_payment_notifications")) {
      return json([{ id: notificationId, lease_token: leaseToken, attempts: 1, event_key: eventKey, email_payload: payload }]);
    }
    if (String(url).endsWith("prepare_mentor_payment_notification")) return json({ state: "ready", payload });
    return json(true);
  };
  const repository = new SupabaseNotificationRepository(config, fetchImpl);
  assert.deepEqual(await repository.claimBatch(), [job]);
  assert.deepEqual(await repository.prepare(job, config.from, config.manageUrl), { state: "ready", payload });
  assert.equal(await repository.finish(job, { outcome: "failed", code: "provider_rate_limited", retryable: true, retryAfterSeconds: 120 }), true);
  assert.deepEqual(requests[0]?.body, { p_batch_size: 1 });
  assert.equal(requests[0]?.headers.get("authorization"), `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
  assert.equal(requests[1]?.body.p_lease_token, leaseToken);
  assert.equal(requests[2]?.body.p_retry_after_seconds, 120);
  const failure: typeof fetch = async () => json({ message: "private@example.test sensitive-key" }, 500);
  await assert.rejects(new SupabaseNotificationRepository(config, failure).claimBatch(), (error: unknown) => (
    error instanceof Error && error.message === "mentor_notification_database_unavailable"
  ));
  const oversized: typeof fetch = async () => json([
    { id: notificationId, lease_token: leaseToken, attempts: 1, event_key: eventKey },
    { id: providerId, lease_token: leaseToken, attempts: 1, event_key: eventKey },
  ]);
  await assert.rejects(new SupabaseNotificationRepository(config, oversized).claimBatch(), /mentor_notification_response_invalid/);
});

function workerFixture(options: {
  config?: MentorNotificationConfig;
  jobs?: ClaimedNotification[];
  preparation?: Preparation;
  providerFailure?: Error;
  settlementFailure?: boolean;
} = {}) {
  let clock = 1000;
  const events: string[] = [];
  const logs: NotificationLogCode[] = [];
  const sends: Array<{ payload: MailEnvelope; key: string; at: number }> = [];
  const settlements: NotificationOutcome[] = [];
  let claims = 0;
  const waits: number[] = [];
  const repository: NotificationRepository = {
    async claimBatch() { claims++; return options.jobs ?? [job]; },
    async prepare() { events.push("prepare"); return options.preparation ?? { state: "ready", payload }; },
    async finish(_job, outcome) {
      events.push(`finish:${outcome.outcome}`);
      settlements.push(outcome);
      if (options.settlementFailure) throw new Error("private@example.test sensitive-key");
      return true;
    },
  };
  const worker = new MentorNotificationWorker(options.config ?? config, {
    repository,
    sender: { async send(value, key) {
      events.push("send"); sends.push({ payload: value, key, at: clock });
      if (options.providerFailure) throw options.providerFailure;
      return { providerMessageId: providerId };
    } },
    log: (code) => logs.push(code),
    now: () => clock,
    wait: async (milliseconds) => { waits.push(milliseconds); clock += milliseconds; },
  });
  return { worker, events, logs, sends, settlements, waits, claims: () => claims };
}

test("disabled/unconfigured workers never acquire work or contact the mail service", async () => {
  for (const setting of [loadMentorNotificationConfig({}), loadMentorNotificationConfig({ MENTOR_EMAIL_ENABLED: "true" })]) {
    const fixture = workerFixture({ config: setting });
    assert.equal(await fixture.worker.pollOnce(), 0);
    assert.equal(await fixture.worker.pollOnce(), 0);
    assert.equal(fixture.claims(), 0);
    assert.deepEqual(fixture.sends, []);
    assert.deepEqual(fixture.logs, [setting.enabled ? "notification_unconfigured" : "notification_disabled"]);
  }
});

test("worker resolves recipient before sending, preserves key/payload, and records provider acceptance only", async () => {
  const fixture = workerFixture();
  assert.equal(await fixture.worker.pollOnce(), 1);
  assert.deepEqual(fixture.events, ["prepare", "send", "finish:accepted"]);
  assert.equal(fixture.sends[0]?.key, eventKey);
  assert.deepEqual(fixture.sends[0]?.payload, payload);
  assert.deepEqual(fixture.settlements, [{ outcome: "accepted", providerMessageId: providerId }]);
  assert.deepEqual(fixture.logs, []);
});

test("worker skips resolved/lost leases and never sends when confirmed owner email is unavailable", async () => {
  for (const preparation of [
    { state: "skipped" }, { state: "lease_lost" },
    { state: "unavailable", code: "recipient_unavailable" },
    { state: "unavailable", code: "idempotency_window_expired" },
  ] as Preparation[]) {
    const fixture = workerFixture({ preparation });
    await fixture.worker.pollOnce();
    assert.equal(fixture.sends.length, 0);
    if (preparation.state === "unavailable") assert.deepEqual(fixture.settlements, [{ outcome: "failed", code: preparation.code, retryable: false }]);
    else assert.deepEqual(fixture.settlements, []);
  }
});

test("worker honors provider Retry-After, pauses later jobs, and reports only fixed codes when acknowledgements fail", async () => {
  const fixture = workerFixture({ jobs: [job, { ...job, id: providerId }], providerFailure: new MailProviderError("provider_rate_limited", true, 120) });
  assert.equal(await fixture.worker.pollOnce(), 1);
  assert.equal(fixture.sends.length, 1);
  assert.deepEqual(fixture.settlements, [{ outcome: "failed", code: "provider_rate_limited", retryable: true, retryAfterSeconds: 120 }]);
  assert.equal(await fixture.worker.pollOnce(), 0);
  assert.equal(fixture.claims(), 1);
  const lostAck = workerFixture({ settlementFailure: true });
  await lostAck.worker.pollOnce();
  assert.deepEqual(lostAck.logs, ["notification_settlement_failed"]);
  assert.deepEqual(lostAck.settlements, [{ outcome: "accepted", providerMessageId: providerId }]);
  assert.equal(lostAck.sends.length, 1);
});

test("successive messages and batches are paced; stop prevents another send in a claimed batch", async () => {
  const fixture = workerFixture({ jobs: [job, { ...job, id: providerId }] });
  assert.equal(await fixture.worker.pollOnce(), 2);
  assert.equal(fixture.sends[1]!.at - fixture.sends[0]!.at, 600);
  assert.equal(await fixture.worker.pollOnce(), 2);
  assert.equal(fixture.sends[2]!.at - fixture.sends[1]!.at, 600);
  assert.deepEqual(fixture.waits, [600, 600, 600]);
  let worker: MentorNotificationWorker;
  let sends = 0;
  worker = new MentorNotificationWorker(config, {
    repository: {
      async claimBatch() { return [job, { ...job, id: providerId }]; },
      async prepare() { return { state: "ready", payload }; },
      async finish() { return true; },
    },
    sender: { async send() { sends++; worker.stop(); return { providerMessageId: providerId }; } },
  });
  assert.equal(await worker.pollOnce(), 1);
  assert.equal(sends, 1);
  assert.equal(await worker.pollOnce(), 0);
});

test("overlapping polls in one process share a batch instead of claiming again", async () => {
  const fixture = workerFixture();
  assert.deepEqual(await Promise.all([fixture.worker.pollOnce(), fixture.worker.pollOnce()]), [1, 1]);
  assert.equal(fixture.claims(), 1);
  assert.equal(fixture.sends.length, 1);
});
