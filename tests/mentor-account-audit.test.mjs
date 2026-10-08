import assert from "node:assert/strict";
import test from "node:test";
import { auditDisposableMentorAccount, readAuditSettings } from "../scripts/mentor-account-audit.mjs";

const settings = { SUPABASE_URL: "https://odmtxwlnlvwldrjttyqu.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "server-only-test-secret", SUPABASE_PUBLISHABLE_KEY: "public-test-key", AUTH_SITE_URL: "https://wavekb.com" };
const accountId = "11111111-1111-4111-8111-111111111111";
const mentorId = "22222222-2222-4222-8222-222222222222";

function boundary({ ordersExist = false, identityChanged = false, signInFails = false, methods = [], siteRequiresActivation = false, siteActorMismatch = false } = {}) {
  const calls = [];
  let created;
  let activated = false;
  return { calls, fetchImpl: async (url, init) => {
    const parsed = new URL(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path: parsed.pathname, search: parsed.search, method: init.method, body, headers: init.headers });
    let result;
    if (parsed.pathname === "/auth/v1/admin/users" && init.method === "POST") { created = body; result = { id: accountId, ...body }; }
    else if (parsed.pathname === "/auth/v1/token") {
      if (signInFails) return new Response(JSON.stringify({ error: `${settings.SUPABASE_SERVICE_ROLE_KEY}: secret error body` }), { status: 401 });
      result = { user: { id: accountId }, access_token: "private-user-jwt", refresh_token: "private-refresh-token" };
    }
    else if (parsed.pathname === "/rest/v1/profiles") result = [{ id: accountId, role: "user", account_status: "active", public_uid: activated ? 12345 : null }];
    else if (parsed.pathname === "/rest/v1/rpc/start_uid_selection") result = { selected_uid: 12345 };
    else if (parsed.pathname === "/rest/v1/rpc/complete_uid_selection") { activated = true; result = { public_uid: 12345 }; }
    else if (parsed.pathname === "/rest/v1/rpc/list_mentor_catalog") result = [{ mentor_id: mentorId, offers: [{ id: "offer" }] }];
    else if (parsed.pathname === "/rest/v1/rpc/list_mentor_payment_methods") result = methods;
    else if (parsed.hostname === "wavekb.com" && parsed.pathname === "/api/auth/login") return new Response(JSON.stringify({ ok: true, needsUidActivation: siteRequiresActivation }), { status: 200, headers: { "set-cookie": "sb-odmtxwlnlvwldrjttyqu-auth-token=private-http-only-cookie; Path=/; HttpOnly" } });
    else if (parsed.hostname === "wavekb.com" && parsed.pathname === `/mentors/${mentorId}`) return new Response(`<p>正在查询付款声明状态…</p><script>self.__next_f.push([1,${JSON.stringify(JSON.stringify({ actorId: siteActorMismatch ? "different-actor" : accountId, paymentMethods: methods }))}])</script>`, { status: 200, headers: { "content-type": "text/html" } });
    else if (parsed.pathname === `/auth/v1/admin/users/${accountId}` && init.method === "GET") result = { id: accountId, email: identityChanged ? "different@example.test" : created.email, app_metadata: created.app_metadata };
    else if (parsed.pathname === `/auth/v1/admin/users/${accountId}` && init.method === "DELETE") result = { id: accountId };
    else if (["/rest/v1/mentor_orders", "/rest/v1/mentor_payment_claims", "/rest/v1/mentor_profiles"].includes(parsed.pathname)) result = ordersExist && parsed.pathname === "/rest/v1/mentor_orders" ? [{ id: "existing-order" }] : [];
    else throw new Error(`Unexpected boundary ${parsed.pathname}`);
    return new Response(JSON.stringify(result), { status: 200 });
  } };
}

test("server settings parse only the necessary allow-list and require the production origin", () => {
  const source = `SUPABASE_URL="${settings.SUPABASE_URL}"\nSUPABASE_SERVICE_ROLE_KEY='server-only-test-secret'\nSUPABASE_PUBLISHABLE_KEY=public-test-key\nAUTH_SITE_URL=https://wavekb.com\nOTHER_PRIVATE_SETTING=never-return-me`;
  const loaded = readAuditSettings(source);
  const { business_mail_config_presence, server_auth_site_origin_matches, ...credentials } = loaded;
  assert.deepEqual(credentials, settings);
  assert.equal(server_auth_site_origin_matches, true);
  assert.equal(Object.values(business_mail_config_presence).every((value) => value === false), true);
  const mailConfigured = readAuditSettings(`${source}\nRESEND_API_KEY=private-mail-key\nMENTOR_EMAIL_FROM=mentor@example.test\nSMTP_HOST=""`);
  assert.equal(mailConfigured.business_mail_config_presence.RESEND_API_KEY, true);
  assert.equal(mailConfigured.business_mail_config_presence.MENTOR_EMAIL_FROM, true);
  assert.equal(mailConfigured.business_mail_config_presence.SMTP_HOST, false);
  assert.equal(JSON.stringify(mailConfigured).includes("private-mail-key"), false);
  assert.equal(JSON.stringify(mailConfigured).includes("mentor@example.test"), false);
  assert.throws(() => readAuditSettings(`${source}\nSUPABASE_SERVICE_ROLE_KEY=duplicate`), /duplicate_server_setting/);
  assert.throws(() => readAuditSettings(source.replace(settings.SUPABASE_URL, "https://other.example.test")), /unexpected_supabase_origin/);
  const oldAuthSetting = readAuditSettings(source.replace("AUTH_SITE_URL=https://wavekb.com", "AUTH_SITE_URL=https://other.example.test"));
  assert.equal(oldAuthSetting.AUTH_SITE_URL, "https://wavekb.com");
  assert.equal(oldAuthSetting.server_auth_site_origin_matches, false);
  assert.equal(JSON.stringify(oldAuthSetting).includes("other.example.test"), false);
  const noAuthSetting = readAuditSettings(source.replace("AUTH_SITE_URL=https://wavekb.com", ""));
  assert.equal(noAuthSetting.AUTH_SITE_URL, "https://wavekb.com");
  assert.equal(noAuthSetting.server_auth_site_origin_matches, false);
  assert.throws(() => readAuditSettings("SUPABASE_URL=https://example.test"), /missing_server_setting/);
});

test("creates and authenticates a real-boundary student and deletes only that exact empty account", async () => {
  const server = boundary({ methods: [{ id: "method", kind: "binance", account_value: "123456789", network: "USDT" }] });
  const report = await auditDisposableMentorAccount({ settings, auditId: "gha-123-1", fetchImpl: server.fetchImpl });
  assert.equal(report.ok, true);
  assert.equal(report.account_uuid, accountId);
  assert.equal(report.public_uid, 12345);
  assert.equal(report.ordinary_student, true);
  assert.equal(report.site_login_http_ok, true);
  assert.equal(report.site_uid_activation_not_needed, true);
  assert.equal(report.cleanup, "deleted_exact_created_account");
  assert.deepEqual(report.counts, { mentors: 1, offers: 1, payment_methods: 1 });
  assert.deepEqual(report.cleanup_read_checks, { orders_empty: true, claims_empty: true, mentor_binding_empty: true });
  assert.ok(Number.isFinite(Date.parse(report.started_at)));
  assert.ok(Number.isFinite(Date.parse(report.completed_at)));
  const create = server.calls.find((call) => call.path === "/auth/v1/admin/users");
  assert.match(create.body.email, /^mentor-checkout-[0-9a-f-]+@wavekb-audit\.invalid$/);
  assert.equal(create.body.email_confirm, true);
  assert.ok(create.body.password.length >= 40);
  const methods = server.calls.find((call) => call.path === "/rest/v1/rpc/list_mentor_payment_methods");
  assert.equal(methods.headers.authorization, "Bearer private-user-jwt");
  assert.deepEqual(report.mentors[0].payment_methods, [{ method_id: "method", kind: "binance", account_configured: true, configuration_issue: null }]);
  assert.deepEqual(report.mentors[0].checkout_page, { http_ok: true, ssr_actor_matches: true, payment_methods_prop_present: true, represented_payment_method_count: 1, rendered_state: "pending_claim_fetch", javascript_hydration_tested: false });
  const checkoutRequest = server.calls.find((call) => call.path === `/mentors/${mentorId}`);
  assert.equal(checkoutRequest.headers.cookie, "sb-odmtxwlnlvwldrjttyqu-auth-token=private-http-only-cookie");
  const serialized = JSON.stringify(report);
  for (const secret of [settings.SUPABASE_SERVICE_ROLE_KEY, "private-user-jwt", "private-refresh-token", "private-http-only-cookie", create.body.password, create.body.email, "123456789"]) assert.equal(serialized.includes(secret), false);
  assert.equal(server.calls.some((call) => /invite|signup|create_manual_mentor_order|submit_mentor_payment_claim|review_mentor_payment_claim/.test(call.path)), false);
  for (const call of server.calls.filter((call) => /\/rest\/v1\/(?:mentor_orders|mentor_payment_claims|mentor_profiles)$/.test(call.path))) {
    assert.equal(call.method, "GET");
    assert.match(call.search, new RegExp(`(?:buyer_id|owner_id)=eq\\.${accountId}`));
  }
});

test("refuses deletion when the created account has any order activity", async () => {
  const server = boundary({ ordersExist: true });
  const report = await auditDisposableMentorAccount({ settings, auditId: "gha-123-1", fetchImpl: server.fetchImpl });
  assert.equal(report.ok, false);
  assert.equal(report.cleanup, "retained_unverified");
  assert.equal(report.cleanup_error.code, "cleanup_account_has_related_activity");
  assert.equal(server.calls.some((call) => call.method === "DELETE"), false);
});

test("refuses deletion when the precise created account identity has changed", async () => {
  const server = boundary({ identityChanged: true });
  const report = await auditDisposableMentorAccount({ settings, auditId: "gha-123-1", fetchImpl: server.fetchImpl });
  assert.equal(report.cleanup_error.code, "cleanup_identity_mismatch");
  assert.equal(server.calls.some((call) => call.method === "DELETE"), false);
});

test("sanitizes failure responses and still cleans up the newly created empty account", async () => {
  const server = boundary({ signInFails: true });
  const report = await auditDisposableMentorAccount({ settings, auditId: "gha-123-1", fetchImpl: server.fetchImpl });
  assert.equal(report.ok, false);
  assert.deepEqual(report.error, { code: "account_sign_in_failed", status: 401 });
  assert.equal(report.cleanup, "deleted_exact_created_account");
  assert.equal(JSON.stringify(report).includes(settings.SUPABASE_SERVICE_ROLE_KEY), false);
});

test("rejects unsafe invocation before any network request", async () => {
  const server = boundary();
  await assert.rejects(auditDisposableMentorAccount({ settings, auditId: "../bad", fetchImpl: server.fetchImpl }), /invalid_audit_identity/);
  await assert.rejects(auditDisposableMentorAccount({ settings: { ...settings, SUPABASE_URL: "https://other.example.test" }, auditId: "gha-123-1", fetchImpl: server.fetchImpl }), /invalid_server_settings/);
  assert.equal(server.calls.length, 0);
});

test("never retries ambiguous creation or guesses an existing account for cleanup", async () => {
  let requests = 0;
  const report = await auditDisposableMentorAccount({ settings, auditId: "gha-123-1", fetchImpl: async () => { requests++; throw new Error("ambiguous transport failure containing a private token"); } });
  assert.equal(requests, 1);
  assert.equal(report.account_creation_attempted, true);
  assert.equal(report.account_created, false);
  assert.equal(report.cleanup, "creation_outcome_unknown");
  assert.equal(report.error.code, "account_create_failed_transport");
  assert.equal(JSON.stringify(report).includes("private token"), false);
});

test("does not claim a real activated website session when the actual login route needs activation", async () => {
  const server = boundary({ siteRequiresActivation: true });
  const report = await auditDisposableMentorAccount({ settings, auditId: "gha-123-1", fetchImpl: server.fetchImpl });
  assert.equal(report.ok, false);
  assert.equal(report.error.code, "site_login_not_activated");
  assert.equal(report.cleanup, "deleted_exact_created_account");
});

test("rejects logged-out or different-actor SSR without leaking the returned HTML", async () => {
  const server = boundary({ siteActorMismatch: true });
  const report = await auditDisposableMentorAccount({ settings, auditId: "gha-123-1", fetchImpl: server.fetchImpl });
  assert.equal(report.ok, false);
  assert.equal(report.error.code, "site_checkout_authenticated_markers_missing");
  assert.equal(report.cleanup, "deleted_exact_created_account");
  assert.equal(JSON.stringify(report).includes("different-actor"), false);
});
