import { fileURLToPath } from "node:url";

const origin = "https://wavekb.com";

function sessionCookies(response) {
  return response.headers.getSetCookie().map((cookie) => cookie.split(";", 1)[0])
    .filter((cookie) => /^sb-[a-z0-9-]+-auth-token(?:\.\d+)?=\S+$/i.test(cookie)).join("; ");
}

export function eligibleStrategyTrades(workbench) {
  const active = (workbench?.connections ?? []).filter((connection) => connection.status === "active"
    && ["verified", "user_attested"].includes(connection.read_only_status));
  const ids = new Set(active.map((connection) => connection.id));
  const trades = (workbench?.trades ?? []).filter((trade) => ids.has(trade.connection_id)
    && trade.completeness === "complete" && trade.closed_at !== null
    && Number.isFinite(Date.parse(trade.opened_at)) && Date.parse(trade.closed_at) >= Date.parse(trade.opened_at));
  return { trades, usableConnections: active.length };
}

export async function checkStrategyPilot({ identifier, password }, fetcher = fetch) {
  if (!identifier || !password) throw new Error("strategy_acceptance_credentials_missing");
  const request = (path, options) => fetcher(new URL(path, origin), {
    ...options, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
  });
  const signedIn = await request("/api/auth/login", {
    method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ identifier, password }),
  });
  const login = await signedIn.json().catch(() => null);
  const cookie = sessionCookies(signedIn);
  if (!signedIn.ok || login?.ok !== true || login.needsUidActivation !== false || !cookie) {
    throw new Error(`strategy_acceptance_login_failed_${signedIn.status}`);
  }

  const dashboard = await request("/api/trading/workbench?range=all&timezone=UTC", { headers: { cookie } });
  if (!dashboard.ok) throw new Error(`strategy_acceptance_workbench_failed_${dashboard.status}`);
  const { trades, usableConnections } = eligibleStrategyTrades((await dashboard.json()).workbench);
  if (trades.length === 0) {
    if (usableConnections === 0) throw new Error("strategy_acceptance_no_read_only_connection");
    throw new Error("strategy_acceptance_no_eligible_trade");
  }

  const profile = await request("/member/profile", { headers: { cookie } });
  const html = await profile.text();
  const uid = /<a\b[^>]*\bhref="\/member\/([1-9]\d{4,5})"[^>]*>\s*取消\s*<\/a>/.exec(html)?.[1];
  if (!profile.ok || !uid) throw new Error("strategy_acceptance_uid_missing");
  return { uid, eligibleTrades: trades.length, usableConnections };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const result = await checkStrategyPilot({
      identifier: process.env.E2E_POSTING_IDENTIFIER, password: process.env.E2E_POSTING_PASSWORD,
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    const code = error instanceof Error && /^strategy_acceptance_[a-z0-9_]+$/.test(error.message)
      ? error.message : "strategy_acceptance_request_failed";
    console.error(code);
    process.exitCode = 1;
  }
}
