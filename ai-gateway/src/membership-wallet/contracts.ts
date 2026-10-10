// Only issuer-verified mainnet assets. Never infer asset identity from a ticker.
export const WALLET_ROUTES = {
  "tron-usdt": { chain: "tron", asset: "USDT", contract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", decimals: 6, chainId: null },
  "ethereum-usdt": { chain: "ethereum", asset: "USDT", contract: "0xdac17f958d2ee523a2206206994597c13d831ec7", decimals: 6, chainId: 1 },
  "ethereum-usdc": { chain: "ethereum", asset: "USDC", contract: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", decimals: 6, chainId: 1 },
  "base-usdc": { chain: "base", asset: "USDC", contract: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: 6, chainId: 8453 },
} as const;
export type WalletRouteId = keyof typeof WALLET_ROUTES;
export type WalletChain = "tron" | "ethereum" | "base";
export type WalletOrder = {
  id: string; buyer_id: string; request_id: string; price_id: string; route_id: WalletRouteId;
  route_revision: number; chain: WalletChain; asset: "USDT" | "USDC"; contract: string;
  recipient: string; amount_units: string; base_amount_units: string; amount_decimal: string;
  created_at: string; expires_at: string; status: "pending" | "expired" | "paid" | "review" | "revoked";
};
export type ClaimedWalletVerification = {
  id: string; order_id: string; tx_hash: string; status: "leased"; attempts: number;
  lease_id: string; lease_expires_at: string; order: WalletOrder;
};
export type WalletTransferEvidence = {
  chain: WalletChain; contract: string; recipient: string; amount_units: string;
  tx_hash: string; event_index: number; block_number: number; block_hash: string;
  paid_at: string; finalized: true;
};
export type WalletVerificationResult =
  | { outcome: "verified"; evidence: WalletTransferEvidence }
  | { outcome: "waiting" | "review"; reason: string; retryAfterSeconds?: number };
export class WalletRpcError extends Error {
  readonly code: string;
  readonly retryAfterSeconds: number;
  constructor(code: string, retryAfterSeconds = 60) {
    super(code); this.name = "WalletRpcError"; this.code = code;
    this.retryAfterSeconds = Math.min(3600, Math.max(30, retryAfterSeconds));
  }
}
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isWalletRoute(value: unknown): value is WalletRouteId {
  return typeof value === "string" && Object.hasOwn(WALLET_ROUTES, value);
}
