import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MembershipCommerce } from "./membership-commerce";
import { membershipPreviewActor, membershipPreviewMine, membershipPreviewOrder, membershipPreviewPlan, membershipPreviewRequest } from "./membership-commerce.fixtures";
import { membershipQuote, type MembershipOrder, type MyMembershipCommerce } from "@/lib/membership/commerce-types";
import { membershipAttemptKey, readMembershipAttempt, writeMembershipAttempt } from "@/lib/membership/checkout-recovery";
import { installBrowserStorage } from "@/test/browser-storage";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), user: vi.fn(), mine: vi.fn(), invoke: vi.fn(), navigate: vi.fn(), unsubscribe: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { onAuthStateChange: mocks.auth, getUser: mocks.user }, functions: { invoke: mocks.invoke } }) }));
vi.mock("@/lib/membership/commerce-client-repository", () => ({ membershipCommerceRepository: () => ({ mine: mocks.mine }) }));
vi.mock("@/lib/membership/checkout-recovery", async (original) => ({ ...await original<typeof import("@/lib/membership/checkout-recovery")>(), openMembershipCheckout: mocks.navigate }));
const checkpoint = { ownerId: membershipPreviewActor, requestId: membershipPreviewRequest, expectedQuote: membershipQuote(membershipPreviewPlan, membershipPreviewPlan.prices[0]) };
beforeEach(() => { vi.resetAllMocks(); installBrowserStorage(); mocks.auth.mockReturnValue({ data: { subscription: { unsubscribe: mocks.unsubscribe } } }); mocks.user.mockResolvedValue({ data: { user: { id: membershipPreviewActor } }, error: null }); mocks.mine.mockResolvedValue(membershipPreviewMine(true)); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, "", "/"); });
async function buy() { await act(async () => { fireEvent.click(screen.getByRole("button", { name: "测试购买月度" })); }); }

describe("MembershipCommerce", () => {
  it("keeps legacy Stripe fully read-only on the real membership page even when its old gate is open", async () => {
    const mine=membershipPreviewMine(true); mine.orders=[membershipPreviewOrder()]; render(<MembershipCommerce actorId={membershipPreviewActor} initial={mine} readOnly />);
    expect(screen.queryByRole("button",{name:"测试购买月度"})).toBeNull(); expect(screen.queryByRole("button",{name:"核对并继续此订单"})).toBeNull();
    expect(screen.getByRole("heading",{name:"既有会员权益与历史订单"})).toBeDefined(); expect(mocks.invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:"核对购买与订单"})); await screen.findByText("已核对既有会员权益与历史订单。"); expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("keeps disabled billing closed without inventing effective VIP", () => {
    render(<MembershipCommerce actorId={membershipPreviewActor} initial={membershipPreviewMine()} />);
    expect(screen.queryByRole("button", { name: "测试购买月度" })).toBeNull(); expect(screen.getByText("暂无有效 VIP 权益")).toBeDefined(); expect(mocks.invoke).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "继续阅读公开知识库" }).getAttribute("href")).toBe("/knowledge");
  });
  it("freezes the actual quote, verifies the order readback, then follows the trusted checkout", async () => {
    let mine = membershipPreviewMine(true); mocks.mine.mockImplementation(async () => mine);
    mocks.invoke.mockImplementation(async (_name, { body }) => { const order = { ...membershipPreviewOrder(), request_id: body.requestId }; mine = { ...mine, orders: [order] }; return { data: { orderId: order.id, checkoutUrl: order.checkout_url }, error: null }; });
    render(<MembershipCommerce actorId={membershipPreviewActor} initial={mine} />); await buy();
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith(membershipPreviewOrder().checkout_url));
    const call = mocks.invoke.mock.calls[0]; expect(call[0]).toBe("membership-checkout"); expect(call[1].body).toMatchObject({ actorId: membershipPreviewActor, priceId: membershipPreviewPlan.prices[0].id, expectedQuote: checkpoint.expectedQuote });
    expect(call[1].body.requestId).toMatch(/^[0-9a-f-]{36}$/i); expect(mocks.mine).toHaveBeenCalledTimes(2); expect(readMembershipAttempt(membershipPreviewActor)?.requestId).toBe(call[1].body.requestId);
    expect(screen.queryByText("有效 VIP 会员")).toBeNull();
  });
  it("recovers a committed order after lost acknowledgement without deleting its marker or creating another", async () => {
    let mine = membershipPreviewMine(true); mocks.mine.mockImplementation(async () => mine);
    mocks.invoke.mockImplementation(async (_name, { body }) => { mine = { ...mine, orders: [{ ...membershipPreviewOrder(), request_id: body.requestId }] }; return { data: null, error: new Error("network lost after commit") }; });
    render(<MembershipCommerce actorId={membershipPreviewActor} initial={mine} />); await buy(); await screen.findByText(/已读到原订单，请核对下方状态/);
    const originalId = mocks.invoke.mock.calls[0][1].body.requestId;
    expect(readMembershipAttempt(membershipPreviewActor)?.requestId).toBe(originalId); expect(screen.getByText(/购买时的 VIP 名称/)).toBeDefined(); expect(mocks.navigate).not.toHaveBeenCalled();
    mocks.invoke.mockResolvedValue({ data: { orderId: mine.orders[0].id, checkoutUrl: mine.orders[0].checkout_url }, error: null });
    fireEvent.click(screen.getByRole("button", { name: "核对并继续此订单" })); await waitFor(() => expect(mocks.navigate).toHaveBeenCalledOnce()); expect(mocks.invoke).toHaveBeenCalledTimes(2); expect(mocks.invoke.mock.calls[1][1].body.requestId).toBe(originalId);
  });
  it("cannot retry an unknown result until own-order reads succeed, then reuses the exact original ID and quote", async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: new Error("network lost") });
    render(<MembershipCommerce actorId={membershipPreviewActor} initial={membershipPreviewMine(true)} />); await buy(); await screen.findByText(/结果仍不确定，原请求已保留/);
    const original = structuredClone(mocks.invoke.mock.calls[0][1].body);
    mocks.mine.mockRejectedValue(new Error("offline")); fireEvent.click(screen.getByRole("button", { name: "核对并继续原请求" })); await screen.findByRole("alert");
    await waitFor(() => expect((screen.getByRole("button", { name: "核对并继续原请求" }) as HTMLButtonElement).disabled).toBe(false)); expect(mocks.invoke).toHaveBeenCalledOnce();
    const changed = membershipPreviewMine(true); changed.catalog.plans[0].prices[0].amount_minor = 5300; mocks.mine.mockResolvedValue(changed);
    fireEvent.click(screen.getByRole("button", { name: "核对并继续原请求" })); await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
    expect(mocks.invoke.mock.calls[1][1].body).toEqual(original); expect(readMembershipAttempt(membershipPreviewActor)?.expectedQuote.amount_minor).toBe(5200);
  });
  it("does not issue checkout if durable storage is disabled", async () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new DOMException("storage disabled", "SecurityError"); });
    render(<MembershipCommerce actorId={membershipPreviewActor} initial={membershipPreviewMine(true)} />); await buy(); await screen.findByText(/当前不会发起新的付款请求/);
    expect(mocks.invoke).not.toHaveBeenCalled(); expect(screen.queryByText(/原请求已保留/)).toBeNull();
  });
  it("retains a corrupt checkpoint and blocks new purchase instead of discarding it", () => {
    window.localStorage.setItem(membershipAttemptKey(membershipPreviewActor), "{"); render(<MembershipCommerce actorId={membershipPreviewActor} initial={membershipPreviewMine(true)} />);
    expect((screen.getByRole("button", { name: "测试购买月度" }) as HTMLButtonElement).disabled).toBe(true); expect(window.localStorage.getItem(membershipAttemptKey(membershipPreviewActor))).toBe("{"); expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("clears old actor data and prevents late checkout navigation on cross-tab logout", async () => {
    let finish!: (value: unknown) => void; mocks.invoke.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(<MembershipCommerce actorId={membershipPreviewActor} initial={membershipPreviewMine(true)} />); await buy(); await waitFor(() => expect(mocks.invoke).toHaveBeenCalledOnce());
    await act(async () => { mocks.auth.mock.calls[0][0]("SIGNED_OUT", null); });
    expect(screen.queryByText("当前实际权益")).toBeNull(); expect(screen.getByRole("link", { name: "重新核对当前账号" }).getAttribute("href")).toBe("/membership");
    await act(async () => { finish({ data: { orderId: membershipPreviewOrder().id, checkoutUrl: membershipPreviewOrder().checkout_url }, error: null }); }); expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it("rechecks the authenticated actor before sending even if the auth subscription has not fired", async () => {
    mocks.user.mockResolvedValue({ data: { user: { id: "another-owner" } }, error: null });
    render(<MembershipCommerce actorId={membershipPreviewActor} initial={membershipPreviewMine(true)} />); await buy(); await screen.findByRole("link", { name: "重新核对当前账号" }); expect(mocks.invoke).not.toHaveBeenCalled(); expect(screen.queryByText("当前实际权益")).toBeNull();
  });
  it("requires a fresh user confirmation when a new quote changed before checkout", async () => {
    const changed = membershipPreviewMine(true); changed.catalog.plans[0].prices[0].amount_minor = 5300; mocks.mine.mockResolvedValue(changed);
    render(<MembershipCommerce actorId={membershipPreviewActor} initial={membershipPreviewMine(true)} />); await buy(); await screen.findByText(/方案或价格已经更新/); expect(mocks.invoke).not.toHaveBeenCalled(); expect(readMembershipAttempt(membershipPreviewActor)).toBeNull();
  });
  it("rejects an untrusted receipt URL and retains the unresolved request", async () => {
    mocks.invoke.mockResolvedValue({ data: { orderId: membershipPreviewOrder().id, checkoutUrl: "https://checkout.stripe.com.evil.test" }, error: null });
    render(<MembershipCommerce actorId={membershipPreviewActor} initial={membershipPreviewMine(true)} />); await buy(); await screen.findByText(/结果仍不确定，原请求已保留/); expect(mocks.navigate).not.toHaveBeenCalled(); expect(readMembershipAttempt(membershipPreviewActor)).not.toBeNull();
  });
  it("does not grant membership from a success query, a paid test order, or an unknown return", async () => {
    window.history.replaceState(null, "", "/membership?payment=success&order=arbitrary");
    writeMembershipAttempt(checkpoint); const order: MembershipOrder = { ...membershipPreviewOrder(), status: "paid", paid_at: "2026-10-10T01:00:00Z" };
    const mine: MyMembershipCommerce = { ...membershipPreviewMine(true), orders: [order] }; mocks.mine.mockResolvedValue(mine);
    render(<MembershipCommerce actorId={membershipPreviewActor} initial={mine} />); fireEvent.click(screen.getByRole("button", { name: "核对购买与订单" }));
    await waitFor(() => expect(readMembershipAttempt(membershipPreviewActor)).toBeNull()); expect(screen.getByText("暂无有效 VIP 权益")).toBeDefined(); expect(screen.queryByText("有效 VIP 会员")).toBeNull(); expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("does not follow an expired original checkout or create a replacement request", async () => {
    writeMembershipAttempt(checkpoint); const mine = { ...membershipPreviewMine(true), orders: [{ ...membershipPreviewOrder(), checkout_expires_at: "2000-01-01T00:00:00Z" }] }; mocks.mine.mockResolvedValue(mine);
    render(<MembershipCommerce actorId={membershipPreviewActor} initial={mine} />); fireEvent.click(screen.getByRole("button", { name: "核对并继续此订单" })); await screen.findByText(/原支付页面已过期/); expect(mocks.navigate).not.toHaveBeenCalled(); expect(mocks.invoke).not.toHaveBeenCalled(); expect(readMembershipAttempt(membershipPreviewActor)?.requestId).toBe(membershipPreviewRequest);
  });
  it("a server-confirmed failed payment does not grant VIP or leave new purchases deadlocked", async () => {
    writeMembershipAttempt(checkpoint); const mine = { ...membershipPreviewMine(true), orders: [{ ...membershipPreviewOrder(), status: "failed" as const }] }; mocks.mine.mockResolvedValue(mine);
    render(<MembershipCommerce actorId={membershipPreviewActor} initial={mine} />); fireEvent.click(screen.getByRole("button", { name: "核对购买与订单" }));
    await waitFor(() => expect(readMembershipAttempt(membershipPreviewActor)).toBeNull()); expect(screen.getByText(/支付失败，未授权权益/)).toBeDefined(); expect(screen.getByText("暂无有效 VIP 权益")).toBeDefined();
    expect((screen.getByRole("button", { name: "测试购买月度" }) as HTMLButtonElement).disabled).toBe(false); expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("revalidates a pending checkout through the server and honors the payment kill switch", async () => {
    writeMembershipAttempt(checkpoint); const mine = { ...membershipPreviewMine(true), orders: [membershipPreviewOrder()] }; mocks.mine.mockResolvedValue(mine);
    mocks.invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({ error: "membership_billing_unavailable" }), { status: 409 }) } });
    render(<MembershipCommerce actorId={membershipPreviewActor} initial={mine} />); fireEvent.click(screen.getByRole("button", { name: "核对并继续此订单" })); await screen.findByText(/当前付款或方案不可用/);
    expect(mocks.invoke).toHaveBeenCalledOnce(); expect(mocks.invoke.mock.calls[0][1].body.requestId).toBe(membershipPreviewRequest); expect(mocks.navigate).not.toHaveBeenCalled(); expect(readMembershipAttempt(membershipPreviewActor)).toEqual(checkpoint);
  });
  it("a payment-confirmation race reads the paid status instead of reopening checkout", async () => {
    writeMembershipAttempt(checkpoint); let mine = { ...membershipPreviewMine(true), orders: [membershipPreviewOrder()] }; mocks.mine.mockImplementation(async () => mine);
    mocks.invoke.mockImplementation(async () => { mine = { ...mine, orders: [{ ...mine.orders[0], status: "paid", paid_at: "2026-10-10T01:00:00Z" }] }; return { data: null, error: { context: new Response(JSON.stringify({ error: "membership_payment_confirmation_pending" }), { status: 409 }) } }; });
    render(<MembershipCommerce actorId={membershipPreviewActor} initial={mine} />); fireEvent.click(screen.getByRole("button", { name: "核对并继续此订单" })); await screen.findByText(/原订单状态已核对/);
    expect(readMembershipAttempt(membershipPreviewActor)).toBeNull(); expect(mocks.navigate).not.toHaveBeenCalled(); expect(mocks.invoke).toHaveBeenCalledOnce(); expect(screen.getByText("暂无有效 VIP 权益")).toBeDefined();
  });
  it("releases only an exactly acknowledged 409 quote rejection after successful absent-order proof and requires a new click", async () => {
    let mine = membershipPreviewMine(true); mocks.mine.mockImplementation(async () => mine);
    mocks.invoke.mockImplementationOnce(async () => { mine = membershipPreviewMine(true); mine.catalog.plans[0].prices[0].amount_minor = 5300; return { data: null, error: { context: new Response(JSON.stringify({ error: "membership_quote_changed" }), { status: 409 }) } }; });
    render(<MembershipCommerce actorId={membershipPreviewActor} initial={mine} />); await buy(); await screen.findByText(/服务器明确拒绝了旧报价/);
    const originalId = mocks.invoke.mock.calls[0][1].body.requestId; expect(readMembershipAttempt(membershipPreviewActor)).toBeNull(); expect(mocks.invoke).toHaveBeenCalledOnce(); expect(mocks.navigate).not.toHaveBeenCalled();
    expect(screen.getByText(/US\$53\.00/)).toBeDefined(); expect((screen.getByRole("button", { name: "测试购买月度" }) as HTMLButtonElement).disabled).toBe(false);
    mocks.invoke.mockResolvedValue({ data: null, error: new Error("unknown") }); await buy(); await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
    expect(mocks.invoke.mock.calls[1][1].body.requestId).not.toBe(originalId); expect(mocks.invoke.mock.calls[1][1].body.expectedQuote.amount_minor).toBe(5300);
  });
  it.each([{ code: "membership_quote_changed", status: 503 }, { code: "membership_quote_changed_extra", status: 409 }])("keeps unknown quote outcomes frozen for $code/$status", async ({ code, status }) => {
    mocks.invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({ error: code }), { status }) } });
    render(<MembershipCommerce actorId={membershipPreviewActor} initial={membershipPreviewMine(true)} />); await buy(); await screen.findByText(/结果仍不确定，原请求已保留/); expect(readMembershipAttempt(membershipPreviewActor)).not.toBeNull(); expect(mocks.invoke).toHaveBeenCalledOnce();
  });
  it("does not treat a generic quote-changed error string as an authoritative rejection", async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: new Error("membership_quote_changed") }); render(<MembershipCommerce actorId={membershipPreviewActor} initial={membershipPreviewMine(true)} />); await buy(); await screen.findByText(/结果仍不确定，原请求已保留/); expect(readMembershipAttempt(membershipPreviewActor)).not.toBeNull();
  });
  it("cannot release a rejected quote when own-order verification fails", async () => {
    mocks.mine.mockResolvedValueOnce(membershipPreviewMine(true)).mockRejectedValue(new Error("read failed"));
    mocks.invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({ error: "membership_quote_changed" }), { status: 409 }) } });
    render(<MembershipCommerce actorId={membershipPreviewActor} initial={membershipPreviewMine(true)} />); await buy(); await screen.findByText(/结果仍不确定，原请求已保留/); expect(readMembershipAttempt(membershipPreviewActor)).not.toBeNull(); expect(screen.queryByText(/服务器明确拒绝了旧报价/)).toBeNull();
  });
  it("cannot release a rejected quote if the original request has an order", async () => {
    let mine = membershipPreviewMine(true); mocks.mine.mockImplementation(async () => mine);
    mocks.invoke.mockImplementation(async (_name, { body }) => { mine = { ...mine, orders: [{ ...membershipPreviewOrder(), request_id: body.requestId }] }; return { data: null, error: { context: new Response(JSON.stringify({ error: "membership_quote_changed" }), { status: 409 }) } }; });
    render(<MembershipCommerce actorId={membershipPreviewActor} initial={mine} />); await buy(); await screen.findByText(/已读到原订单，请核对/); expect(readMembershipAttempt(membershipPreviewActor)).not.toBeNull(); expect(screen.queryByText(/服务器明确拒绝了旧报价/)).toBeNull(); expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
