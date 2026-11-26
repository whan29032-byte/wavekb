import assert from "node:assert/strict";
import test from "node:test";
import type {
  CanonicalAccountSnapshot,
  CanonicalCashEvent,
  CanonicalFill,
  CanonicalHistoryBatch,
  ProviderAccount,
  ProviderCapabilities,
  ProviderCredentialInput,
  ProviderCursor,
  ProviderHistoryPage,
  TradingProviderAdapter,
} from "../src/trading/providers/contracts.ts";
import {
  TradingSyncService,
  hashExternalTradingAccount,
  type SyncConnectionRecord,
  type SyncPublication,
  type TradingSyncStore,
} from "../src/trading/sync-service.ts";

const owner = "11111111-1111-4111-8111-111111111111";
const connectionId = "22222222-2222-4222-8222-222222222222";
const credentialId = "33333333-3333-4333-8333-333333333333";
const now = Date.parse("2026-11-24T12:00:00.000Z");
const identityKey = Buffer.alloc(32, 8);

const capabilities: ProviderCapabilities = {
  products: ["usdt_perpetual"], history_age_days: 90, history_range_days: 7,
  page_size: 100, pagination: "time", position_grouping: "net_zero_cycle",
  has_position_id: false, has_realized_pnl: true, has_fee_asset: true,
  has_funding_or_swap: true, has_external_cash_flow: true, has_usd_valuation: true,
  account_currency: "USDT", settlement_assets: ["USDT"], valuation_pairs: [],
};

function fill(id: string, occurredAt: string, action: "open" | "close", side: "buy" | "sell", pnl = "0"): CanonicalFill {
  return {
    provider: "binance", connection_id: connectionId, native_fill_id: id, native_order_id: `order-${id}`,
    native_position_id: null, symbol: "BTCUSDT", native_symbol: "BTCUSDT", product: "usdt_perpetual",
    side, position_side: "both", action, price: action === "open" ? "100" : "110", quantity: "1",
    contract_multiplier: "1", occurred_at: occurredAt,
    realized_pnl: { amount: pnl, asset: "USDT", usd_value: pnl },
    fee: { amount: "-1", asset: "USDT", usd_value: "-1" }, liquidity: "taker",
  };
}

function snapshot(): CanonicalAccountSnapshot {
  return {
    provider: "binance", connection_id: connectionId, captured_at: new Date(now).toISOString(),
    account_currency: "USDT", equity: "1100", wallet_balance: "1090", unrealized_pnl: "10",
    usd_equity: "1100", usd_wallet_balance: "1090", usd_unrealized_pnl: "10",
    valuation: { status: "approximate", rate: "1", source: "USDT approximate", path: ["USDT", "USD"], quoted_at: new Date(now).toISOString() },
  };
}

function batch(options: Partial<CanonicalHistoryBatch> = {}): CanonicalHistoryBatch {
  return {
    fills: [], cash_events: [], next_cursor: { kind: "time", value: String(now - 60_000) }, exhausted: true,
    coverage_started_at: new Date(now - 90 * 86_400_000).toISOString(),
    coverage_ended_at: new Date(now).toISOString(), warnings: [], ...options,
  };
}

class Adapter implements TradingProviderAdapter {
  readonly provider = "binance" as const;
  pages: Array<CanonicalHistoryBatch | Error>;
  cursors: ProviderCursor[] = [];
  validateCalls = 0;

  constructor(pages: Array<CanonicalHistoryBatch | Error>) { this.pages = [...pages]; }
  async validateCredentials(_input: ProviderCredentialInput) {
    this.validateCalls += 1;
    return [{ external_account_id: "account-1001", account_label: "Binance 1001", account_identifier_mask: "••••1001", account_currency: "USDT", products: ["usdt_perpetual" as const], read_only_status: "verified" as const }];
  }
  async discoverCapabilities() { return capabilities; }
  async fetchAccountSnapshot(_account: ProviderAccount) { return snapshot(); }
  async fetchHistory(_account: ProviderAccount, cursor: ProviderCursor): Promise<ProviderHistoryPage> {
    this.cursors.push({ ...cursor });
    const next = this.pages.shift();
    if (next instanceof Error) throw next;
    if (!next) throw new Error("unexpected_history_fetch");
    return { payload: next, cursor: next.next_cursor ?? cursor, fetched_at: new Date(now).toISOString() };
  }
  normalizeHistory(page: ProviderHistoryPage) { return page.payload as CanonicalHistoryBatch; }
}

class Store implements TradingSyncStore {
  connection: SyncConnectionRecord = {
    id: connectionId, owner_id: owner, provider: "binance", credential_set_id: credentialId,
    external_account_id_hash: hashExternalTradingAccount(identityKey, "binance", "account-1001"),
    account_currency: "USDT", capabilities, sync_generation: 0, status: "active",
    last_synced_at: null, history_coverage_started_at: null, data_hidden_at: null,
  };
  cursor: ProviderCursor | null = null;
  existingFills: CanonicalFill[] = [];
  existingCash: CanonicalCashEvent[] = [];
  previousCycles: any[] = [];
  claimResult = true;
  claimCalls = 0;
  publication: SyncPublication | null = null;
  publications = 0;
  failures: string[] = [];
  dueConnections: SyncConnectionRecord[] = [];
  publishError: Error | null = null;

  async getConnection(id: string) { return id === this.connection.id ? this.connection : null; }
  async listDueConnections() { return this.dueConnections; }
  async claim() { this.claimCalls += 1; return this.claimResult; }
  async loadCredentialEnvelope() { return { ciphertext: "cipher", iv: "iv", auth_tag: "tag", key_version: 1, last_four: "" }; }
  async bindExternalAccountHash(_ownerId: string, _connectionId: string, hash: string) { this.connection.external_account_id_hash = hash; }
  async loadCursor() { return this.cursor; }
  async loadHistory() { return { fills: this.existingFills, cash_events: this.existingCash, previous_cycles: this.previousCycles }; }
  async publish(input: SyncPublication) {
    if (this.publishError) throw this.publishError;
    this.publication = input; this.publications += 1; this.cursor = input.cursor;
    this.connection.sync_generation += 1; this.connection.last_synced_at = input.snapshot.captured_at;
    return this.connection.sync_generation;
  }
  async recordFailure(_connection: SyncConnectionRecord, _workerId: string, code: string) { this.failures.push(code); }
}

function service(store: Store, adapter: Adapter, enabledProviders: Array<"binance"> = ["binance"]) {
  return new TradingSyncService({
    store, adapters: new Map([["binance", adapter]]), enabledProviders: new Set(enabledProviders),
    workerId: "44444444-4444-4444-8444-444444444444", identityKey,
    masterKey: Buffer.alloc(32, 7), now: () => now, syncIntervalMs: 15 * 60_000,
    decrypt: () => JSON.stringify({ apiKey: "api-key", secretKey: "secret-key" }),
  });
}

test("performs the first 90-day backfill and deduplicates overlapping facts before one atomic publication", async () => {
  const store = new Store();
  const duplicate = fill("fill-1", "2026-09-01T00:00:00.000Z", "open", "buy");
  store.existingFills = [duplicate];
  const adapter = new Adapter([batch({ fills: [duplicate, fill("fill-2", "2026-09-01T01:00:00.000Z", "close", "sell", "12")] })]);
  const result = await service(store, adapter).syncConnection(connectionId);
  assert.equal(result.status, "published");
  assert.deepEqual(adapter.cursors, [{ kind: "time", value: null }]);
  assert.equal(store.publication?.fills.length, 2);
  assert.equal(store.publication?.cycles.length, 1);
  assert.deepEqual(store.publication?.cycles[0]?.allocations, [
    { native_fill_id: "fill-1", quantity: "1", role: "open", sort_order: 0 },
    { native_fill_id: "fill-2", quantity: "1", role: "close", sort_order: 1 },
  ]);
  assert.equal(store.publication?.coverage_started_at, "2026-08-26T12:00:00.000Z");
  assert.equal(store.publications, 1);
});

test("preserves an opaque cursor and does not advance it when a later page fails", async () => {
  const store = new Store();
  store.connection.capabilities = { ...capabilities, pagination: "opaque" };
  store.cursor = { kind: "opaque", value: "saved-cursor" };
  const first = batch({ next_cursor: { kind: "opaque", value: "next-cursor" }, exhausted: false });
  const adapter = new Adapter([first, new Error("provider_page_failed")]);
  await assert.rejects(() => service(store, adapter).syncConnection(connectionId), /provider_page_failed/);
  assert.deepEqual(store.cursor, { kind: "opaque", value: "saved-cursor" });
  assert.equal(store.publications, 0);
  assert.deepEqual(adapter.cursors, [{ kind: "opaque", value: "saved-cursor" }, { kind: "opaque", value: "next-cursor" }]);

  const retryAdapter = new Adapter([batch({ next_cursor: { kind: "opaque", value: "final-cursor" } })]);
  await service(store, retryAdapter).syncConnection(connectionId);
  assert.deepEqual(retryAdapter.cursors[0], { kind: "opaque", value: "saved-cursor" });
  assert.deepEqual(store.cursor, { kind: "opaque", value: "final-cursor" });
});

test("rejects concurrent leases and records stale generation publication safely", async () => {
  const store = new Store();
  store.claimResult = false;
  const adapter = new Adapter([batch()]);
  assert.deepEqual(await service(store, adapter).syncConnection(connectionId), { status: "skipped", reason: "lease_unavailable", connection_id: connectionId });
  assert.equal(adapter.validateCalls, 0);

  store.claimResult = true;
  store.publishError = Object.assign(new Error("stale_sync_generation"), { statusCode: 409 });
  await assert.rejects(() => service(store, new Adapter([batch()])).syncConnection(connectionId), /stale_sync_generation/);
  assert.deepEqual(store.failures, ["stale_sync_generation"]);
  assert.equal(store.cursor, null);
});

test("rebuilds a reviewed cycle identity when a late closing fill arrives", async () => {
  const store = new Store();
  const opening = fill("open-1", "2026-11-20T00:00:00.000Z", "open", "buy");
  store.existingFills = [opening];
  store.previousCycles = [{
    id: "55555555-5555-4555-8555-555555555555", created_at: "2026-11-20T00:05:00.000Z",
    anchor_fill_id: "open-1", fill_ids: ["open-1"], revision: 1, fill_digest: "old-digest", has_review: true,
  }];
  const closing = fill("close-1", "2026-11-21T00:00:00.000Z", "close", "sell", "15");
  await service(store, new Adapter([batch({ fills: [closing] })])).syncConnection(connectionId);
  assert.equal(store.publication?.cycles[0]?.id, "55555555-5555-4555-8555-555555555555");
  assert.equal(store.publication?.cycles[0]?.revision, 2);
  assert.equal(store.publication?.cycles[0]?.closed_at, "2026-11-21T00:00:00.000Z");
  assert.deepEqual(store.publication?.cycles[0]?.fill_ids, ["open-1", "close-1"]);
  assert.deepEqual(store.publication?.cycles[0]?.allocations, [
    { native_fill_id: "open-1", quantity: "1", role: "open", sort_order: 0 },
    { native_fill_id: "close-1", quantity: "1", role: "close", sort_order: 1 },
  ]);
});

test("isolates one connection failure while synchronizing the remaining due accounts", async () => {
  const store = new Store();
  const second = { ...store.connection, id: "66666666-6666-4666-8666-666666666666" };
  store.dueConnections = [store.connection, second];
  const adapter = new Adapter([new Error("first_failed"), batch()]);
  const originalGet = store.getConnection.bind(store);
  store.getConnection = async (id) => id === second.id ? second : originalGet(id);
  const result = await service(store, adapter).syncDueConnections(10);
  assert.deepEqual(result, { checked: 2, published: 1, skipped: 0, failed: 1 });
});

test("throttles repeated manual sync and skips providers disabled by a runtime flag", async () => {
  const store = new Store();
  store.connection.last_synced_at = new Date(now - 60_000).toISOString();
  const adapter = new Adapter([batch()]);
  assert.deepEqual(await service(store, adapter).syncConnection(connectionId, { manual: true }), { status: "skipped", reason: "manual_throttled", connection_id: connectionId });
  store.connection.last_synced_at = null;
  assert.deepEqual(await service(store, adapter, []).syncConnection(connectionId), { status: "skipped", reason: "provider_disabled", connection_id: connectionId });
  assert.equal(store.publications, 0);
});

test("rejects a manual sync for a connection owned by another user before claiming its lease", async () => {
  const store = new Store();
  const adapter = new Adapter([batch()]);
  await assert.rejects(
    () => service(store, adapter).syncConnection(connectionId, { manual: true, owner_id: "99999999-9999-4999-8999-999999999999" }),
    /exchange_connection_not_found/,
  );
  assert.equal(store.claimCalls, 0);
  assert.equal(adapter.validateCalls, 0);
});

test("publishes explicit valuation gaps instead of inventing USD values", async () => {
  const store = new Store();
  store.connection.account_currency = "EUR";
  const adapter = new Adapter([batch()]);
  adapter.fetchAccountSnapshot = async () => ({ ...snapshot(), account_currency: "EUR", equity: "1000", wallet_balance: "1000", unrealized_pnl: "0", usd_equity: null, usd_wallet_balance: null, usd_unrealized_pnl: null, valuation: { status: "unavailable", rate: null, source: null, path: ["EUR"], quoted_at: null } });
  await service(store, adapter).syncConnection(connectionId);
  assert.equal(store.publication?.snapshot.valuation_status, "unavailable");
  assert.equal(store.publication?.snapshot.usd_equity, null);
  assert.ok(store.publication?.warnings.includes("valuation_unavailable"));
});
