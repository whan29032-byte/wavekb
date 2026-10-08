import fs from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";

const productionSupabaseOrigin = "https://odmtxwlnlvwldrjttyqu.supabase.co";
const productionSiteOrigin = "https://wavekb.com";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const requiredSettings = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_PUBLISHABLE_KEY", "AUTH_SITE_URL"];
const mailSettings = ["MENTOR_EMAIL_ENABLED", "MENTOR_EMAIL_API_KEY", "MENTOR_EMAIL_FROM", "MENTOR_ORDER_EMAIL_FROM", "RESEND_API_KEY", "SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM", "SENDGRID_API_KEY"];

class AuditFailure extends Error {
  constructor(code, status = null) { super(code); this.code = code; this.status = status; }
}

export function readAuditSettings(source) {
  const settings = {};
  const businessMailConfigPresence = Object.fromEntries(mailSettings.map((key) => [key, false]));
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (!match || (!requiredSettings.includes(match[1]) && !mailSettings.includes(match[1]))) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (mailSettings.includes(match[1])) { businessMailConfigPresence[match[1]] = Boolean(value.trim()); continue; }
    if (Object.hasOwn(settings, match[1])) throw new AuditFailure("duplicate_server_setting");
    settings[match[1]] = value;
  }
  if (requiredSettings.some((key) => !settings[key])) throw new AuditFailure("missing_server_setting");
  if (settings.SUPABASE_URL.replace(/\/$/, "") !== productionSupabaseOrigin) throw new AuditFailure("unexpected_supabase_origin");
  if (settings.AUTH_SITE_URL.replace(/\/$/, "") !== productionSiteOrigin) throw new AuditFailure("unexpected_site_origin");
  return { ...settings, business_mail_config_presence: businessMailConfigPresence };
}

function paymentSummary(method) {
  const account = typeof method.account_value === "string" ? method.account_value.trim() : "";
  const network = typeof method.network === "string" ? method.network.trim() : "";
  let issue = null;
  if (!account) issue = "missing_account";
  else if (method.kind === "binance" && !/^\d+$/.test(account)) issue = "binance_uid_invalid";
  else if (method.kind !== "binance" && /[A-Za-z0-9]{24,}/.test(network)) issue = "network_contains_destination";
  else if (method.kind === "crypto" && (!network || /^(USDT|USDC|BTC|ETH)$/i.test(network) || /^\d+$/.test(account))) issue = "crypto_network_unclear";
  return { method_id: method.id, kind: method.kind, account_configured: Boolean(account), configuration_issue: issue };
}

// Run only under the production workflow's existing pinned SSH connection. This
// creates a real disposable student, never a mentor/order/payment declaration.
// Auth endpoints match @supabase/auth-js createUser/signInWithPassword/deleteUser.
export async function auditDisposableMentorAccount({ settings, auditId, fetchImpl = fetch }) {
  if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(auditId || "")) throw new AuditFailure("invalid_audit_identity");
  if (settings?.SUPABASE_URL?.replace(/\/$/, "") !== productionSupabaseOrigin || settings?.AUTH_SITE_URL?.replace(/\/$/, "") !== productionSiteOrigin || requiredSettings.some((key) => !settings[key])) throw new AuditFailure("invalid_server_settings");
  const email = `mentor-checkout-${randomUUID()}@wavekb-audit.invalid`;
  const password = `${randomBytes(32).toString("base64url")}aA1!`;
  let accountId = null;
  let accessToken = null;
  let siteCookie = null;
  const report = { audit_id: auditId, started_at: new Date().toISOString(), completed_at: null, ok: false, account_creation_attempted: false, account_created: false, account_uuid: null, public_uid: null, authenticated: false, ordinary_student: false, account_avatar_configured: false, site_login_http_ok: false, site_uid_activation_not_needed: false, mentors: [], counts: { mentors: 0, offers: 0, payment_methods: 0 }, business_mail_config_presence: Object.fromEntries(mailSettings.map((key) => [key, settings.business_mail_config_presence?.[key] === true])), cleanup: "not_created", cleanup_read_checks: { orders_empty: null, claims_empty: null, mentor_binding_empty: null }, error: null };

  async function siteRequest(path, { method = "GET", body, code }) {
    let response;
    try {
      response = await fetchImpl(`${productionSiteOrigin}${path}`, { method, headers: { origin: productionSiteOrigin, ...(body === undefined ? {} : { "content-type": "application/json" }), ...(siteCookie ? { cookie: siteCookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000), redirect: "error" });
    } catch { throw new AuditFailure(`${code}_transport`); }
    if (!response.ok) throw new AuditFailure(code, response.status);
    return response;
  }

  async function inspectCheckoutPage(mentorId, methods) {
    const response = await siteRequest(`/mentors/${mentorId}`, { code: "site_checkout_read_failed" });
    if (!response.headers.get("content-type")?.includes("text/html")) throw new AuditFailure("site_checkout_content_type_invalid");
    let html;
    try { html = await response.text(); } catch { throw new AuditFailure("site_checkout_body_failed"); }
    if (html.length > 5_000_000) throw new AuditFailure("site_checkout_body_oversized");
    // RSC props are escaped inside the HTML stream. Classify only known markers;
    // never include HTML, session cookies or payment destinations in the receipt.
    const normalized = html.replace(/\\"/g, '"');
    const actorMatches = normalized.includes(`"actorId":"${accountId}"`);
    const methodsProp = normalized.includes('"paymentMethods":[');
    const representedMethods = methods.filter((method) => normalized.includes(`"id":"${method.id}"`)).length;
    const state = html.includes("登录后查看付款信息") ? "needs_login" : html.includes("正在查询付款声明状态") ? "pending_claim_fetch" : html.includes("mentor-payment-method") ? "checkout_form" : html.includes("已经拥有这位导师的有效权益") ? "active_access" : "unclassified";
    if (!actorMatches || !methodsProp || representedMethods !== methods.length || state === "needs_login" || state === "unclassified") throw new AuditFailure("site_checkout_authenticated_markers_missing");
    return { http_ok: true, ssr_actor_matches: actorMatches, payment_methods_prop_present: methodsProp, represented_payment_method_count: representedMethods, rendered_state: state, javascript_hydration_tested: false };
  }

  async function request(path, { service = false, method = "GET", body, code }) {
    const key = service ? settings.SUPABASE_SERVICE_ROLE_KEY : settings.SUPABASE_PUBLISHABLE_KEY;
    const headers = { apikey: key, "content-type": "application/json" };
    if (service) headers.authorization = `Bearer ${key}`;
    else if (accessToken) headers.authorization = `Bearer ${accessToken}`;
    let response;
    try {
      response = await fetchImpl(`${productionSupabaseOrigin}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000), redirect: "error" });
    } catch { throw new AuditFailure(`${code}_transport`); }
    if (!response.ok) throw new AuditFailure(code, response.status);
    try { return await response.json(); } catch { throw new AuditFailure(`${code}_payload`, response.status); }
  }

  async function ownProfile(service = false) {
    const rows = await request(`/rest/v1/profiles?id=eq.${accountId}&select=id,public_uid,role,account_status,avatar_url&limit=1`, { service, code: "profile_read_failed" });
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0].id !== accountId) throw new AuditFailure("profile_identity_mismatch");
    return rows[0];
  }

  async function cleanupAccount() {
    if (!accountId) return;
    report.cleanup = "retained_unverified";
    const payload = await request(`/auth/v1/admin/users/${accountId}`, { service: true, code: "cleanup_identity_read_failed" });
    const user = payload.user || payload;
    if (user.id !== accountId || user.email !== email || user.app_metadata?.mentor_checkout_audit_id !== auditId) throw new AuditFailure("cleanup_identity_mismatch");
    const profile = await ownProfile(true);
    if (!["user", "member"].includes(profile.role)) throw new AuditFailure("cleanup_role_changed");
    for (const [table, column] of [["mentor_orders", "buyer_id"], ["mentor_payment_claims", "buyer_id"], ["mentor_profiles", "owner_id"]]) {
      const rows = await request(`/rest/v1/${table}?${column}=eq.${accountId}&select=id&limit=1`, { service: true, code: "cleanup_scope_read_failed" });
      const check = { mentor_orders: "orders_empty", mentor_payment_claims: "claims_empty", mentor_profiles: "mentor_binding_empty" }[table];
      report.cleanup_read_checks[check] = Array.isArray(rows) && rows.length === 0;
      if (!Array.isArray(rows) || rows.length) throw new AuditFailure("cleanup_account_has_related_activity");
    }
    await request(`/auth/v1/admin/users/${accountId}`, { service: true, method: "DELETE", body: { should_soft_delete: false }, code: "cleanup_delete_failed" });
    report.cleanup = "deleted_exact_created_account";
  }

  try {
    report.account_creation_attempted = true;
    report.cleanup = "creation_outcome_unknown";
    const created = await request("/auth/v1/admin/users", { service: true, method: "POST", body: { email, password, email_confirm: true, user_metadata: { display_name: "导师下单验收用户" }, app_metadata: { mentor_checkout_audit_id: auditId } }, code: "account_create_failed" });
    const user = created.user || created;
    // Do not retry creation after an ambiguous response or infer an existing ID.
    if (!uuidPattern.test(user.id || "")) throw new AuditFailure("created_account_identity_invalid");
    accountId = user.id;
    report.account_created = true;
    report.account_uuid = accountId;
    report.cleanup = "pending";
    if (user.email !== email || user.app_metadata?.mentor_checkout_audit_id !== auditId) throw new AuditFailure("created_account_identity_mismatch");
    const session = await request("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password }, code: "account_sign_in_failed" });
    if (session.user?.id !== accountId || typeof session.access_token !== "string" || !session.access_token) throw new AuditFailure("session_identity_mismatch");
    accessToken = session.access_token;
    report.authenticated = true;
    const profile = await ownProfile();
    if (!["user", "member"].includes(profile.role) || profile.account_status !== "active") throw new AuditFailure("student_profile_not_active");
    report.ordinary_student = true;
    if (profile.public_uid == null) {
      await request("/rest/v1/rpc/start_uid_selection", { method: "POST", body: {}, code: "uid_start_failed" });
      await request("/rest/v1/rpc/complete_uid_selection", { method: "POST", body: {}, code: "uid_complete_failed" });
    }
    const activated = await ownProfile();
    if (!Number.isSafeInteger(activated.public_uid) || activated.public_uid < 10000 || activated.public_uid > 999999) throw new AuditFailure("student_uid_invalid");
    report.public_uid = activated.public_uid;
    report.account_avatar_configured = typeof activated.avatar_url === "string" && Boolean(activated.avatar_url.trim());
    const loginResponse = await siteRequest("/api/auth/login", { method: "POST", body: { identifier: email, password }, code: "site_login_failed" });
    let loginResult;
    try { loginResult = await loginResponse.json(); } catch { throw new AuditFailure("site_login_payload_invalid"); }
    if (loginResult.ok !== true || loginResult.needsUidActivation !== false) throw new AuditFailure("site_login_not_activated");
    if (typeof loginResponse.headers.getSetCookie !== "function") throw new AuditFailure("site_session_cookie_api_unavailable");
    const cookiePairs = loginResponse.headers.getSetCookie().map((value) => value.split(";", 1)[0]).filter((value) => /^sb-odmtxwlnlvwldrjttyqu-auth-token(?:\.\d+)?=/.test(value));
    if (!cookiePairs.length) throw new AuditFailure("site_session_cookie_missing");
    siteCookie = cookiePairs.join("; ");
    report.site_login_http_ok = true;
    report.site_uid_activation_not_needed = true;
    const catalog = await request("/rest/v1/rpc/list_mentor_catalog", { method: "POST", body: {}, code: "catalog_read_failed" });
    if (!Array.isArray(catalog)) throw new AuditFailure("catalog_payload_invalid");
    for (const mentor of catalog) {
      if (!uuidPattern.test(mentor.mentor_id || "")) throw new AuditFailure("catalog_mentor_identity_invalid");
      const methods = await request("/rest/v1/rpc/list_mentor_payment_methods", { method: "POST", body: { p_mentor_id: mentor.mentor_id }, code: "payment_methods_read_failed" });
      if (!Array.isArray(methods)) throw new AuditFailure("payment_methods_payload_invalid");
      const offerCount = Array.isArray(mentor.offers) ? mentor.offers.length : 0;
      const avatarUrl = typeof mentor.avatar_url === "string" ? mentor.avatar_url : "";
      const checkoutPage = await inspectCheckoutPage(mentor.mentor_id, methods);
      report.mentors.push({ mentor_id: mentor.mentor_id, avatar_configured: Boolean(avatarUrl.trim()), avatar_source: avatarUrl.includes("/storage/v1/object/public/profile-avatars/") ? "site_profile_storage" : avatarUrl.trim() ? "catalog_fallback" : "none", offer_count: offerCount, payment_methods: methods.map(paymentSummary), checkout_page: checkoutPage });
      report.counts.mentors++;
      report.counts.offers += offerCount;
      report.counts.payment_methods += methods.length;
    }
    report.ok = true;
  } catch (error) {
    report.error = error instanceof AuditFailure ? { code: error.code, status: error.status } : { code: "audit_internal_failure", status: null };
  } finally {
    try { await cleanupAccount(); } catch (error) {
      report.ok = false;
      report.cleanup_error = error instanceof AuditFailure ? { code: error.code, status: error.status } : { code: "cleanup_internal_failure", status: null };
    }
    accessToken = null;
    siteCookie = null;
    report.completed_at = new Date().toISOString();
  }
  return report;
}

if (process.argv[1] === "-" || /(?:^|\/)mentor-account-audit\.mjs$/.test(process.argv[1] || "")) {
  try {
    const settings = readAuditSettings(fs.readFileSync("/etc/elliott-wave/gateway.env", "utf8"));
    const report = await auditDisposableMentorAccount({ settings, auditId: process.argv[2] });
    console.log(JSON.stringify(report));
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: { code: error instanceof AuditFailure ? error.code : "server_settings_unavailable" } }));
    process.exitCode = 1;
  }
}
