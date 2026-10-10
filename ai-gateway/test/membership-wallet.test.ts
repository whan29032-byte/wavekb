import assert from "node:assert/strict";
import test from "node:test";
import { evmAddress, tronAddressToHex, tronHexToAddress } from "../src/membership-wallet/address.ts";
import { loadMembershipWalletVerificationConfig } from "../src/membership-wallet/config.ts";
import { WALLET_ROUTES } from "../src/membership-wallet/contracts.ts";
import type { ClaimedWalletVerification, WalletRouteId } from "../src/membership-wallet/contracts.ts";
import { verifyMembershipWalletTransfer } from "../src/membership-wallet/verifier.ts";
import { runMembershipWalletVerificationCycle } from "../src/membership-wallet/worker.ts";
import { walletRpcRequest } from "../src/membership-wallet/rpc.ts";

const now = Date.parse("2026-10-10T10:00:00Z"), paidAt = now - 10000;
const txHash = `0x${"a".repeat(64)}`, blockHash = `0x${"b".repeat(64)}`, recipient = `0x${"1".repeat(40)}`;
const receiverTron = "TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL";
const uuid = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const env = { MEMBERSHIP_WALLET_ENABLED: "true", MEMBERSHIP_WALLET_ETHEREUM_RPC_URL: "https://ethereum.rpc.example.com/private-synthetic-path",
  MEMBERSHIP_WALLET_BASE_RPC_URL: "https://base.rpc.example.com/private-synthetic-path", MEMBERSHIP_WALLET_RPC_ALLOWED_HOSTS: "ethereum.rpc.example.com,base.rpc.example.com" };
const config = loadMembershipWalletVerificationConfig(env);
const decimal = (units: string) => `${BigInt(units) / 1000000n}.${(BigInt(units) % 1000000n).toString().padStart(6, "0")}`;
function job(routeId: WalletRouteId = "ethereum-usdt", units = "52000123"): ClaimedWalletVerification {
  const route = WALLET_ROUTES[routeId];
  return { id: uuid(1), order_id: uuid(2), tx_hash: route.chain === "tron" ? txHash.slice(2) : txHash, status: "leased", attempts: 1,
    lease_id: uuid(3), lease_expires_at: new Date(now + 120000).toISOString(), order: { id: uuid(2), buyer_id: uuid(4), request_id: uuid(5), price_id: uuid(6),
      route_id: routeId, route_revision: 1, chain: route.chain, asset: route.asset, contract: route.contract,
      recipient: route.chain === "tron" ? receiverTron : recipient, amount_units: units, base_amount_units: (BigInt(units) - 123n).toString(), amount_decimal: decimal(units),
      created_at: new Date(now - 60000).toISOString(), expires_at: new Date(now + 600000).toISOString(), status: "pending" } };
}
function evmLog(routeId: WalletRouteId, amount = "52000123", to = recipient) {
  return { address: WALLET_ROUTES[routeId].contract, topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", `0x${"0".repeat(24)}${"2".repeat(40)}`, `0x${"0".repeat(24)}${to.slice(2)}`],
    data: `0x${BigInt(amount).toString(16).padStart(64, "0")}`, removed: false, transactionHash: txHash, blockHash, blockNumber: "0x100", logIndex: "0x7" };
}
function evmFixture(routeId: WalletRouteId = "ethereum-usdt", options: Record<string, any> = {}) {
  const receipt = { transactionHash: txHash, blockHash, blockNumber: "0x100", status: "0x1", logs: [evmLog(routeId)], ...options.receipt };
  let receiptCalls = 0; const calls: Record<string, any>[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body)); calls.push({ url: String(url), body, init });
    if (options.error) throw new Error(`synthetic-provider-secret ${String(url)}`);
    if (options.httpStatus) return new Response("private-provider-diagnostic", { status: options.httpStatus, headers: { "retry-after": "180" } });
    let result;
    if (body.method === "eth_chainId") result = options.chainId ?? (routeId === "base-usdc" ? "0x2105" : "0x1");
    else if (body.method === "eth_getTransactionReceipt") result = ++receiptCalls > 1 && options.fresh ? { ...receipt, ...options.fresh } : options.missing ? null : receipt;
    else if (body.params[0] === "finalized") result = options.finalized ?? { number: "0x101", hash: `0x${"c".repeat(64)}` };
    else result = { number: "0x100", hash: blockHash, timestamp: `0x${Math.floor((options.timestamp ?? paidAt) / 1000).toString(16)}`,
      transactions: [txHash], ...options.canonical };
    return new Response(JSON.stringify({ id: body.id, jsonrpc: "2.0", result }));
  };
  return { fetcher, calls, receipt };
}
function tronFixture(options: Record<string, any> = {}) {
  const log = { address: tronAddressToHex(WALLET_ROUTES["tron-usdt"].contract).slice(2), topics: ["ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    `${"0".repeat(24)}${"2".repeat(40)}`, `${"0".repeat(24)}${tronAddressToHex(receiverTron).slice(2)}`], data: BigInt(options.amount ?? "52000123").toString(16).padStart(64, "0"), ...options.log };
  const receipt = { id: txHash.slice(2), blockNumber: 256, blockTimeStamp: options.timestamp ?? paidAt, receipt: { result: "SUCCESS" }, log: [log], ...options.receipt };
  const calls: Record<string, any>[] = []; let receiptCalls = 0;
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init, body: JSON.parse(String(init?.body)) });
    if (options.error) throw new Error(`synthetic-provider-secret ${String(url)}`);
    let result;
    if (String(url).endsWith("gettransactioninfobyid")) result = ++receiptCalls > 1 && options.fresh ? { ...receipt, ...options.fresh } : options.missing ? {} : receipt;
    else if (String(url).endsWith("getnowblock")) result = { blockID: "c".repeat(64), block_header: { raw_data: { number: options.headNumber ?? 257 } } };
    else result = { blockID: blockHash.slice(2), block_header: { raw_data: { number: 256, timestamp: options.timestamp ?? paidAt } }, transactions: [{ txID: txHash.slice(2) }], ...options.canonical };
    return new Response(JSON.stringify(result));
  };
  return { fetcher, calls };
}
const verify = (value: ClaimedWalletVerification, fetcher: typeof fetch) => verifyMembershipWalletTransfer(value, config, { fetch: fetcher, now: () => now });

test("only four issuer-verified routes are supported, every amount has six decimals", () => {
  assert.deepEqual(Object.keys(WALLET_ROUTES), ["tron-usdt", "ethereum-usdt", "ethereum-usdc", "base-usdc"]);
  assert.ok(Object.values(WALLET_ROUTES).every(route => route.decimals === 6));
  assert.equal(WALLET_ROUTES["base-usdc"].chainId, 8453);
});
test("TRON Base58Check conversion matches documented public address and official USDT contract", () => {
  assert.equal(tronAddressToHex(receiverTron), "418840e6c55b9ada326d211d818c34a994aeced808");
  assert.equal(tronAddressToHex(WALLET_ROUTES["tron-usdt"].contract), "41a614f803b6fd780986a42c78ec9c7f77e6ded13c");
  assert.equal(tronHexToAddress(tronAddressToHex(receiverTron)), receiverTron);
  for (const invalid of [receiverTron.slice(0, -1) + "M", "T" + "1".repeat(33), "not-a-wallet", `0x${"1".repeat(40)}`]) assert.throws(() => tronAddressToHex(invalid));
  assert.throws(() => evmAddress(`0x${"0".repeat(40)}`));
});
test("default configuration disables all queue activity and ignores unused endpoint secrets", async () => {
  const disabled = loadMembershipWalletVerificationConfig({ MEMBERSHIP_WALLET_ETHEREUM_RPC_URL: "http://127.0.0.1:1/secret" });
  assert.equal(disabled.readiness, "disabled");
  const result = await runMembershipWalletVerificationCycle({ env: {}, workerId: "test", database: { request: async () => assert.fail("no claim while disabled") } });
  assert.equal(result.claimed, 0);
});
test("deployment endpoints require HTTPS and exact allowlisting, not prefixes or redirects", () => {
  for (const endpoint of ["http://ethereum.rpc.example.com/", "https://ethereum.rpc.example.com.attacker.com/", "https://user:pass@ethereum.rpc.example.com/", "https://127.0.0.1/", "https://ethereum.rpc.example.com:8443/", "https://ethereum.rpc.example.com/#secret"]) {
    assert.throws(() => loadMembershipWalletVerificationConfig({ ...env, MEMBERSHIP_WALLET_ETHEREUM_RPC_URL: endpoint }), /configuration_invalid/);
  }
  assert.throws(() => loadMembershipWalletVerificationConfig({ MEMBERSHIP_WALLET_ENABLED: "yes" }), /flag_invalid/);
  assert.throws(() => loadMembershipWalletVerificationConfig({ ...env, MEMBERSHIP_WALLET_VERIFY_BATCH_SIZE: "11" }), /batch_invalid/);
});
for (const routeId of ["ethereum-usdt", "ethereum-usdc", "base-usdc"] as const) {
  test(`${routeId} verifies canonical finalized exact Transfer, no signing or broadcast calls`, async () => {
    const fixture = evmFixture(routeId);
    const result = await verify(job(routeId), fixture.fetcher);
    assert.equal(result.outcome, "verified");
    if (result.outcome !== "verified") assert.fail();
    assert.deepEqual(result.evidence, { chain: WALLET_ROUTES[routeId].chain, contract: WALLET_ROUTES[routeId].contract, recipient, amount_units: "52000123",
      tx_hash: txHash, event_index: 0, block_number: 256, block_hash: blockHash, paid_at: new Date(paidAt).toISOString(), finalized: true });
    assert.ok(fixture.calls.every(call => ["eth_chainId", "eth_getTransactionReceipt", "eth_getBlockByNumber"].includes(call.body.method)));
    assert.ok(fixture.calls.every(call => call.init.redirect === "error" && call.init.signal instanceof AbortSignal));
  });
}
test("TRON uses only official mainnet solidified receipt/block APIs and validates actual TRC20 log", async () => {
  const fixture = tronFixture(), result = await verify(job("tron-usdt"), fixture.fetcher);
  assert.equal(result.outcome, "verified");
  if (result.outcome !== "verified") assert.fail();
  assert.equal(result.evidence.block_hash, blockHash.slice(2));
  assert.equal(result.evidence.contract, WALLET_ROUTES["tron-usdt"].contract);
  assert.ok(fixture.calls.every(call => call.url.startsWith("https://api.trongrid.io/walletsolidity/")));
  assert.ok(fixture.calls.every(call => !/broadcast|send|trigger|\/v1\//.test(call.url)));
});
test("uint256 values remain exact beyond Number.MAX_SAFE_INTEGER", async () => {
  const amount = "9007199254741123", fixture = evmFixture("ethereum-usdc", { receipt: { logs: [evmLog("ethereum-usdc", amount)] } });
  const result = await verify(job("ethereum-usdc", amount), fixture.fetcher);
  assert.equal(result.outcome, "verified");
  if (result.outcome === "verified") assert.equal(result.evidence.amount_units, amount);
});
test("full uint256 maximum is decoded exactly and oversized invoice amounts are rejected before RPC", async () => {
  const max = ((1n << 256n) - 1n).toString();
  const result = await verify(job("ethereum-usdc", max), evmFixture("ethereum-usdc", { receipt: { logs: [evmLog("ethereum-usdc", max)] } }).fetcher);
  assert.equal(result.outcome, "verified");
  if (result.outcome === "verified") assert.equal(result.evidence.amount_units, max);
  const tooLarge = (1n << 256n).toString();
  assert.deepEqual(await verify(job("ethereum-usdc", tooLarge), async () => assert.fail("invalid uint256")), { outcome: "review", reason: "invoice_invalid" });
});
test("wrong configured node chain ID waits without treating an unavailable payment as failed", async () => {
  const fixture = evmFixture("ethereum-usdt", { chainId: "0x2105" });
  assert.deepEqual(await verify(job(), fixture.fetcher), { outcome: "waiting", reason: "node_chain_mismatch", retryAfterSeconds: 300 });
  assert.equal(fixture.calls.length, 1);
});
test("wrong invoice asset/contract/chain and invalid recipient cannot reach a node", async () => {
  for (const override of [{ contract: `0x${"f".repeat(40)}` }, { asset: "USDC" }, { chain: "base" }, { recipient: "0x1" }, { amount_decimal: "52" }, { amount_units: "52000000" }, { created_at: "invalid" }]) {
    const value = job(); Object.assign(value.order, override);
    assert.deepEqual(await verify(value, async () => assert.fail("invalid frozen invoice")), { outcome: "review", reason: "invoice_invalid" });
  }
});
test("pending and insufficient finality stay waiting, never grant on latest/safe alone", async () => {
  for (const [options, reason] of [[{ missing: true }, "transaction_pending"], [{ finalized: { number: "0xff", hash: blockHash } }, "finality_pending"]] as const) {
    const fixture = evmFixture("ethereum-usdt", options);
    const result = await verify(job(), fixture.fetcher);
    assert.equal(result.outcome, "waiting");
    assert.equal(result.reason, reason);
  }
});
test("canonical mismatch, removed log or changed receipt after finalized check cannot grant", async () => {
  for (const options of [{ canonical: { hash: `0x${"f".repeat(64)}` } }, { canonical: { transactions: [] } }, { fresh: { blockHash: `0x${"f".repeat(64)}` } },
    { receipt: { logs: [{ ...evmLog("ethereum-usdt"), removed: true }] } }, { receipt: { logs: [{ ...evmLog("ethereum-usdt"), transactionHash: `0x${"f".repeat(64)}` }] } }]) {
    const result = await verify(job(), evmFixture("ethereum-usdt", options).fetcher);
    assert.equal(result.outcome, "waiting");
  }
});
test("finalized failed receipt is reviewed, missing status or forged topic data never count as payment", async () => {
  const failed = await verify(job(), evmFixture("ethereum-usdt", { receipt: { status: "0x0" } }).fetcher);
  assert.deepEqual(failed, { outcome: "review", reason: "transaction_failed" });
  for (const data of ["0x1", "52000123", `0x${"z".repeat(64)}`]) {
    assert.equal((await verify(job(), evmFixture("ethereum-usdt", { receipt: { logs: [{ ...evmLog("ethereum-usdt"), data }] } }).fetcher)).outcome, "waiting");
  }
  assert.equal((await verify(job(), evmFixture("ethereum-usdt", { receipt: { status: undefined } }).fetcher)).outcome, "waiting");
});
test("fake token, wrong recipient and calldata/display metadata cannot substitute for an approved Transfer", async () => {
  for (const logs of [[{ ...evmLog("ethereum-usdt"), address: `0x${"f".repeat(40)}`, symbol: "USDT" }], [evmLog("ethereum-usdt", "52000123", `0x${"3".repeat(40)}`)], []]) {
    const result = await verify(job(), evmFixture("ethereum-usdt", { receipt: { logs, value: "52000123", to: recipient } }).fetcher);
    assert.deepEqual(result, { outcome: "review", reason: "matching_transfer_missing" });
  }
});
test("local event index isolates real transfer from other logs and rejects two matching payments", async () => {
  const other = evmLog("ethereum-usdt", "52000123", `0x${"3".repeat(40)}`), exact = evmLog("ethereum-usdt");
  const result = await verify(job(), evmFixture("ethereum-usdt", { receipt: { logs: [other, exact] } }).fetcher);
  assert.equal(result.outcome, "verified");
  if (result.outcome === "verified") assert.equal(result.evidence.event_index, 1); // not block-global logIndex 7
  assert.deepEqual(await verify(job(), evmFixture("ethereum-usdt", { receipt: { logs: [exact, exact] } }).fetcher), { outcome: "review", reason: "multiple_matching_transfers" });
});
test("underpay, overpay and split-payment totals do not silently grant or refund", async () => {
  for (const logs of [[evmLog("ethereum-usdt", "52000122")], [evmLog("ethereum-usdt", "52000124")], [evmLog("ethereum-usdt", "26000000"), evmLog("ethereum-usdt", "26000123")]]) {
    assert.deepEqual(await verify(job(), evmFixture("ethereum-usdt", { receipt: { logs } }).fetcher), { outcome: "review", reason: "payment_amount_mismatch" });
  }
});
test("actual block payment time, not finality or worker time, determines invoice window", async () => {
  const late = job(); late.order.expires_at = new Date(now - 20000).toISOString();
  assert.deepEqual(await verify(late, evmFixture().fetcher), { outcome: "review", reason: "payment_after_expiry" });
  const early = job(); early.order.created_at = new Date(now - 5000).toISOString();
  assert.deepEqual(await verify(early, evmFixture().fetcher), { outcome: "review", reason: "payment_before_invoice" });
  const expired = job(); expired.order.expires_at = new Date(now - 5000).toISOString(); expired.order.status = "expired";
  assert.equal((await verify(expired, evmFixture().fetcher)).outcome, "verified");
});
test("TRON pending/failed/canonical mismatch/fake contract are never accepted", async () => {
  for (const [options, outcome] of [[{ missing: true }, "waiting"], [{ headNumber: 255 }, "waiting"], [{ receipt: { receipt: { result: "REVERT" } } }, "review"],
    [{ canonical: { transactions: [] } }, "waiting"], [{ fresh: { blockNumber: 255 } }, "waiting"], [{ log: { address: "f".repeat(40), symbol: "USDT" } }, "review"],
    [{ log: { data: "garbage" } }, "waiting"]] as const) {
    assert.equal((await verify(job("tron-usdt"), tronFixture(options).fetcher)).outcome, outcome);
  }
});
test("TRON decoded amount/recipient must match the exact invoice, not submitted contract input", async () => {
  for (const options of [{ amount: "52000122" }, { amount: "52000124" }, { log: { topics: ["ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    `${"0".repeat(24)}${"2".repeat(40)}`, `${"0".repeat(24)}${"3".repeat(40)}`] } }]) {
    assert.equal((await verify(job("tron-usdt"), tronFixture(options).fetcher)).outcome, "review");
  }
});
test("previously observed confirmation is not cached across retries after a canonical change", async () => {
  assert.equal((await verify(job(), evmFixture().fetcher)).outcome, "verified");
  assert.equal((await verify(job(), evmFixture("ethereum-usdt", { canonical: { hash: `0x${"f".repeat(64)}` } }).fetcher)).outcome, "waiting");
});
test("missing one chain endpoint does not disable other chains or falsely settle the missing payment", async () => {
  const partial = loadMembershipWalletVerificationConfig({ MEMBERSHIP_WALLET_ENABLED: "true" });
  assert.deepEqual(await verifyMembershipWalletTransfer(job(), partial, { fetch: async () => assert.fail("no endpoint") }), { outcome: "waiting", reason: "chain_rpc_unconfigured", retryAfterSeconds: 300 });
  assert.equal((await verifyMembershipWalletTransfer(job("tron-usdt"), partial, { fetch: tronFixture().fetcher, now: () => now })).outcome, "verified");
});
test("RPC outage/rate limit/provider diagnostics become bounded safe waiting codes", async () => {
  for (const [options, code] of [[{ error: true }, "rpc_unavailable"], [{ httpStatus: 429 }, "rpc_rate_limited"], [{ httpStatus: 503 }, "rpc_unavailable"]] as const) {
    const result = await verify(job(), evmFixture("ethereum-usdt", options).fetcher);
    assert.equal(result.outcome, "waiting");
    assert.ok(!JSON.stringify(result).includes("secret") && !JSON.stringify(result).includes("private-synthetic-path"));
    assert.equal(result.reason, code);
  }
});
test("oversized and invalid RPC responses are bounded and sanitized", async () => {
  await assert.rejects(() => walletRpcRequest("https://example.com/", {}, { timeoutMs: 100, fetch: async () => new Response("x", { headers: { "content-length": "2097153" } }) }), /rpc_response_invalid/);
  await assert.rejects(() => walletRpcRequest("https://example.com/", {}, { timeoutMs: 100, fetch: async () => new Response("not-json secret") }), /rpc_response_invalid/);
});
test("JSON-RPC errors, wrong response ID, missing result and unsupported finalized response cannot authorize", async () => {
  for (const payload of [{ jsonrpc: "2.0", id: 999, result: "0x1" }, { jsonrpc: "2.0", id: 1, error: { message: "private-provider-secret" } }, { jsonrpc: "2.0", id: 1 }]) {
    const result = await verify(job(), async () => new Response(JSON.stringify(payload)));
    assert.equal(result.outcome, "waiting"); assert.ok(!JSON.stringify(result).includes("secret"));
  }
  const fixture = evmFixture();
  const unsupported: typeof fetch = async (url, options) => {
    const body = JSON.parse(String(options?.body));
    if (body.method === "eth_getBlockByNumber" && body.params[0] === "finalized") return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: null }));
    return fixture.fetcher(url, options);
  };
  assert.deepEqual(await verify(job(), unsupported), { outcome: "waiting", reason: "finality_unavailable", retryAfterSeconds: 60 });
});
test("provider credentials remain server-side headers and timeout signals reach every request", async () => {
  const configured = loadMembershipWalletVerificationConfig({ MEMBERSHIP_WALLET_ENABLED: "true", MEMBERSHIP_WALLET_TRONGRID_API_KEY: "synthetic-server-only" });
  const fixture = tronFixture();
  assert.equal((await verifyMembershipWalletTransfer(job("tron-usdt"), configured, { fetch: fixture.fetcher, now: () => now })).outcome, "verified");
  assert.ok(fixture.calls.every(call => call.init.headers["TRON-PRO-API-KEY"] === "synthetic-server-only" && call.init.signal instanceof AbortSignal));
  assert.ok(fixture.calls.every(call => !call.url.includes("synthetic-server-only") && !JSON.stringify(call.body).includes("synthetic-server-only")));
});

function databaseFixture(value: ClaimedWalletVerification, receipt: Record<string, unknown> = { applied: true, duplicate: false, outcome: "paid" }) {
  const calls: { path: string; body: any }[] = [];
  const database = { request: async (path: string, options: { body?: unknown } = {}) => {
    calls.push({ path, body: options.body });
    if (path.endsWith("claim_membership_wallet_verifications")) return [value];
    if (path.endsWith("apply_verified_membership_wallet_transfer")) return receipt;
    if (path.endsWith("settle_membership_wallet_verification")) return { status: (options.body as any).p_outcome };
    assert.fail("unexpected database operation");
  } };
  return { database, calls };
}
test("worker settles approved evidence through service RPC without browser proof or arbitrary writes", async () => {
  const database = databaseFixture(job()), result = await runMembershipWalletVerificationCycle({ ...database, env, workerId: "test-worker", fetch: evmFixture().fetcher, now: () => now });
  assert.equal(result.applied, 1);
  assert.equal(database.calls.length, 2);
  assert.deepEqual(database.calls[0]!.body, { p_limit: 2, p_worker_id: "test-worker" });
  const body = database.calls[1]!.body;
  assert.equal(body.p_lease_id, job().lease_id);
  assert.equal(body.p_evidence.finalized, true);
  assert.equal(body.p_evidence.amount_units, "52000123");
  assert.ok(database.calls.every(call => /\/rpc\//.test(call.path) && !/stripe|mentor|trading|refund/.test(call.path)));
});
test("queue retry duplicates do not ask for another grant or overwrite the original evidence", async () => {
  const database = databaseFixture(job(), { duplicate: true, applied: false, outcome: "paid" });
  for (let index = 0; index < 2; ++index) assert.equal((await runMembershipWalletVerificationCycle({ ...database, env, workerId: "test-worker", fetch: evmFixture().fetcher, now: () => now })).applied, 1);
  const applications = database.calls.filter(call => call.path.endsWith("apply_verified_membership_wallet_transfer"));
  assert.deepEqual(applications[0]!.body, applications[1]!.body);
});
test("a duplicate reviewed receipt is never counted as a paid grant", async () => {
  const database = databaseFixture(job(), { duplicate: true, applied: false, outcome: "review" });
  const result = await runMembershipWalletVerificationCycle({ ...database, env, workerId: "test-worker", fetch: evmFixture().fetcher, now: () => now });
  assert.equal(result.applied, 0); assert.equal(result.review, 1);
});
test("worker identifier length matches the SQL claim limit", async () => {
  await assert.rejects(() => runMembershipWalletVerificationCycle({ env, workerId: "x".repeat(101), database: { request: async () => assert.fail("invalid worker identifier cannot claim") } }), /worker_invalid/);
});
test("waiting failures use exponential/remote retry backoff, never failed/expired/revoked", async () => {
  const value = job(); value.attempts = 6;
  const database = databaseFixture(value);
  const result = await runMembershipWalletVerificationCycle({ ...database, env, workerId: "test-worker", fetch: evmFixture("ethereum-usdt", { error: true }).fetcher, now: () => now });
  assert.equal(result.waiting, 1);
  const settlement = database.calls[1]!.body;
  assert.equal(settlement.p_outcome, "waiting"); assert.equal(settlement.p_retry_after_seconds, 960);
  assert.equal(settlement.p_reason, "rpc_unavailable");
});
test("a clear transfer mismatch goes to review with no entitlement application", async () => {
  const database = databaseFixture(job());
  const result = await runMembershipWalletVerificationCycle({ ...database, env, workerId: "test-worker", fetch: evmFixture("ethereum-usdt", { receipt: { logs: [] } }).fetcher, now: () => now });
  assert.equal(result.review, 1); assert.equal(database.calls[1]!.body.p_outcome, "review");
});
test("stale leases and leases expiring during verification cannot apply or alter successor jobs", async () => {
  const value = job(); value.lease_expires_at = new Date(now).toISOString();
  const expired = databaseFixture(value);
  assert.equal((await runMembershipWalletVerificationCycle({ ...expired, env, workerId: "test-worker", fetch: async () => assert.fail("stale lease"), now: () => now })).leaseLost, 1);
  assert.equal(expired.calls.length, 1);
  const current = databaseFixture(job()); let ticks = 0;
  const result = await runMembershipWalletVerificationCycle({ ...current, env, workerId: "test-worker", fetch: evmFixture().fetcher, now: () => ++ticks <= 2 ? now : now + 130000 });
  assert.equal(result.leaseLost, 1); assert.equal(current.calls.length, 1);
});
test("unknown DB application acknowledgement never triggers contradictory settlement", async () => {
  const calls: string[] = [];
  const database = { request: async (path: string) => { calls.push(path); if (path.endsWith("claim_membership_wallet_verifications")) return [job()]; throw new Error("private database diagnostic"); } };
  const result = await runMembershipWalletVerificationCycle({ database, env, workerId: "test-worker", fetch: evmFixture().fetcher, now: () => now });
  assert.equal(result.leaseLost, 1); assert.equal(calls.length, 2); assert.ok(!calls.some(path => path.endsWith("settle_membership_wallet_verification")));
});
test("one process cannot overlap claim cycles on the same database", async () => {
  let resolve!: (value: unknown) => void; let claims = 0;
  const database = { request: async () => { claims += 1; return new Promise(yes => { resolve = yes; }); } };
  const first = runMembershipWalletVerificationCycle({ database, env, workerId: "test-worker" });
  assert.equal((await runMembershipWalletVerificationCycle({ database, env, workerId: "test-worker" })).claimed, 0);
  resolve([]); await first; assert.equal(claims, 1);
});
