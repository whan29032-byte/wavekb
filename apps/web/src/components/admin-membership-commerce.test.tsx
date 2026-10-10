import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminMembershipCommerce, MembershipCommerceSettingsForm, MembershipEntitlementsForm, MembershipPriceForm, membershipDecimalMinor } from "./admin-membership-commerce";
import { membershipPreviewActor, membershipPreviewAdmin, membershipPreviewPlan } from "./membership-commerce.fixtures";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), store: vi.fn(), price: vi.fn(), entitlements: vi.fn(), settings: vi.fn(), unsubscribe: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { onAuthStateChange: mocks.auth } }) }));
vi.mock("@/lib/membership/commerce-client-repository", () => ({ membershipCommerceRepository: () => ({ adminStore: mocks.store, savePrice: mocks.price, saveEntitlements: mocks.entitlements, saveSettings: mocks.settings }) }));
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockReturnValue({ data: { subscription: { unsubscribe: mocks.unsubscribe } } }); mocks.store.mockResolvedValue(membershipPreviewAdmin()); });
afterEach(cleanup);
function submit(name: string) { const form = screen.getByRole("button", { name }).closest("form")!; fireEvent.change(within(form).getByLabelText("变更原因"), { target: { value: "已确认配置调整" } }); fireEvent.submit(form); }

describe("membership commerce admin forms", () => {
  it.each([["52", 5200], ["520.00", 52000], ["10.25", 1025], ["0", 0]])("parses exact decimal %s without floating rounding", (input, value) => { expect(membershipDecimalMinor(input as string)).toBe(value); });
  it.each(["1.001", "1e2", "-1", "NaN", "", "Infinity"])("rejects unsupported decimal %s", (value) => { expect(() => membershipDecimalMinor(value)).toThrow(); });
  it("submits actual monthly price with its immutable identity and expected revision", () => {
    const save = vi.fn(); render(<MembershipPriceForm price={membershipPreviewPlan.prices[0]} pending={false} save={save} />);
    const input = screen.getByLabelText("价格（USD）"); expect(input.getAttribute("step")).toBe("0.01");
    fireEvent.change(input, { target: { value: "53.25" } }); submit("保存月度价格");
    expect(save).toHaveBeenCalledWith({ id: membershipPreviewPlan.prices[0].id, planKey: "vip", termMonths: 1, amountMinor: 5325, currency: "USD", published: true, revision: 1, reason: "已确认配置调整" });
  });
  it("maps a 10% discount to 1000 bps and allows explicit zero platform quota", () => {
    const save = vi.fn(); render(<MembershipEntitlementsForm plan={membershipPreviewPlan} pending={false} save={save} />);
    fireEvent.change(screen.getByLabelText("每日平台 AI 次数"), { target: { value: "0" } }); submit("保存数值权益");
    expect(save).toHaveBeenCalledWith({ planKey: "vip", aiDailyLimit: 0, mentorDiscountBps: 1000, revision: 2, reason: "已确认配置调整" });
    expect(screen.getByLabelText("导师价格优惠（%）").getAttribute("step")).toBe("0.01");
  });
  it("rejects a 100% free mentor discount and explains the supported positive-payment limit", () => {
    const save = vi.fn(); render(<MembershipEntitlementsForm plan={membershipPreviewPlan} pending={false} save={save} />);
    const input = screen.getByLabelText("导师价格优惠（%）"); expect(input.getAttribute("max")).toBe("99");
    fireEvent.change(input, { target: { value: "100" } }); submit("保存数值权益"); expect(save).not.toHaveBeenCalled(); expect(screen.getByRole("alert").textContent).toContain("不能设置 100% 免费"); expect(document.activeElement).toBe(input);
  });
  it("does not silently accept excess price precision or whitespace-only reasons", () => {
    const save = vi.fn(); render(<MembershipPriceForm price={membershipPreviewPlan.prices[0]} pending={false} save={save} />);
    fireEvent.change(screen.getByLabelText("价格（USD）"), { target: { value: "52.001" } }); submit("保存月度价格"); expect(save).not.toHaveBeenCalled(); expect(screen.getByRole("alert").textContent).toContain("两位小数");
    fireEvent.change(screen.getByLabelText("价格（USD）"), { target: { value: "52" } }); const reason = screen.getByLabelText("变更原因"); fireEvent.change(reason, { target: { value: "   " } }); fireEvent.submit(screen.getByRole("button", { name: "保存月度价格" }).closest("form")!); expect(save).not.toHaveBeenCalled(); expect(screen.getByRole("alert").textContent).toContain("有效字符"); expect(document.activeElement).toBe(reason); expect(reason.getAttribute("aria-invalid")).toBe("true");
  });
  it("saves payment mode and billing separately from public price publication", () => {
    const save = vi.fn(); render(<MembershipCommerceSettingsForm settings={{ billing_enabled: false, payment_mode: "test", revision: 3 }} pending={false} save={save} />);
    fireEvent.change(screen.getByLabelText("付款模式"), { target: { value: "live" } }); submit("保存付款设置");
    expect(save).toHaveBeenCalledWith({ billingEnabled: false, paymentMode: "live", revision: 3, reason: "已确认配置调整" });
  });
});

describe("AdminMembershipCommerce", () => {
  it("validates a save then reads back current configuration", async () => {
    mocks.price.mockResolvedValue({}); render(<AdminMembershipCommerce actorId={membershipPreviewActor} initial={membershipPreviewAdmin()} />); submit("保存月度价格");
    await screen.findByText(/配置回执已验证/); expect(mocks.price).toHaveBeenCalledOnce(); expect(mocks.store).toHaveBeenCalledOnce(); expect(mocks.price.mock.calls[0][0].requestId).toMatch(/^[0-9a-f-]{36}$/i);
  });
  it("preserves an unknown save request and retries it only after a successful read", async () => {
    mocks.price.mockRejectedValueOnce(new Error("acknowledgement lost")).mockResolvedValueOnce({});
    render(<AdminMembershipCommerce actorId={membershipPreviewActor} initial={membershipPreviewAdmin()} />); submit("保存月度价格"); await screen.findByText(/保存结果尚未确认/);
    const original = mocks.price.mock.calls[0][0]; expect((screen.getByRole("button", { name: "保存月度价格" }) as HTMLButtonElement).disabled).toBe(true);
    mocks.store.mockRejectedValueOnce(new Error("read unavailable")); fireEvent.click(screen.getByRole("button", { name: "核对并重试原配置请求" }));
    await waitFor(() => expect(mocks.store).toHaveBeenCalledOnce()); await waitFor(() => expect((screen.getByRole("button", { name: "核对并重试原配置请求" }) as HTMLButtonElement).disabled).toBe(false)); expect(mocks.price).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "核对并重试原配置请求" })); await screen.findByText(/配置回执已验证/); expect(mocks.price).toHaveBeenCalledTimes(2); expect(mocks.price.mock.calls[1][0]).toEqual(original);
  });
  it("does not deadlock editing after an explicit CAS rejection; it reloads the new revision", async () => {
    mocks.price.mockRejectedValue({ message: "membership_changed_concurrently" }); const latest = membershipPreviewAdmin(); latest.plans[0].prices[0].revision = 2; latest.plans[0].prices[0].amount_minor = 5400; mocks.store.mockResolvedValue(latest);
    render(<AdminMembershipCommerce actorId={membershipPreviewActor} initial={membershipPreviewAdmin()} />); submit("保存月度价格"); await screen.findByText(/服务器已明确拒绝此变更/);
    expect(screen.queryByRole("button", { name: "核对并重试原配置请求" })).toBeNull(); expect((screen.getByRole("button", { name: "保存月度价格" }) as HTMLButtonElement).disabled).toBe(false); expect((screen.getAllByLabelText("价格（USD）")[0] as HTMLInputElement).value).toBe("54.00");
  });
  it("clears old configuration on identity change and ignores a late save receipt", async () => {
    let finish!: (value: unknown) => void; mocks.price.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(<AdminMembershipCommerce actorId={membershipPreviewActor} initial={membershipPreviewAdmin()} />); submit("保存月度价格"); await waitFor(() => expect(mocks.price).toHaveBeenCalledOnce());
    await act(async () => { mocks.auth.mock.calls[0][0]("SIGNED_IN", { user: { id: "different-admin" } }); });
    expect(screen.queryByRole("button", { name: "保存月度价格" })).toBeNull(); expect(screen.getByRole("link", { name: "重新核对当前账号" }).getAttribute("href")).toBe("/admin/memberships");
    await act(async () => { finish({}); }); expect(mocks.store).not.toHaveBeenCalled(); expect(screen.queryByText(/配置回执已验证/)).toBeNull();
  });
  it("removes stale config after a failed refresh rather than leaving it actionable", async () => {
    mocks.store.mockRejectedValue(new Error("offline")); render(<AdminMembershipCommerce actorId={membershipPreviewActor} initial={membershipPreviewAdmin()} />); fireEvent.click(screen.getByRole("button", { name: "重新核对付款配置" })); await screen.findByRole("alert"); expect(screen.queryByRole("button", { name: "保存月度价格" })).toBeNull(); expect(screen.getByText(/购买配置尚不可用/)).toBeDefined();
  });
});
