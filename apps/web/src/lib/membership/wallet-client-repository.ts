import type { SupabaseClient } from "@supabase/supabase-js";
import { parseMyMembershipWallet, parseWalletAdminStore, parseWalletOrder, parseWalletPurchaseGrant, parseWalletQuote, parseWalletRoute, parseWalletSettings, parseWalletVerification, walletRouteId, walletTransferHash, walletUuid, type WalletQuote, type WalletRouteId } from "./wallet-types";

export class MembershipWalletCheckoutError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "MembershipWalletCheckoutError"; }
}

export function membershipWalletRepository(client: SupabaseClient, actorId: string) {
  async function authenticate() {
    const result = await client.auth.getUser(); if (result.error || result.data.user?.id !== actorId) throw new Error("authentication_required");
  }
  async function rpc(name: string, args: Record<string, unknown>) {
    await authenticate(); const result = await client.rpc(name, { ...args, p_actor_id: actorId }); if (result.error) throw result.error; await authenticate(); return result.data as unknown;
  }
  const invalid = (): never => { throw new Error("membership_wallet_response_invalid"); };
  return {
    async mine() { const result = parseMyMembershipWallet(await rpc("get_my_membership_wallet", {})); if (result.effective.user_id !== actorId || result.orders.some((order) => order.buyer_id !== actorId)) invalid(); return result; },
    async create(input: { priceId: string; routeId: WalletRouteId; requestId: string; expectedQuote: WalletQuote }) {
      const quote = parseWalletQuote(input.expectedQuote); if (quote.price_id !== input.priceId || !walletUuid(input.requestId) || !walletRouteId(input.routeId)) invalid(); await authenticate();
      const result = await client.functions.invoke("membership-wallet-checkout", { body: { actorId, priceId: input.priceId, routeId: input.routeId, requestId: input.requestId, expectedQuote: quote } }); await authenticate();
      if (result.error) {
        if ("context" in result.error && result.error.context instanceof Response) {
          let code = ""; try { const body = await result.error.context.clone().json(); if (typeof body?.error === "string") code = body.error; } catch { /* An unreadable reply remains unknown. */ }
          if (code) throw new MembershipWalletCheckoutError(code, result.error.context.status);
        }
        throw result.error;
      }
      const order = parseWalletOrder(result.data?.order);
      if (order.buyer_id !== actorId || order.request_id !== input.requestId || order.price_id !== input.priceId || order.route_id !== input.routeId || JSON.stringify(parseWalletQuote(order)) !== JSON.stringify(quote)) invalid(); return order;
    },
    async submitTransfer(input: { orderId: string; txHash: string; chain: "tron" | "ethereum" | "base" }) {
      if (!walletUuid(input.orderId)) invalid(); const hash = walletTransferHash(input.chain, input.txHash); const result = await rpc("submit_membership_wallet_transfer", { p_order_id: input.orderId, p_tx_hash: hash });
      if (!result || typeof result !== "object" || !(("order" in result) && ("verification" in result))) invalid();
      const receipt = result as { order: unknown; verification: unknown }; const order = parseWalletOrder(receipt.order); const verification = parseWalletVerification(receipt.verification);
      if (order.id !== input.orderId || order.buyer_id !== actorId || order.chain !== input.chain || verification.order_id !== input.orderId || verification.tx_hash !== hash) invalid(); return { order, verification };
    },
    async adminStore() { return parseWalletAdminStore(await rpc("admin_membership_wallet_store", {})); },
    async revokeOrder(input: { orderId: string; reason: string; requestId: string }) {
      if (!walletUuid(input.orderId) || !walletUuid(input.requestId)) invalid();
      const receipt = await rpc("admin_revoke_membership_wallet_order", { p_order_id: input.orderId, p_reason: input.reason, p_request_id: input.requestId });
      if (!receipt || typeof receipt !== "object" || !("order" in receipt) || !("grant" in receipt)) invalid();
      const value = receipt as { order: unknown; grant: unknown }; const order = parseWalletOrder(value.order), grant = parseWalletPurchaseGrant(value.grant);
      if (order.id !== input.orderId || order.status !== "revoked" || grant.order_id !== input.orderId || grant.status !== "revoked") invalid(); return { order, grant };
    },
    async saveSettings(input: { enabled: boolean; revision: number; reason: string; requestId: string }) {
      const value = parseWalletSettings(await rpc("admin_save_membership_wallet_settings", { p_enabled: input.enabled, p_expected_revision: input.revision, p_reason: input.reason, p_request_id: input.requestId }));
      if (value.enabled !== input.enabled || value.revision !== input.revision + 1) invalid(); return value;
    },
    async saveRoute(input: { routeId: WalletRouteId; recipient: string | null; enabled: boolean; revision: number; reason: string; requestId: string }) {
      const value = parseWalletRoute(await rpc("admin_save_membership_wallet_route", { p_route_id: input.routeId, p_recipient: input.recipient, p_enabled: input.enabled, p_expected_revision: input.revision, p_reason: input.reason, p_request_id: input.requestId }));
      if (value.id !== input.routeId || value.recipient !== input.recipient || value.enabled !== input.enabled || value.revision !== input.revision + 1) invalid(); return value;
    },
  };
}
