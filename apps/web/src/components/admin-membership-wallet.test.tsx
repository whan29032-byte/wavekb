import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminMembershipWallet, MembershipWalletRevokeForm, MembershipWalletRouteForm, MembershipWalletSettingsForm } from "./admin-membership-wallet";
import { walletPreviewAdmin, walletPreviewOrder, walletPreviewRoutes } from "./membership-wallet.fixtures";
import { membershipPreviewActor } from "./membership-commerce.fixtures";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), store: vi.fn(), route: vi.fn(), settings: vi.fn(), revoke: vi.fn(), unsubscribe: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { onAuthStateChange: mocks.auth } }) }));
vi.mock("@/lib/membership/wallet-client-repository", () => ({ membershipWalletRepository: () => ({ adminStore: mocks.store, saveRoute: mocks.route, saveSettings: mocks.settings, revokeOrder: mocks.revoke }) }));
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockReturnValue({ data: { subscription: { unsubscribe: mocks.unsubscribe } } }); mocks.store.mockResolvedValue(walletPreviewAdmin()); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function routeForm() { return screen.getByRole("button", { name: "保存 base-usdc 收款配置" }).closest("form")!; }
function fillRoute() { const form = within(routeForm()); fireEvent.change(form.getByLabelText("公开收款地址"), { target: { value: `0x${"1".repeat(40)}` } }); fireEvent.change(form.getByLabelText("变更原因"), { target: { value: "运营确认公开收款" } }); return form; }
describe("admin wallet fixed-network and retry safeguards", () => {
  it("defaults to disabled, no recipient, fixed official contracts and no private-key inputs", () => {
    render(<AdminMembershipWallet actorId={membershipPreviewActor} initial={walletPreviewAdmin()} />);
    expect((screen.getByRole("checkbox", { name: "允许创建新的钱包付款订单" }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getAllByLabelText("公开收款地址").every((input) => (input as HTMLInputElement).value === "")).toBe(true);
    expect(screen.queryByLabelText("私钥")).toBeNull(); expect(screen.queryByRole("textbox", { name: "代币合约" })).toBeNull(); expect(mocks.settings).not.toHaveBeenCalled();
  });
  it("validates the network/recipient and focuses a clearly labelled erroneous field", () => {
    const save = vi.fn(); render(<MembershipWalletRouteForm route={walletPreviewRoutes()[3]} pending={false} save={save} />);
    fireEvent.change(screen.getByLabelText("公开收款地址"), { target: { value: "not-a-public-address" } }); fireEvent.change(screen.getByLabelText("变更原因"), { target: { value: "核对公开地址" } }); fireEvent.submit(screen.getByRole("button").closest("form")!);
    expect(screen.getByRole("alert").textContent).toContain("完整公开收款地址"); expect(document.activeElement).toBe(screen.getByLabelText("公开收款地址")); expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("公开收款地址"), { target: { value: walletPreviewRoutes()[3].contract } }); fireEvent.submit(screen.getByRole("button").closest("form")!); expect(save).not.toHaveBeenCalled();
  });
  it("does not enable an empty route, even if the checkbox was manually checked", () => {
    const save = vi.fn(); render(<MembershipWalletRouteForm route={walletPreviewRoutes()[0]} pending={false} save={save} />);
    fireEvent.change(screen.getByLabelText("变更原因"), { target: { value: "必须先提供地址" } }); fireEvent.click(screen.getByRole("checkbox")); fireEvent.submit(screen.getByRole("button").closest("form")!); expect(screen.getByRole("alert").textContent).toContain("缺少收款地址"); expect(save).not.toHaveBeenCalled();
  });
  it("normalizes EVM casing, preserves reason/CAS and never lets admin replace the official asset contract", () => {
    const save = vi.fn(); render(<MembershipWalletRouteForm route={walletPreviewRoutes()[3]} pending={false} save={save} />);
    fireEvent.change(screen.getByLabelText("公开收款地址"), { target: { value: `0x${"A".repeat(40)}` } }); fireEvent.change(screen.getByLabelText("变更原因"), { target: { value: "确认同链地址" } }); fireEvent.submit(screen.getByRole("button").closest("form")!);
    expect(save).toHaveBeenCalledWith({ routeId: "base-usdc", recipient: `0x${"a".repeat(40)}`, enabled: false, revision: 1, reason: "确认同链地址" });
  });
  it("requires a meaningful reason for global gate mutations and leaves the initial value unchanged", () => {
    const save = vi.fn(); render(<MembershipWalletSettingsForm settings={{ enabled: false, revision: 2 }} configured pending={false} save={save} />); fireEvent.click(screen.getByRole("checkbox")); fireEvent.submit(screen.getByRole("button").closest("form")!);
    expect(screen.getByRole("alert").textContent).toContain("3—500"); expect(document.activeElement).toBe(screen.getByLabelText("变更原因")); expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("变更原因"), { target: { value: "公开钱包订单开关" } }); fireEvent.submit(screen.getByRole("button").closest("form")!); expect(save).toHaveBeenCalledWith({ enabled: true, revision: 2, reason: "公开钱包订单开关" });
  });
  it("verifies saved config and leaves old invoice snapshots to the server instead of rewriting them", async () => {
    let store = walletPreviewAdmin(); mocks.store.mockImplementation(async () => store);
    mocks.route.mockImplementation(async (input) => { store = { ...store, routes: store.routes.map((route) => route.id === input.routeId ? { ...route, recipient: input.recipient, revision: 2 } : route) }; return store.routes[3]; });
    render(<AdminMembershipWallet actorId={membershipPreviewActor} initial={store} />); fillRoute(); fireEvent.click(screen.getByRole("button", { name: "保存 base-usdc 收款配置" })); await screen.findByText(/钱包配置回执已核对/);
    expect(mocks.route).toHaveBeenCalledOnce(); expect(mocks.route.mock.calls[0][0]).toMatchObject({ routeId: "base-usdc", revision: 1, enabled: false }); expect(mocks.route.mock.calls[0][0].requestId).toMatch(/^[0-9a-f-]{36}$/i); expect(mocks.settings).not.toHaveBeenCalled();
  });
  it("freezes uncertain edits and retries the identical saved request/CAS after a fresh read", async () => {
    mocks.route.mockRejectedValue(new Error("unknown save outcome")); render(<AdminMembershipWallet actorId={membershipPreviewActor} initial={walletPreviewAdmin()} />); fillRoute(); fireEvent.click(screen.getByRole("button", { name: "保存 base-usdc 收款配置" }));
    await screen.findByText(/保存结果尚未确认，原请求已保留/); const original = structuredClone(mocks.route.mock.calls[0][0]); expect(screen.queryByLabelText("公开收款地址")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "核对并重试原钱包配置" })); await waitFor(() => expect(mocks.route).toHaveBeenCalledTimes(2)); expect(mocks.route.mock.calls[1][0]).toEqual(original); expect(mocks.store).toHaveBeenCalledOnce();
  });
  it("cannot retry an uncertain write while the fresh configuration read is failing", async () => {
    mocks.route.mockRejectedValue(new Error("unknown save outcome")); render(<AdminMembershipWallet actorId={membershipPreviewActor} initial={walletPreviewAdmin()} />); fillRoute(); fireEvent.click(screen.getByRole("button", { name: "保存 base-usdc 收款配置" })); await screen.findByText(/保存结果尚未确认/);
    mocks.store.mockRejectedValue(new Error("offline")); fireEvent.click(screen.getByRole("button", { name: "核对并重试原钱包配置" })); await waitFor(() => expect(mocks.store).toHaveBeenCalledOnce()); expect(mocks.route).toHaveBeenCalledOnce();
  });
  it("clears old config and ignores late admin receipts after identity changes", async () => {
    let resolve!: (value: unknown) => void; mocks.route.mockReturnValue(new Promise((done) => { resolve = done; })); render(<AdminMembershipWallet actorId={membershipPreviewActor} initial={walletPreviewAdmin()} />); fillRoute(); fireEvent.click(screen.getByRole("button", { name: "保存 base-usdc 收款配置" })); await waitFor(() => expect(mocks.route).toHaveBeenCalledOnce());
    await act(async () => { mocks.auth.mock.calls[0][0]("SIGNED_OUT", null); }); expect(screen.queryByLabelText("公开收款地址")).toBeNull();
    await act(async () => { resolve({}); }); expect(mocks.store).not.toHaveBeenCalled(); expect(screen.getByRole("link", { name: "重新核对当前账号" })).toBeDefined();
  });
  it("requires explicit paid-order confirmation and reason, offers no revoke for review/pending and no refund", () => {
    const revoke = vi.fn(); const view = render(<MembershipWalletRevokeForm order={walletPreviewOrder("paid")} pending={false} revoke={revoke} />); const submit = screen.getByRole("button", { name: "撤销此单 VIP 权益" }); expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(submit.closest("form")!); expect(revoke).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("checkbox")); fireEvent.change(screen.getByLabelText("撤销原因"), { target: { value: "已完成人工处理，仅撤销此单权益" } }); fireEvent.submit(submit.closest("form")!);
    expect(revoke).toHaveBeenCalledWith({ orderId: walletPreviewOrder().id, reason: "已完成人工处理，仅撤销此单权益" }); expect(screen.getByText(/不会执行链上退款/)).toBeDefined();
    view.rerender(<MembershipWalletRevokeForm order={walletPreviewOrder("review")} pending={false} revoke={revoke} />); expect(screen.queryByRole("button")).toBeNull();
  });
  it("retries an uncertain paid-order revoke with the same order/reason/request, never issuing a refund", async () => {
    const store = { ...walletPreviewAdmin(), orders: [walletPreviewOrder("paid")] }; mocks.store.mockResolvedValue(store); mocks.revoke.mockRejectedValue(new Error("unknown revocation reply"));
    render(<AdminMembershipWallet actorId={membershipPreviewActor} initial={store} />); fireEvent.change(screen.getByLabelText("撤销原因"), { target: { value: "仅处理已付款订单权益" } }); fireEvent.click(screen.getByRole("checkbox", { name: "确认只撤销此订单 VIP 权益，系统不会退款" })); fireEvent.click(screen.getByRole("button", { name: "撤销此单 VIP 权益" }));
    await screen.findByText(/保存结果尚未确认，原请求已保留/); const original = structuredClone(mocks.revoke.mock.calls[0][0]); expect(original.orderId).toBe(walletPreviewOrder().id);
    fireEvent.click(screen.getByRole("button", { name: "核对并重试原钱包配置" })); await waitFor(() => expect(mocks.revoke).toHaveBeenCalledTimes(2)); expect(mocks.revoke.mock.calls[1][0]).toEqual(original); expect(mocks.route).not.toHaveBeenCalled(); expect(mocks.settings).not.toHaveBeenCalled();
  });
});
