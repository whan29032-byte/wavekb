import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { MembershipWalletCheckoutError, membershipWalletRepository } from "./wallet-client-repository";
import { walletPreviewAdmin, walletPreviewMine, walletPreviewOrder, walletPreviewRoutes, walletPreviewVerification } from "@/components/membership-wallet.fixtures";
import { membershipPreviewActor, membershipPreviewPlan, membershipPreviewRequest } from "@/components/membership-commerce.fixtures";
import { walletExpectedQuote } from "./wallet-types";

const actor = membershipPreviewActor, other = "00000000-0000-4000-8000-000000000999";
const order = walletPreviewOrder();
const createInput = { priceId: order.price_id, routeId: order.route_id, requestId: membershipPreviewRequest, expectedQuote: walletExpectedQuote(membershipPreviewPlan, membershipPreviewPlan.prices[0], walletPreviewRoutes(true)[3]) };
const transferInput = { orderId: order.id, chain: order.chain, txHash: walletPreviewVerification().tx_hash };
const settingsInput = { enabled: false, revision: 1, reason: "保留付款关闭", requestId: membershipPreviewRequest };
const routeInput = { routeId: order.route_id, recipient: order.recipient, enabled: true, revision: 1, reason: "公开收款地址配置", requestId: membershipPreviewRequest };
const revokeInput = { orderId: order.id, reason: "仅撤销已付款订单权益", requestId: membershipPreviewRequest };
const revokedGrant = { id: "00000000-0000-4000-8000-000000000118", order_id: order.id, plan_key: "vip", title: "VIP 会员", benefits: {}, ai_daily_limit: 50, mentor_discount_bps: 1000, starts_at: "2099-10-10T00:10:00Z", ends_at: "2099-11-10T00:10:00Z", status: "revoked" };
const operations = ["mine", "create", "submitTransfer", "adminStore", "saveSettings", "saveRoute", "revokeOrder"] as const;
type Operation = typeof operations[number];
const receipts = { mine: walletPreviewMine(), create: { order }, submitTransfer: { order, verification: walletPreviewVerification() }, adminStore: walletPreviewAdmin(), saveSettings: { enabled: false, revision: 2 }, saveRoute: { ...walletPreviewRoutes(true)[3], revision: 2 }, revokeOrder: { order: { ...walletPreviewOrder("paid"), status: "revoked" }, grant: revokedGrant } };
function setup(data: unknown, error: unknown = null) {
  const getUser = vi.fn().mockResolvedValue({ data: { user: { id: actor } }, error: null });
  const rpc = vi.fn().mockResolvedValue({ data, error }); const invoke = vi.fn().mockResolvedValue({ data, error });
  return { getUser, rpc, invoke, repo: membershipWalletRepository({ auth: { getUser }, rpc, functions: { invoke } } as unknown as SupabaseClient, actor) };
}
function run(repo: ReturnType<typeof membershipWalletRepository>, op: Operation) {
  if (op === "create") return repo.create(createInput); if (op === "submitTransfer") return repo.submitTransfer(transferInput);
  if (op === "revokeOrder") return repo.revokeOrder(revokeInput);
  if (op === "saveSettings") return repo.saveSettings(settingsInput); if (op === "saveRoute") return repo.saveRoute(routeInput); return repo[op]();
}
describe("wallet repository authenticates and binds every receipt", () => {
  it.each(operations)("refuses %s before writing or reading on changed actor", async (op) => {
    const value = setup(receipts[op]); value.getUser.mockResolvedValueOnce({ data: { user: { id: other } }, error: null });
    await expect(run(value.repo, op)).rejects.toThrow("authentication_required"); expect(value.rpc).not.toHaveBeenCalled(); expect(value.invoke).not.toHaveBeenCalled();
  });
  it.each(operations)("rejects successful %s after actor changes in flight", async (op) => {
    const value = setup(receipts[op]); value.getUser.mockResolvedValueOnce({ data: { user: { id: actor } }, error: null }).mockResolvedValueOnce({ data: { user: { id: other } }, error: null });
    await expect(run(value.repo, op)).rejects.toThrow("authentication_required");
  });
  it.each(operations)("rejects malformed %s responses rather than inventing success", async (op) => { await expect(run(setup(null).repo, op)).rejects.toThrow("membership_wallet_response_invalid"); });
  it("sends only server quote and original identifiers, never client amount/address or a paid flag", async () => {
    const value = setup({ order }); await expect(value.repo.create(createInput)).resolves.toEqual(order);
    expect(value.invoke).toHaveBeenCalledWith("membership-wallet-checkout", { body: { actorId: actor, ...createInput } }); expect(value.rpc).not.toHaveBeenCalled();
    expect(Object.keys(value.invoke.mock.calls[0][1].body).sort()).toEqual(["actorId", "expectedQuote", "priceId", "requestId", "routeId"]);
    for (const patch of [{ buyer_id: other }, { request_id: other }, { route_revision: 2 }, { price_revision: 2 }]) {
      value.invoke.mockResolvedValueOnce({ data: { order: { ...order, ...patch } }, error: null }); await expect(value.repo.create(createInput)).rejects.toThrow("membership_wallet_response_invalid");
    }
  });
  it("keeps HTTP acknowledgement status distinct from generic/network errors", async () => {
    const value = setup(null, { context: new Response(JSON.stringify({ error: "membership_wallet_quote_changed" }), { status: 409 }) });
    await expect(value.repo.create(createInput)).rejects.toEqual(new MembershipWalletCheckoutError("membership_wallet_quote_changed", 409));
    value.invoke.mockResolvedValueOnce({ data: null, error: new Error("membership_wallet_quote_changed") });
    try { await value.repo.create(createInput); } catch (error) { expect(error).not.toBeInstanceOf(MembershipWalletCheckoutError); }
  });
  it("binds owner reads and proof submissions, never grants from submitting a hash", async () => {
    const value = setup(walletPreviewMine()); await value.repo.mine(); expect(value.rpc).toHaveBeenCalledWith("get_my_membership_wallet", { p_actor_id: actor });
    value.rpc.mockResolvedValueOnce({ data: { ...walletPreviewMine(), effective: { ...walletPreviewMine().effective, user_id: other } }, error: null }); await expect(value.repo.mine()).rejects.toThrow();
    value.rpc.mockResolvedValueOnce({ data: receipts.submitTransfer, error: null }); await value.repo.submitTransfer(transferInput);
    expect(value.rpc).toHaveBeenLastCalledWith("submit_membership_wallet_transfer", { p_actor_id: actor, p_order_id: order.id, p_tx_hash: transferInput.txHash });
    for (const patch of [{ order_id: other }, { tx_hash: `0x${"b".repeat(64)}` }]) {
      value.rpc.mockResolvedValueOnce({ data: { order, verification: { ...walletPreviewVerification(), ...patch } }, error: null }); await expect(value.repo.submitTransfer(transferInput)).rejects.toThrow();
    }
  });
  it("matches public recipient, enabled state and CAS increment to the original admin request", async () => {
    const value = setup(receipts.saveRoute); await value.repo.saveRoute(routeInput);
    expect(value.rpc).toHaveBeenCalledWith("admin_save_membership_wallet_route", { p_actor_id: actor, p_route_id: order.route_id, p_recipient: order.recipient, p_enabled: true, p_expected_revision: 1, p_reason: routeInput.reason, p_request_id: membershipPreviewRequest });
    for (const patch of [{ enabled: false }, { revision: 3 }, { recipient: `0x${"2".repeat(40)}` }]) {
      value.rpc.mockResolvedValueOnce({ data: { ...receipts.saveRoute, ...patch }, error: null }); await expect(value.repo.saveRoute(routeInput)).rejects.toThrow();
    }
    value.rpc.mockResolvedValueOnce({ data: receipts.saveSettings, error: null }); await value.repo.saveSettings(settingsInput);
    expect(value.rpc).toHaveBeenLastCalledWith("admin_save_membership_wallet_settings", { p_actor_id: actor, p_enabled: false, p_expected_revision: 1, p_reason: settingsInput.reason, p_request_id: membershipPreviewRequest });
  });
  it("rejects invalid client identifiers before calling an external payment function", async () => {
    const value = setup({ order }); await expect(value.repo.create({ ...createInput, requestId: "bad-id" })).rejects.toThrow(); expect(value.invoke).not.toHaveBeenCalled();
    await expect(value.repo.submitTransfer({ ...transferInput, orderId: "bad-id" })).rejects.toThrow(); expect(value.rpc).not.toHaveBeenCalled();
  });
  it("binds an admin revocation to the exact order and revoked grant without a refund API", async () => {
    const value = setup(receipts.revokeOrder); await value.repo.revokeOrder(revokeInput);
    expect(value.rpc).toHaveBeenCalledWith("admin_revoke_membership_wallet_order", { p_actor_id: actor, p_order_id: order.id, p_reason: revokeInput.reason, p_request_id: membershipPreviewRequest }); expect(value.invoke).not.toHaveBeenCalled();
    for (const patch of [{ order_id: other }, { status: "active" }]) { value.rpc.mockResolvedValueOnce({ data: { ...receipts.revokeOrder, grant: { ...revokedGrant, ...patch } }, error: null }); await expect(value.repo.revokeOrder(revokeInput)).rejects.toThrow(); }
  });
});
