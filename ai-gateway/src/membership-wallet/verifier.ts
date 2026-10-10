import { evmAddress, tronAddressToHex } from "./address.ts";
import type { WalletVerificationConfig } from "./config.ts";
import { isWalletRoute, WALLET_ROUTES, WalletRpcError } from "./contracts.ts";
import type { ClaimedWalletVerification, WalletTransferEvidence, WalletVerificationResult } from "./contracts.ts";
import { EvmReadRpc, walletRpcRequest } from "./rpc.ts";

const TRANSFER = "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const UINT256_MAX = (1n << 256n) - 1n;
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WalletRpcError("rpc_response_invalid");
  return value as ObjectValue;
};
function hash(value: unknown, evm: boolean): string {
  if (typeof value !== "string" || !(evm ? /^0x[0-9a-f]{64}$/i : /^[0-9a-f]{64}$/i).test(value)) throw new WalletRpcError("rpc_response_invalid");
  return value.toLowerCase();
}
function quantity(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value) || value.length > 66) throw new WalletRpcError("rpc_response_invalid");
  return BigInt(value);
}
function safeInteger(value: unknown, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) throw new WalletRpcError("rpc_response_invalid");
  return value;
}
function blockNumber(value: unknown): number {
  const number = quantity(value);
  if (number < 1n || number > BigInt(Number.MAX_SAFE_INTEGER)) throw new WalletRpcError("rpc_response_invalid");
  return Number(number);
}
function unitAmount(value: unknown): bigint {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,77}$/.test(value)) throw new Error("invoice_invalid");
  const units = BigInt(value);
  if (units > UINT256_MAX) throw new Error("invoice_invalid");
  return units;
}
function decimalAmount(units: bigint): string { return `${units / 1000000n}.${(units % 1000000n).toString().padStart(6, "0")}`; }
function timeOutcome(job: ClaimedWalletVerification, timestampMs: number, now: number): WalletVerificationResult | null {
  if (!Number.isSafeInteger(timestampMs) || timestampMs < 1 || !Number.isFinite(new Date(timestampMs).getTime()) || timestampMs > now + 60000) throw new WalletRpcError("rpc_response_invalid");
  if (timestampMs < Date.parse(job.order.created_at)) return { outcome: "review", reason: "payment_before_invoice" };
  if (timestampMs > Date.parse(job.order.expires_at)) return { outcome: "review", reason: "payment_after_expiry" };
  return null;
}
type DecodedTransfer = { eventIndex: number; recipientHex: string; amount: bigint };
function transfer(logValue: unknown, eventIndex: number, emitter: string, evm: boolean): DecodedTransfer | null {
  const log = object(logValue);
  const address = typeof log.address === "string" ? log.address.toLowerCase() : "";
  if (address !== emitter) return null;
  const topics = log.topics;
  if (!Array.isArray(topics) || topics.length !== 3 || typeof topics[0] !== "string" || topics[0].toLowerCase() !== `${evm ? "0x" : ""}${TRANSFER}`) return null;
  const addressTopic = evm ? /^0x0{24}[0-9a-f]{40}$/i : /^0{24}[0-9a-f]{40}$/i;
  if (typeof topics[1] !== "string" || typeof topics[2] !== "string" || !addressTopic.test(topics[1]) || !addressTopic.test(topics[2])
    || typeof log.data !== "string" || !(evm ? /^0x[0-9a-f]{64}$/i : /^[0-9a-f]{64}$/i).test(log.data)) throw new WalletRpcError("rpc_response_invalid");
  return { eventIndex, recipientHex: topics[2].slice(-40).toLowerCase(), amount: BigInt(`${evm ? "" : "0x"}${log.data}`) };
}
function matchTransfer(transfers: DecodedTransfer[], expectedRecipientHex: string, units: bigint): DecodedTransfer | WalletVerificationResult {
  const addressed = transfers.filter(item => item.recipientHex === expectedRecipientHex);
  const exact = addressed.filter(item => item.amount === units);
  if (exact.length > 1) return { outcome: "review", reason: "multiple_matching_transfers" };
  if (exact.length === 1) return exact[0]!;
  return { outcome: "review", reason: addressed.length ? "payment_amount_mismatch" : "matching_transfer_missing" };
}
function receiptFingerprint(receipt: ObjectValue, evm: boolean): string {
  return JSON.stringify(evm ? [receipt.transactionHash, receipt.blockHash, receipt.blockNumber, receipt.status, receipt.logs]
    : [receipt.id, receipt.blockNumber, receipt.blockTimeStamp, object(receipt.receipt).result, receipt.log]);
}

export async function verifyMembershipWalletTransfer(job: ClaimedWalletVerification, config: WalletVerificationConfig, dependencies: {
  fetch?: typeof fetch; now?: () => number; signal?: AbortSignal;
} = {}): Promise<WalletVerificationResult> {
  if (!config.enabled || config.readiness !== "ready") return { outcome: "waiting", reason: "verification_disabled", retryAfterSeconds: 300 };
  let units: bigint, recipientHex: string;
  try {
    const order = job.order;
    if (!order || !isWalletRoute(order.route_id)) throw new Error();
    const route = WALLET_ROUTES[order.route_id];
    if (order.chain !== route.chain || order.asset !== route.asset || order.contract !== route.contract
      || !Number.isSafeInteger(order.route_revision) || order.route_revision < 1) throw new Error();
    units = unitAmount(order.amount_units);
    const base = unitAmount(order.base_amount_units);
    if (units <= base || units - base > 9999n || order.amount_decimal !== decimalAmount(units)
      || !Number.isFinite(Date.parse(order.created_at)) || !Number.isFinite(Date.parse(order.expires_at))
      || Date.parse(order.expires_at) <= Date.parse(order.created_at)) throw new Error();
    recipientHex = route.chain === "tron" ? tronAddressToHex(order.recipient).slice(2) : evmAddress(order.recipient).slice(2);
    if (route.chain !== "tron" && order.recipient !== `0x${recipientHex}`) throw new Error();
    if (hash(job.tx_hash, route.chain !== "tron") !== job.tx_hash) throw new Error();
  } catch { return { outcome: "review", reason: "invoice_invalid" }; }
  const now = dependencies.now ?? Date.now;
  try {
    const evidence = job.order.chain === "tron"
      ? await verifyTron(job, units, recipientHex, config, dependencies, now)
      : await verifyEvm(job, units, recipientHex, config, dependencies, now);
    return evidence;
  } catch (error) {
    if (error instanceof WalletRpcError) return { outcome: "waiting", reason: error.code, retryAfterSeconds: error.retryAfterSeconds };
    return { outcome: "waiting", reason: "rpc_response_invalid", retryAfterSeconds: 60 };
  }
}

async function verifyEvm(job: ClaimedWalletVerification, units: bigint, recipientHex: string, config: WalletVerificationConfig,
  dependencies: { fetch?: typeof fetch; signal?: AbortSignal }, now: () => number): Promise<WalletVerificationResult> {
  const endpoint = job.order.chain === "ethereum" ? config.ethereumRpcUrl : config.baseRpcUrl;
  if (!endpoint) return { outcome: "waiting", reason: "chain_rpc_unconfigured", retryAfterSeconds: 300 };
  const rpc = new EvmReadRpc(endpoint, { ...dependencies, timeoutMs: config.timeoutMs });
  const chainId = quantity(await rpc.call("eth_chainId", []));
  if (chainId !== BigInt(WALLET_ROUTES[job.order.route_id].chainId!)) throw new WalletRpcError("node_chain_mismatch", 300);
  const raw = await rpc.call("eth_getTransactionReceipt", [job.tx_hash]);
  if (!raw) return { outcome: "waiting", reason: "transaction_pending", retryAfterSeconds: 30 };
  const receipt = object(raw);
  if (hash(receipt.transactionHash, true) !== job.tx_hash) throw new WalletRpcError("rpc_response_invalid");
  const number = blockNumber(receipt.blockNumber), receiptHash = hash(receipt.blockHash, true);
  const finalizedRaw = await rpc.call("eth_getBlockByNumber", ["finalized", false]);
  if (!finalizedRaw) return { outcome: "waiting", reason: "finality_unavailable", retryAfterSeconds: 60 };
  const finalized = object(finalizedRaw);
  const finalizedNumber = blockNumber(finalized.number);
  hash(finalized.hash, true);
  if (finalizedNumber < number) return { outcome: "waiting", reason: "finality_pending", retryAfterSeconds: 30 };
  const canonicalRaw = await rpc.call("eth_getBlockByNumber", [receipt.blockNumber, false]);
  if (!canonicalRaw) throw new WalletRpcError("canonical_block_pending");
  const canonical = object(canonicalRaw);
  if (blockNumber(canonical.number) !== number || hash(canonical.hash, true) !== receiptHash
    || (finalizedNumber === number && hash(finalized.hash, true) !== receiptHash)) throw new WalletRpcError("canonical_block_changed");
  if (!Array.isArray(canonical.transactions) || !canonical.transactions.some(item => typeof item === "string" && item.toLowerCase() === job.tx_hash)) throw new WalletRpcError("canonical_transaction_missing");
  const timestamp = quantity(canonical.timestamp);
  if (timestamp > BigInt(Number.MAX_SAFE_INTEGER) / 1000n) throw new WalletRpcError("rpc_response_invalid");
  const paidAt = Number(timestamp) * 1000;
  // Re-read after the finality/canonical lookup. Do not cache a receipt across
  // attempts or grant from a receipt that changed during this verification.
  const fresh = object(await rpc.call("eth_getTransactionReceipt", [job.tx_hash]));
  if (receiptFingerprint(fresh, true) !== receiptFingerprint(receipt, true)) throw new WalletRpcError("canonical_receipt_changed");
  const status = quantity(receipt.status);
  if (status === 0n) return { outcome: "review", reason: "transaction_failed" };
  if (status !== 1n) throw new WalletRpcError("rpc_response_invalid");
  if (!Array.isArray(receipt.logs) || receipt.logs.length > 2048) throw new WalletRpcError("rpc_response_invalid");
  const transfers: DecodedTransfer[] = [];
  for (let index = 0; index < receipt.logs.length; ++index) {
    const log = object(receipt.logs[index]);
    if (log.removed !== false || hash(log.transactionHash, true) !== job.tx_hash || hash(log.blockHash, true) !== receiptHash
      || blockNumber(log.blockNumber) !== number) throw new WalletRpcError("canonical_receipt_changed");
    const decoded = transfer(log, index, job.order.contract, true);
    if (decoded) transfers.push(decoded);
  }
  const match = matchTransfer(transfers, recipientHex, units);
  if ("outcome" in match) return match;
  const time = timeOutcome(job, paidAt, now());
  if (time) return time;
  return { outcome: "verified", evidence: evidenceFor(job, match.eventIndex, number, receiptHash, paidAt) };
}

async function verifyTron(job: ClaimedWalletVerification, units: bigint, recipientHex: string, config: WalletVerificationConfig,
  dependencies: { fetch?: typeof fetch; signal?: AbortSignal }, now: () => number): Promise<WalletVerificationResult> {
  const headers = config.tronApiKey ? { "TRON-PRO-API-KEY": config.tronApiKey } : {};
  const call = (method: "gettransactioninfobyid" | "getnowblock" | "getblockbynum", body: unknown) =>
    walletRpcRequest(`https://api.trongrid.io/walletsolidity/${method}`, body, { ...dependencies, timeoutMs: config.timeoutMs, headers });
  const raw = object(await call("gettransactioninfobyid", { value: job.tx_hash }));
  if (!Object.keys(raw).length) return { outcome: "waiting", reason: "solidification_pending", retryAfterSeconds: 30 };
  if (hash(raw.id, false) !== job.tx_hash) throw new WalletRpcError("rpc_response_invalid");
  const number = safeInteger(raw.blockNumber, 1), paidAt = safeInteger(raw.blockTimeStamp, 1);
  const head = object(await call("getnowblock", {}));
  const headData = object(object(head.block_header).raw_data);
  if (safeInteger(headData.number, 1) < number) return { outcome: "waiting", reason: "solidification_pending", retryAfterSeconds: 30 };
  const canonical = object(await call("getblockbynum", { num: number }));
  const blockHash = hash(canonical.blockID, false);
  const blockData = object(object(canonical.block_header).raw_data);
  if (safeInteger(blockData.number, 1) !== number || safeInteger(blockData.timestamp, 1) !== paidAt
    || (headData.number === number && hash(head.blockID, false) !== blockHash)) throw new WalletRpcError("canonical_block_changed");
  if (!Array.isArray(canonical.transactions) || !canonical.transactions.some(item => object(item).txID === job.tx_hash)) throw new WalletRpcError("canonical_transaction_missing");
  const fresh = object(await call("gettransactioninfobyid", { value: job.tx_hash }));
  if (receiptFingerprint(fresh, false) !== receiptFingerprint(raw, false)) throw new WalletRpcError("canonical_receipt_changed");
  const result = object(raw.receipt).result;
  if (typeof result !== "string") throw new WalletRpcError("rpc_response_invalid");
  if (result !== "SUCCESS") return { outcome: "review", reason: "transaction_failed" };
  if (!Array.isArray(raw.log) || raw.log.length > 2048) throw new WalletRpcError("rpc_response_invalid");
  const emitter = tronAddressToHex(job.order.contract).slice(2), transfers: DecodedTransfer[] = [];
  for (let index = 0; index < raw.log.length; ++index) {
    const decoded = transfer(raw.log[index], index, emitter, false);
    if (decoded) transfers.push(decoded);
  }
  const match = matchTransfer(transfers, recipientHex, units);
  if ("outcome" in match) return match;
  const time = timeOutcome(job, paidAt, now());
  if (time) return time;
  return { outcome: "verified", evidence: evidenceFor(job, match.eventIndex, number, blockHash, paidAt) };
}
function evidenceFor(job: ClaimedWalletVerification, eventIndex: number, block: number, blockHash: string, timestampMs: number): WalletTransferEvidence {
  return { chain: job.order.chain, contract: job.order.contract, recipient: job.order.recipient, amount_units: job.order.amount_units,
    tx_hash: job.tx_hash, event_index: eventIndex, block_number: block, block_hash: blockHash,
    paid_at: new Date(timestampMs).toISOString(), finalized: true };
}
