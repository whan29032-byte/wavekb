import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MembershipWallet, MembershipWalletSummary } from "./membership-wallet";
import { walletPreviewMine, walletPreviewOrder, walletPreviewVerification } from "./membership-wallet.fixtures";
import { membershipPreviewActor, membershipPreviewMine, membershipPreviewPlan } from "./membership-commerce.fixtures";
import { readWalletAttempt, walletAttemptKey } from "@/lib/membership/wallet-recovery";
import { MembershipWalletCheckoutError } from "@/lib/membership/wallet-client-repository";
import { installBrowserStorage } from "@/test/browser-storage";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), user: vi.fn(), mine: vi.fn(), commerce: vi.fn(), create: vi.fn(), submit: vi.fn(), unsubscribe: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { onAuthStateChange: mocks.auth, getUser: mocks.user } }) }));
vi.mock("@/lib/membership/commerce-client-repository", () => ({ membershipCommerceRepository: () => ({ mine: mocks.commerce }) }));
vi.mock("@/lib/membership/wallet-client-repository", async (original) => ({ ...await original<typeof import("@/lib/membership/wallet-client-repository")>(), membershipWalletRepository: () => ({ mine: mocks.mine, create: mocks.create, submitTransfer: mocks.submit }) }));
beforeEach(() => { vi.resetAllMocks(); installBrowserStorage(); mocks.auth.mockReturnValue({ data: { subscription: { unsubscribe: mocks.unsubscribe } } }); mocks.user.mockResolvedValue({ data: { user: { id: membershipPreviewActor } }, error: null }); mocks.mine.mockResolvedValue(walletPreviewMine(true)); mocks.commerce.mockResolvedValue(membershipPreviewMine()); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
async function buy() {
  fireEvent.change(screen.getByLabelText("VIP 方案"), { target: { value: membershipPreviewPlan.prices[0].id } });
  fireEvent.change(screen.getByLabelText("付款网络与币种"), { target: { value: "base-usdc" } });
  fireEvent.click(screen.getByRole("checkbox"));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "生成钱包付款订单" })); });
}
function show(initial = walletPreviewMine(true)) { return render(<MembershipWallet actorId={membershipPreviewActor} initial={initial} initialPlans={[membershipPreviewPlan]} />); }
describe("MembershipWallet authentic owner checkout and proof recovery", () => {
  it("keeps missing recipients/default gates closed without an invented address or free product", () => {
    show(walletPreviewMine()); expect(screen.getByText(/钱包收款尚未配置或未开放/)).toBeDefined(); expect(screen.queryByRole("button", { name: "生成钱包付款订单" })).toBeNull(); expect(screen.queryByText(/0x1111/)).toBeNull(); expect(screen.getByText("暂无有效 VIP 权益")).toBeDefined(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("creates one frozen original request and displays the full six-place amount only after owner readback", async () => {
    let mine = walletPreviewMine(true); mocks.mine.mockImplementation(async () => mine);
    mocks.create.mockImplementation(async (input) => { const order = { ...walletPreviewOrder(), request_id: input.requestId }; mine = { ...mine, orders: [order] }; return order; });
    show(mine); await buy(); await screen.findByText("52.001237 USDC");
    expect(mocks.create).toHaveBeenCalledOnce(); expect(mocks.create.mock.calls[0][0]).toMatchObject({ routeId: "base-usdc", expectedQuote: { amount_minor: 5200, route_revision: 1 } });
    expect(readWalletAttempt(membershipPreviewActor)).toBeNull(); expect(screen.getByText("暂无有效 VIP 权益")).toBeDefined(); expect(mocks.submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "核对钱包订单" })); await waitFor(() => expect(mocks.mine).toHaveBeenCalledTimes(3)); expect(mocks.create).toHaveBeenCalledOnce();
  });
  it("finds a committed checkout after a lost acknowledgement without creating another payment", async () => {
    let mine = walletPreviewMine(true); mocks.mine.mockImplementation(async () => mine);
    mocks.create.mockImplementation(async (input) => { mine = { ...mine, orders: [{ ...walletPreviewOrder(), request_id: input.requestId }] }; throw new Error("connection lost after commit"); });
    show(mine); await buy(); await screen.findByText(/原请求回执已恢复/); expect(readWalletAttempt(membershipPreviewActor)).toBeNull(); expect(mocks.create).toHaveBeenCalledOnce(); expect(screen.getByText("52.001237 USDC")).toBeDefined();
  });
  it("preserves an unknown request and retries only its original quote/id even after prices change", async () => {
    mocks.create.mockRejectedValue(new Error("unknown network outcome")); show(); await buy(); await screen.findByText(/结果仍不确定，原请求已保留/);
    const original = structuredClone(mocks.create.mock.calls[0][0]); expect(readWalletAttempt(membershipPreviewActor)).toMatchObject({ requestId: original.requestId });
    const changed = membershipPreviewMine(); changed.catalog.plans[0].prices[0].amount_minor = 5300; mocks.commerce.mockResolvedValue(changed);
    fireEvent.click(screen.getByRole("button", { name: "核对并继续原钱包请求" })); await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2)); expect(mocks.create.mock.calls[1][0]).toEqual(original);
  });
  it.each([new Error("membership_wallet_quote_changed"), new MembershipWalletCheckoutError("membership_wallet_quote_changed", 503), new MembershipWalletCheckoutError("membership_wallet_quote_changed_extra", 409)])("does not unfreeze an unknown rejection %s", async (error) => {
    mocks.create.mockRejectedValue(error); show(); await buy(); await screen.findByText(/结果仍不确定，原请求已保留/); expect(readWalletAttempt(membershipPreviewActor)).not.toBeNull();
  });
  it("releases only an acknowledged exact 409 quote rejection after a successful absent-original read", async () => {
    mocks.create.mockRejectedValue(new MembershipWalletCheckoutError("membership_wallet_quote_changed", 409)); show(); await buy(); await screen.findByText(/服务器明确拒绝旧报价/); expect(readWalletAttempt(membershipPreviewActor)).toBeNull(); expect(mocks.create).toHaveBeenCalledOnce();
  });
  it("does not create checkout when the displayed quote or route changed", async () => {
    const changed = walletPreviewMine(true); changed.catalog.routes[3].revision = 2; mocks.mine.mockResolvedValue(changed); show(); await buy(); await screen.findByText(/报价或收款配置已经更新/); expect(mocks.create).not.toHaveBeenCalled(); expect(readWalletAttempt(membershipPreviewActor)).toBeNull();
  });
  it("blocks payment if durable request storage is unavailable or corrupt", async () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new DOMException("disabled", "SecurityError"); }); show(); await buy(); await screen.findByText(/无法安全保存原请求/); expect(mocks.create).not.toHaveBeenCalled();
    cleanup(); vi.restoreAllMocks(); window.localStorage.setItem(walletAttemptKey(membershipPreviewActor), "{"); show(); expect((screen.getByRole("button", { name: "生成钱包付款订单" }) as HTMLButtonElement).disabled).toBe(true); expect(window.localStorage.getItem(walletAttemptKey(membershipPreviewActor))).toBe("{");
  });
  it("erases old account addresses and discards a late checkout after logout", async () => {
    let resolve!: (value: unknown) => void; mocks.create.mockReturnValue(new Promise((done) => { resolve = done; })); show(); await buy(); await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    await act(async () => { mocks.auth.mock.calls[0][0]("SIGNED_OUT", null); }); expect(screen.queryByText("当前实际 VIP 权益")).toBeNull(); expect(screen.getByRole("link", { name: "重新核对当前账号" })).toBeDefined();
    await act(async () => { resolve(walletPreviewOrder()); }); expect(screen.queryByText("52.001237 USDC")).toBeNull(); expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("requires a verified owner even if the auth event has not fired", async () => {
    mocks.user.mockResolvedValue({ data: { user: { id: "different-owner" } }, error: null }); show(); await buy(); await screen.findByRole("link", { name: "重新核对当前账号" }); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("queues a hash without claiming paid and recovers the exact committed proof after an unknown reply", async () => {
    let mine = { ...walletPreviewMine(true), orders: [walletPreviewOrder()] }; mocks.mine.mockImplementation(async () => mine);
    mocks.submit.mockImplementation(async () => { mine = { ...mine, verifications: [walletPreviewVerification()] }; throw new Error("lost proof reply"); });
    show(mine); fireEvent.change(screen.getByLabelText("已转账的交易哈希"), { target: { value: walletPreviewVerification().tx_hash } }); fireEvent.click(screen.getByRole("button", { name: "提交交易哈希核验" }));
    await screen.findByText(/原请求回执已恢复/); expect(readWalletAttempt(membershipPreviewActor)).toBeNull(); expect(mocks.submit).toHaveBeenCalledOnce(); expect(screen.getByText("正在核验转账")).toBeDefined(); expect(screen.getByText("暂无有效 VIP 权益")).toBeDefined(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("offers a corrected hash for a reviewed original order without granting or clearing review", async () => {
    const mine = { ...walletPreviewMine(true), orders: [walletPreviewOrder("review")], verifications: [walletPreviewVerification("review")] }; mocks.mine.mockResolvedValue(mine); show(mine);
    expect(screen.getByText("需要人工核对")).toBeDefined(); expect(screen.getByRole("button", { name: "提交修正哈希核验" })).toBeDefined(); expect(screen.queryByRole("button", { name: "生成钱包付款订单" })).toBeNull();
    fireEvent.change(screen.getByLabelText("核对后的正确交易哈希"), { target: { value: "wrong-hash" } }); fireEvent.click(screen.getByRole("button", { name: "提交修正哈希核验" })); expect(screen.getByRole("alert").textContent).toContain("完整交易哈希"); expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("corrects a valid-looking nonexistent waiting hash on the same order, then trusts one server-paid outcome", async () => {
    let mine = { ...walletPreviewMine(true), orders: [walletPreviewOrder()], verifications: [walletPreviewVerification("waiting")] };
    mocks.mine.mockImplementation(async () => mine); const corrected = `0x${"b".repeat(64)}`;
    mocks.submit.mockImplementation(async (input) => { const proof = { ...walletPreviewVerification(), id: "00000000-0000-4000-8000-000000000115", tx_hash: corrected }; mine = { ...mine, verifications: [proof, ...mine.verifications] }; return { order: mine.orders[0], verification: proof, input }; });
    show(mine); fireEvent.change(screen.getByLabelText("核对后的正确交易哈希"), { target: { value: corrected } }); fireEvent.click(screen.getByRole("button", { name: "提交修正哈希核验" })); await screen.findByText(/交易哈希已提交核验/);
    expect(mocks.submit).toHaveBeenCalledWith({ orderId: walletPreviewOrder().id, chain: "base", txHash: corrected }); expect(mocks.create).not.toHaveBeenCalled(); expect(screen.getByText("暂无有效 VIP 权益")).toBeDefined();
    mine = { ...mine, orders: [walletPreviewOrder("paid")], effective: { ...mine.effective, has_vip: true, ai_daily_limit: 50, mentor_discount_bps: 1000 } };
    fireEvent.click(screen.getByRole("button", { name: "核对钱包订单" })); await screen.findByText("有效 VIP 会员"); expect(mocks.submit).toHaveBeenCalledOnce(); expect(mocks.refresh).toHaveBeenCalledOnce(); expect(screen.getAllByText("付款已确认")).toHaveLength(1);
  });
  it("polls only existing invoices at 15 seconds while focused and cleans up on unmount", async () => {
    vi.useFakeTimers(); vi.spyOn(document, "hasFocus").mockReturnValue(true); const mine = { ...walletPreviewMine(true), orders: [walletPreviewOrder()] }; mocks.mine.mockResolvedValue(mine); const view = show(mine);
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); }); expect(mocks.mine).toHaveBeenCalledOnce(); expect(mocks.commerce).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled();
    vi.spyOn(document, "hasFocus").mockReturnValue(false); await act(async () => { await vi.advanceTimersByTimeAsync(15000); }); expect(mocks.mine).toHaveBeenCalledOnce(); view.unmount(); await act(async () => { await vi.advanceTimersByTimeAsync(15000); }); expect(mocks.mine).toHaveBeenCalledOnce(); expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });
  it("allows renewal and stops polling when a corrected order is paid despite an old waiting proof", async () => {
    vi.useFakeTimers(); vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const initial = { ...walletPreviewMine(true), orders: [walletPreviewOrder()], verifications: [walletPreviewVerification("waiting")] };
    mocks.mine.mockResolvedValue({ ...initial, orders: [walletPreviewOrder("paid")], effective: { ...initial.effective, has_vip: true, ai_daily_limit: 50, mentor_discount_bps: 1000 } }); show(initial);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "核对钱包订单" })); }); expect(screen.getByText("有效 VIP 会员")).toBeDefined();
    fireEvent.change(screen.getByLabelText("VIP 方案"), { target: { value: membershipPreviewPlan.prices[0].id } }); fireEvent.change(screen.getByLabelText("付款网络与币种"), { target: { value: "base-usdc" } }); fireEvent.click(screen.getByRole("checkbox"));
    expect((screen.getByRole("button", { name: "生成钱包付款订单" }) as HTMLButtonElement).disabled).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); }); expect(mocks.mine).toHaveBeenCalledOnce(); expect(mocks.create).not.toHaveBeenCalled(); expect(screen.queryByText("等待链上确认")).toBeNull();
  });
  it("only trusts server effective rights and refreshes the route when a newly paid receipt is read", async () => {
    const pending = { ...walletPreviewMine(true), orders: [walletPreviewOrder()] }; const paid = { ...pending, orders: [walletPreviewOrder("paid")], effective: { ...pending.effective, has_vip: true, ai_daily_limit: 50, mentor_discount_bps: 1000 } }; mocks.mine.mockResolvedValue(paid); show(pending);
    fireEvent.click(screen.getByRole("button", { name: "核对钱包订单" })); await screen.findByText("有效 VIP 会员"); expect(mocks.refresh).toHaveBeenCalledOnce(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("makes preview recipients nonpayable and preserves complete amount in every mocked state", () => {
    render(<MembershipWalletSummary mine={{ ...walletPreviewMine(true), orders: [walletPreviewOrder()] }} plans={[membershipPreviewPlan]} preview onRefresh={() => {}} onRecover={() => {}} onCreate={() => {}} onSubmit={() => {}} />);
    expect(screen.getByText("虚拟测试地址 · 不可转账")).toBeDefined(); expect(screen.queryByText(walletPreviewOrder().recipient)).toBeNull(); expect(screen.getByText("52.001237 USDC")).toBeDefined(); expect((screen.getByRole("button", { name: "复制收款地址" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
