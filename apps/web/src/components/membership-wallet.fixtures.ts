// Isolated test fixtures, never real recipients or an account fallback.
// Stories mask these synthetic values and disable all payment/copy actions.
import { walletRouteDefinitions, walletExpectedQuote, type MyMembershipWallet, type WalletAdminStore, type WalletOrder, type WalletRoute, type WalletRouteId, type WalletVerification } from "@/lib/membership/wallet-types";
import { membershipPreviewActor, membershipPreviewPlan, membershipPreviewRequest } from "./membership-commerce.fixtures";

export function walletPreviewRoutes(configured = false): WalletRoute[] {
  return (Object.entries(walletRouteDefinitions) as [WalletRouteId, (typeof walletRouteDefinitions)[WalletRouteId]][]).map(([id, definition]) => ({ id, ...definition, decimals: 6, recipient: configured ? definition.chain === "tron" ? `T${"1".repeat(33)}` : `0x${"1".repeat(40)}` : null, enabled: configured, revision: 1 }));
}
export function walletPreviewMine(configured = false): MyMembershipWallet {
  return { catalog: { settings: { enabled: configured, revision: 1 }, routes: walletPreviewRoutes(configured), purchase_available: configured }, orders: [], verifications: [], purchase_grants: [], effective: { user_id: membershipPreviewActor, eligible: true, has_vip: false, ai_daily_limit: 0, mentor_discount_bps: 0 } };
}
export function walletPreviewOrder(status: WalletOrder["status"] = "pending"): WalletOrder {
  const route = walletPreviewRoutes(true).find((item) => item.id === "base-usdc")!;
  return { ...walletExpectedQuote(membershipPreviewPlan, membershipPreviewPlan.prices[0], route), id: "00000000-0000-4000-8000-000000000111", buyer_id: membershipPreviewActor, request_id: membershipPreviewRequest,
    route_id: route.id, chain: route.chain, asset: route.asset, contract: route.contract, recipient: route.recipient!, currency: "USD", base_amount_units: "52000000", amount_units: "52001237", amount_decimal: "52.001237",
    title_snapshot: "VIP 会员", description_snapshot: "隔离组件虚拟订单，禁止转账。", benefits_snapshot: {}, ai_daily_limit_snapshot: 50, mentor_discount_bps_snapshot: 1000,
    status, created_at: "2099-10-10T00:00:00Z", expires_at: "2099-10-10T00:30:00Z", paid_at: status === "paid" ? "2099-10-10T00:10:00Z" : null };
}
export function walletPreviewVerification(status: WalletVerification["status"] = "queued"): WalletVerification {
  return { id: "00000000-0000-4000-8000-000000000112", order_id: walletPreviewOrder().id, tx_hash: `0x${"a".repeat(64)}`, status, attempts: status === "queued" ? 0 : 1, next_attempt_at: "2099-10-10T00:12:00Z", lease_id: status === "leased" ? "00000000-0000-4000-8000-000000000113" : null, lease_expires_at: status === "leased" ? "2099-10-10T00:14:00Z" : null };
}
export function walletPreviewAdmin(): WalletAdminStore { return { settings: { enabled: false, revision: 1 }, routes: walletPreviewRoutes(), orders: [], verifications: [], receipts: [], history: [] }; }
