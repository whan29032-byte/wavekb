import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import test from "node:test";
import { reconstructPositionIdCycles } from "../src/trading/cycles.ts";
import { ExnessTradingProviderAdapter } from "../src/trading/providers/exness.ts";
import type { ProviderAccount, ProviderHistoryPage } from "../src/trading/providers/contracts.ts";

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const now = Date.parse("2026-11-24T12:00:00.000Z");
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const privateJwk = privateKey.export({ format: "jwk" });
const privateHex = Buffer.concat([
  Buffer.from(privateJwk.d ?? "", "base64url"),
  Buffer.from(privateJwk.x ?? "", "base64url"),
]).toString("hex");

function credentials(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    api_key: "exnsk-test-key", private_key: privatePem, discovery_base_url: "https://gateway.exness.com",
    account_ids: JSON.stringify(["101", "202"]), trading_scope: "read_only", ...overrides,
  };
}

function account(overrides: Partial<ProviderAccount> = {}): ProviderAccount {
  return {
    connection_id: "55555555-5555-4555-8555-555555555555", external_account_id: "101", account_currency: "USD",
    credentials: credentials({ account_ids: JSON.stringify(["101"]) }),
    capabilities: {
      products: ["cfd"], history_age_days: 120, history_range_days: 14, page_size: 200, pagination: "opaque",
      position_grouping: "position_id_cycle", has_position_id: true, has_realized_pnl: true, has_fee_asset: true,
      has_funding_or_swap: true, has_external_cash_flow: true, has_usd_valuation: true, account_currency: "USD",
      settlement_assets: ["USD"], valuation_pairs: ["USD"],
    },
    ...overrides,
  };
}

function limits() {
  return { limits: { rest: { global_account_rate: { limit: 10, window_seconds: 1 }, methods: [{ api_operation_id: "getDealsHistory", http_method: "GET", path: "/v1/history/accounts/{account_id}/deals", rate_limit: { limit: 5, window_seconds: 1 }, limits: { history_age_days: 120, history_range_days: 14 } }] }, websocket: { global_account_limits: {}, endpoints: [] } } };
}

test("signs exact EXN-DATA bytes, discovers official access points, and validates 1-10 read-only accounts", async () => {
  const calls: Array<{ url: URL; headers: Headers }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, headers: new Headers(init?.headers) });
    if (url.pathname === "/v1/trading/access-point") return json({ access_point: "https://ap-demo.exness.com" });
    if (url.pathname.endsWith("/account")) {
      const id = url.pathname.split("/").at(-2);
      return json({ account_id: id, account_name: `Trading ${id}`, create_date: "2026-01-01T00:00:00Z", settings: { currency: "USD", leverage: "100", trade_mode: "enabled", account_status: "active", execution_mode: "market" } });
    }
    if (url.pathname.endsWith("/limits")) return json(limits());
    throw new Error(`unexpected path ${url.pathname}`);
  };
  const adapter = new ExnessTradingProviderAdapter(fetcher, () => now);
  const validated = await adapter.validateCredentials({
    provider: "exness",
    credentials: credentials({ private_key: `\n  ${privateHex}  \n` }),
    read_only_ack: true,
  });
  assert.equal(validated.length, 2);
  assert.deepEqual(validated.map((item) => item.external_account_id), ["101", "202"]);
  assert.deepEqual(validated.map((item) => item.account_identifier_mask), ["••••101", "••••202"]);
  assert.ok(calls.length >= 6);
  for (const call of calls) {
    assert.equal(call.headers.get("EXN-API-KEY"), "exnsk-test-key");
    assert.equal(call.headers.get("EXN-TIMESTAMP"), String(now));
    assert.equal(call.headers.get("EXN-SIGN-VERSION"), "1");
    assert.equal(call.headers.get("EXN-IDEMPOTENCY-KEY"), "");
    const data = Buffer.from(call.headers.get("EXN-DATA") ?? "", "base64url");
    const signed = JSON.parse(data.toString("utf8")) as Record<string, unknown>;
    assert.equal(signed.method, "GET");
    assert.equal(signed.path, `${call.url.pathname}${call.url.search}`);
    assert.equal(signed.body_hash, "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU");
    assert.equal(verify(null, data, publicKey, Buffer.from(call.headers.get("EXN-SIGN") ?? "", "base64url")), true);
  }
});

test("rejects a generated Exness private key whose public half does not match its seed before fetch", async () => {
  let fetches = 0;
  const adapter = new ExnessTradingProviderAdapter(async () => {
    fetches += 1;
    return json({});
  }, () => now);
  const mismatched = `${privateHex.slice(0, 64)}${"0".repeat(64)}`;
  await assert.rejects(
    () => adapter.validateCredentials({
      provider: "exness",
      credentials: credentials({ private_key: mismatched, account_ids: JSON.stringify(["101"]) }),
      read_only_ack: true,
    }),
    /exness_invalid_private_key/,
  );
  assert.equal(fetches, 0);
});

test("maps official Exness authentication failures to fixed actionable errors", async () => {
  const cases = [
    [1000, "exness_invalid_api_key", 401],
    [1001, "exness_invalid_signature", 401],
    [1002, "exness_permission_denied", 403],
  ] as const;
  for (const [code, expected, status] of cases) {
    const adapter = new ExnessTradingProviderAdapter(async () => json({ code, error_message: "private upstream detail" }, status), () => now);
    await assert.rejects(
      () => adapter.validateCredentials({
        provider: "exness",
        credentials: credentials({ account_ids: JSON.stringify(["101"]) }),
        read_only_ack: true,
      }),
      (error: unknown) => error instanceof Error
        && error.message === expected
        && !error.message.includes("private upstream detail"),
    );
  }
});

test("uses live history limits, decimal snapshots, and opaque deal cursors", async () => {
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/trading/access-point") return json({ access_point: "https://ap-demo.exness.com" });
    if (url.pathname.endsWith("/limits")) return json(limits());
    if (url.pathname.endsWith("/snapshot")) return json({ orders: [], positions: [], account_state: { balance: "1000.125", equity: "1010.375", used_margin: "25.5" } });
    if (url.pathname.endsWith("/deals")) return json({ items: [], next_cursor: "opaque-next", has_more: true, range: { from: "2026-11-10T12:00:00Z", to: "2026-11-24T12:00:00Z" } });
    throw new Error(`unexpected path ${url.pathname}`);
  };
  const adapter = new ExnessTradingProviderAdapter(fetcher, () => now);
  const discovered = await adapter.discoverCapabilities(account());
  assert.equal(discovered.history_age_days, 120);
  assert.equal(discovered.history_range_days, 14);
  const snapshot = await adapter.fetchAccountSnapshot(account());
  assert.equal(snapshot.equity, "1010.375");
  assert.equal(snapshot.unrealized_pnl, "10.25");
  const history = await adapter.fetchHistory(account(), { kind: "opaque", value: null });
  const cursor = JSON.parse(history.cursor.value ?? "null") as Record<string, unknown>;
  assert.equal(cursor.provider_cursor, "opaque-next");
  assert.equal(cursor.window_from, "2026-11-10T12:00:00.000Z");
  assert.equal(cursor.window_to, "2026-11-24T12:00:00.000Z");
  const second = await adapter.fetchHistory(account(), history.cursor);
  assert.equal(second.cursor.kind, "opaque");
});

test("walks backward through provider-sized Exness history windows until the live age limit", async () => {
  const windows: Array<[string | null, string | null]> = [];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/trading/access-point") return json({ access_point: "https://ap-demo.exness.com" });
    if (url.pathname.endsWith("/deals")) {
      windows.push([url.searchParams.get("from"), url.searchParams.get("to")]);
      return json({ items: [], has_more: false });
    }
    throw new Error(`unexpected path ${url.pathname}`);
  };
  const adapter = new ExnessTradingProviderAdapter(fetcher, () => now);
  const narrowAccount = account({ capabilities: { ...account().capabilities, history_age_days: 30, history_range_days: 10 } });
  let cursor: ProviderHistoryPage["cursor"] = { kind: "opaque", value: null };
  do {
    const page = await adapter.fetchHistory(narrowAccount, cursor);
    cursor = page.cursor;
  } while (cursor.value !== null);
  assert.deepEqual(windows, [
    ["2026-11-14T12:00:00.000Z", "2026-11-24T12:00:00.000Z"],
    ["2026-11-04T12:00:00.000Z", "2026-11-14T12:00:00.000Z"],
    ["2026-10-25T12:00:00.000Z", "2026-11-04T12:00:00.000Z"],
  ]);
});

test("keeps same-symbol position IDs separate through partial close and classifies swap, balance, admin fee, and dividend", () => {
  const adapter = new ExnessTradingProviderAdapter();
  const deal = (event_time: string, fields: Record<string, unknown>) => ({ event_time, deal: fields });
  const page: ProviderHistoryPage = {
    fetched_at: "2026-11-24T12:00:00Z", cursor: { kind: "opaque", value: null },
    payload: {
      connection_id: account().connection_id, account_currency: "USD", has_more: false,
      items: [
        deal("2026-11-24T01:00:00Z", { deal_id: "1", order_id: "o1", position_id: "p1", type: "open", direction: "buy", instrument: "XAUUSD", volume: "2", price: "2000.10", profit: { amount: "0", currency: "USD" }, commission: "-1.25", create_time: "2026-11-24T01:00:00Z" }),
        deal("2026-11-24T01:30:00Z", { deal_id: "2", order_id: "o2", position_id: "p2", type: "open", direction: "buy", instrument: "XAUUSD", volume: "1", price: "2001.20", profit: { amount: "0", currency: "USD" }, commission: "-0.75", create_time: "2026-11-24T01:30:00Z" }),
        deal("2026-11-24T02:00:00Z", { deal_id: "3", order_id: "o3", position_id: "p1", type: "close", direction: "sell", instrument: "XAUUSD", volume: "1", price: "2010", profit: { amount: "9.9", currency: "USD" }, commission: "-0.5", create_time: "2026-11-24T02:00:00Z" }),
        deal("2026-11-24T02:15:00Z", { deal_id: "4", position_id: "p1", type: "swap_fee", instrument: "XAUUSD", profit: { amount: "-2", currency: "USD" }, commission: "0", create_time: "2026-11-24T02:15:00Z" }),
        deal("2026-11-24T02:30:00Z", { deal_id: "5", position_id: "p1", type: "dividend", instrument: "XAUUSD", profit: { amount: "3", currency: "USD" }, commission: "0", create_time: "2026-11-24T02:30:00Z" }),
        deal("2026-11-24T02:45:00Z", { deal_id: "6", type: "balance", profit: { amount: "100", currency: "USD" }, commission: "0", create_time: "2026-11-24T02:45:00Z" }),
        deal("2026-11-24T02:50:00Z", { deal_id: "9", type: "admin_fee", profit: { amount: "-4", currency: "USD" }, commission: "0", create_time: "2026-11-24T02:50:00Z" }),
        deal("2026-11-24T03:00:00Z", { deal_id: "7", order_id: "o7", position_id: "p2", type: "close", direction: "sell", instrument: "XAUUSD", volume: "1", price: "2012", profit: { amount: "10.8", currency: "USD" }, commission: "-0.5", create_time: "2026-11-24T03:00:00Z" }),
        deal("2026-11-24T03:30:00Z", { deal_id: "8", order_id: "o8", position_id: "p1", type: "close", direction: "sell", instrument: "XAUUSD", volume: "1", price: "2015", profit: { amount: "14.9", currency: "USD" }, commission: "-0.5", create_time: "2026-11-24T03:30:00Z" }),
      ],
    },
  };
  const batch = adapter.normalizeHistory(page);
  assert.equal(batch.fills.length, 5);
  assert.deepEqual(batch.cash_events.map((event) => [event.type, event.native_position_id, event.amount]), [
    ["swap_fee", "p1", "-2"], ["dividend", "p1", "3"], ["deposit", null, "100"], ["admin_adjustment", null, "-4"],
  ]);
  const cycles = reconstructPositionIdCycles({ provider: "exness", connection_id: account().connection_id, account_currency: "USD", fills: batch.fills, cash_events: batch.cash_events });
  assert.equal(cycles.length, 2);
  assert.deepEqual(cycles.map((cycle) => [cycle.native_position_id, cycle.fill_ids]), [["p1", ["1", "3", "8"]], ["p2", ["2", "7"]]]);
  assert.equal(cycles[0]?.funding_or_swap, "-2");
  assert.equal(cycles[0]?.dividends, "3");
});

test("rejects full-access scopes and malicious discovery hosts before sending account requests", async () => {
  const adapter = new ExnessTradingProviderAdapter(async () => json({ access_point: "http://127.0.0.1:8080" }), () => now);
  await assert.rejects(() => adapter.validateCredentials({ provider: "exness", credentials: credentials({ trading_scope: "full_access", account_ids: JSON.stringify(["101"]) }), read_only_ack: true }), /read_only_scope_required/);
  await assert.rejects(() => adapter.validateCredentials({ provider: "exness", credentials: credentials({ account_ids: JSON.stringify(["101"]) }), read_only_ack: true }), /access_point_not_allowed/);
});
