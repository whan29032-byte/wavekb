
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MentorCheckout } from "./mentor-checkout";
import { MentorThread } from "./mentor-thread";
import TutoringPage from "@/app/tutoring/page";
import MentorsPage from "@/app/mentors/page";
import type { MentorOffer, MentorPaymentMethod, MentorThread as Thread } from "@wavekb/domain";
import { installBrowserStorage } from "@/test/browser-storage";

const boundary = vi.hoisted(() => ({ client: {} as Record<string, unknown>, router: { refresh: vi.fn() } }));
const quoteBoundary = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/mentor/client-repository", async (original) => ({ ...await original<typeof import("@/lib/mentor/client-repository")>(), getMyMentorOfferQuote: quoteBoundary.read }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => boundary.client }));
vi.mock("next/navigation", () => ({ useRouter: () => boundary.router }));
vi.mock("@/lib/auth/dal", () => ({ requireActiveMember: async () => ({ id: "student" }), getCurrentUser: async () => ({ id: "student" }) }));
vi.mock("@/lib/env", () => ({ publicSupabaseConfig: () => ({ configured: true }) }));
vi.mock("@/lib/mentor/server-repository", () => ({
  getMyMentorSettings: async () => null,
  listMyMentorAccess: async () => [],
  listMentorCatalog: async () => [{ mentor_id: "mentor", display_name: "导师", specialties: [], credentials: [], languages: [], offers: [{ ...offer, price_cents: 50000 }, { ...offer, id: "cheapest", price_cents: 10000 }, { ...offer, id: "disabled", price_cents: 100, active: false }] }],
}));

const offer: MentorOffer = { id: "offer", name: "30 天辅导", description: "", price_cents: 10000, currency: "USDT", duration_days: 30, weekly_questions: 3, active: true };
const method: MentorPaymentMethod = { id: "method", mentor_id: "mentor", kind: "binance", label: "币安 UID", account_name: "导师", account_value: "123456789", network: "USDT", instructions: "", active: true };
const claim = { id: "claim", order_id: "order", buyer_id: "student", mentor_id: "mentor", payment_method_id: "method", status: "submitted", submitted_at: "2026-09-01T00:00:00Z", reviewed_at: null };
const pendingOrder = { id: "order", buyer_id: "student", mentor_id: "mentor", offer_id: "offer", payment_method_id: "method", payment_provider: "manual", status: "pending", created_at: "2026-09-01T00:00:00Z" };
const thread: Thread = { thread_id: "thread", mentor_id: "mentor", mentor_name: "导师", mentor_avatar_url: null, student_id: "student", status: "active", weekly_question_limit: 3, questions_used: 0, starts_at: "2026-01-01T00:00:00Z", ends_at: "2099-01-01T00:00:00Z" };
let claims: typeof claim[];
let orders: typeof pendingOrder[];
let authenticatedBuyer: string;
let readError: boolean;
let writes: string[];
let messages: { id: number; sender_id: string; message_kind: string; body: string; created_at: string }[];
let readCount: number;

beforeEach(() => {
  installBrowserStorage(); orders = []; authenticatedBuyer = "student";
  claims = []; readError = false; writes = []; messages = []; readCount = 0;
  boundary.router.refresh.mockReset();
  quoteBoundary.read.mockReset();
  quoteBoundary.read.mockResolvedValue({ price_cents: 10000, base_price_cents: 10000, discount_bps: 0, currency: "USDT", duration_days: 30, weekly_questions: 3 });
  boundary.client = {
    auth: { getUser: async () => ({ data: { user: { id: authenticatedBuyer } }, error: null }) },
    from: (table: string) => {
      if (!["mentor_payment_claims", "mentor_orders"].includes(table)) throw new Error(`Unexpected table ${table}`);
      const filters: Record<string, string> = {};
      const query = {
        select: () => query,
        eq: (key: string, value: string) => { filters[key] = value; return query; },
        order: async () => {
          if (filters.buyer_id !== authenticatedBuyer) throw new Error("Buyer scope missing");
          if (table === "mentor_orders" && filters.status !== "pending") throw new Error("Pending scope missing");
          return { data: (table === "mentor_orders" ? orders : claims).filter((item) => item.buyer_id === filters.buyer_id && (!filters.mentor_id || item.mentor_id === filters.mentor_id)), error: readError ? new Error("offline") : null };
        },
      };
      return query;
    },
    rpc: async (name: string, params?: Record<string, string>) => {
      if (name === "list_mentor_messages") { readCount++; return { data: messages, error: null }; }
      writes.push(name);
      if (name === "submit_manual_mentor_payment") { claims = [claim]; return { data: { order_id: "order", claim_id: "claim" }, error: null }; }
      if (name === "submit_mentor_payment_claim") { claims = [claim]; return { data: "claim", error: null }; }
      if (name === "cancel_unsubmitted_mentor_order") { orders = orders.filter((order) => order.id !== params?.p_order_id); return { data: params?.p_order_id, error: null }; }
      return { data: 1, error: null };
    },
  };
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

function checkout(paymentMethod = method) {
  return render(<MentorCheckout actorId="student" mentorName="导师" offers={[offer]} paymentMethods={[paymentMethod]} returnPath="/mentors/mentor" />);
}

describe("mentor payment reliability", () => {
  it("shows and freezes the authenticated discounted quote, not the offer base amount", async () => {
    quoteBoundary.read.mockResolvedValue({ price_cents: 9000, base_price_cents: 10000, discount_bps: 1000, currency: "USDT", duration_days: 30, weekly_questions: 3 });
    const rpc = vi.fn().mockResolvedValue({ data: { order_id: "order", claim_id: "claim" }, error: null });
    boundary.client.rpc = rpc;
    checkout();
    expect(await screen.findByText(/有效 VIP 优惠 10%/)).toBeDefined();
    const button = await screen.findByRole("button", { name: "我已付款，通知导师" });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(rpc.mock.calls[0]).toEqual(["submit_manual_mentor_payment", expect.objectContaining({ p_expected_quote: { price_cents: 9000, currency: "USDT", duration_days: 30, weekly_questions: 3 } })]);
  });
  it("blocks payment when the canonical quote fails rather than charging the visible base price", async () => {
    quoteBoundary.read.mockRejectedValue(new Error("offer_quote_unavailable"));
    checkout();
    await waitFor(() => expect(quoteBoundary.read).toHaveBeenCalled());
    const button = await screen.findByRole("button", { name: "我已付款，通知导师" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button); expect(writes).toEqual([]);
  });
  it("invalidates a verified quote immediately on auth owner change and disables payment", async () => {
    let listener: ((event: string, session: { user: { id: string } } | null) => void) | undefined;
    boundary.client.auth = { getUser: async () => ({ data: { user: { id: authenticatedBuyer } }, error: null }), onAuthStateChange: (callback: typeof listener) => { listener = callback; return { data: { subscription: { unsubscribe: vi.fn() } } }; } };
    checkout();
    const button = await screen.findByRole("button", { name: "我已付款，通知导师" });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    await act(async () => { authenticatedBuyer = "other"; listener?.("SIGNED_IN", { user: { id: "other" } }); });
    expect((button as HTMLButtonElement).disabled).toBe(true); fireEvent.click(button); expect(writes).toEqual([]);
    expect(screen.queryByText(/本次应付/)).toBeNull();
  });
  it("shows only unresolved mentor-detail payment state without order identifiers", async () => {
    claims = [
      { ...claim, id: "submitted-claim", order_id: "submitted-order" },
      { ...claim, id: "confirmed-claim", order_id: "confirmed-order", status: "confirmed" },
      { ...claim, id: "rejected-claim", order_id: "rejected-order", status: "rejected" },
      { ...claim, id: "cancelled-claim", order_id: "cancelled-order", status: "cancelled" },
    ];
    orders = [{ ...pendingOrder, id: "unclaimed-pending-order" }];

    checkout();

    const summary = await screen.findByRole("region", { name: "付款待核对摘要" });
    expect(within(summary).getByText("2 项待核对付款")).toBeDefined();
    expect(within(summary).getByRole("link", { name: "查看完整付款记录" }).getAttribute("href")).toBe("/tutoring");
    expect(screen.queryByText(/submitted-order|confirmed-order|rejected-order|cancelled-order|unclaimed-pending-order/)).toBeNull();
    expect(screen.queryByText(/导师已确认|导师未确认付款|已取消/)).toBeNull();
  });

  it("restores a pending declaration after remount and blocks another payment submission", async () => {
    claims = [claim];
    const view = checkout();
    await screen.findByRole("region", { name: "付款待核对摘要" });
    expect(screen.queryByRole("button", { name: "我已付款，通知导师" })).toBeNull();
    view.unmount();
    checkout();
    await screen.findByRole("region", { name: "付款待核对摘要" });
    expect(writes).toEqual([]);
  });

  it("keeps pending declarations visible when the mentor withdraws all offers", async () => {
    claims = [claim];
    render(<MentorCheckout actorId="student" mentorName="导师" offers={[]} paymentMethods={[]} returnPath="/mentors/mentor" />);
    await screen.findByRole("region", { name: "付款待核对摘要" });
    expect(writes).toEqual([]);
  });

  it("fails closed on a claim-read failure and retries the read without creating an order", async () => {
    readError = true;
    checkout();
    await screen.findByRole("button", { name: /重试.*状态/ });
    expect(screen.queryByRole("button", { name: "我已付款，通知导师" })).toBeNull();
    readError = false; claims = [claim];
    fireEvent.click(screen.getByRole("button", { name: /重试.*状态/ }));
    await screen.findByRole("region", { name: "付款待核对摘要" });
    expect(writes).toEqual([]);
  });

  it("identifies a binance method as the unchanged Binance UID regardless of its label", async () => {
    checkout({ ...method, label: "导师收款方式" });
    await screen.findByText("币安 UID");
    expect(screen.getByText(/网络字段.*USDT/)).toBeDefined();
    expect(screen.getByText("123456789")).toBeDefined();
    expect(screen.getByText(/不是 PayID/)).toBeDefined();
  });

  it("does not infer Binance UID from digits when the method kind is unknown", async () => {
    checkout({ ...method, kind: "other", label: "导师收款方式" });
    await screen.findByText("收款账号");
    expect(screen.queryByText("币安 UID")).toBeNull();
    expect(screen.getByText("123456789")).toBeDefined();
  });

  it("blocks malformed chain configuration instead of offering a guessed transfer destination", async () => {
    checkout({ ...method, kind: "crypto", network: "USDT", account_value: "123456789" });
    await screen.findByText(/收款配置需要导师核实/);
    expect((screen.getByRole("button", { name: "我已付款，通知导师" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /复制收款/ })).toBeNull();
    expect(writes).toEqual([]);
  });

  it.each(["other", "crypto"])("still blocks ambiguous network routing for %s rather than inferring Binance from digits", async (kind) => {
    checkout({ ...method, kind: kind as MentorPaymentMethod["kind"], label: "平台收款", network: "TRC: T111111111111111111111111111111111" });
    await screen.findByText(/收款配置需要导师核实/);
    expect((screen.getByRole("button", { name: "我已付款，通知导师" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /复制收款/ })).toBeNull();
    expect(writes).toEqual([]);
  });

  it("allows only the explicitly typed numeric Binance UID despite unrelated legacy network text", async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
    checkout({ ...method, network: "TRC: T111111111111111111111111111111111" });
    const button = await screen.findByRole("button", { name: /复制收款/ });
    fireEvent.click(button);
    await waitFor(() => expect(copy).toHaveBeenCalledWith("123456789"));
    expect((screen.getByRole("button", { name: "我已付款，通知导师" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/不作为支付路由/)).toBeDefined();
    expect(writes).toEqual([]);
  });

  it("does not enable a nonnumeric account merely because the method says Binance", async () => {
    checkout({ ...method, account_value: "T111111111111111111111111111111111" });
    await screen.findByText(/收款配置需要导师核实/);
    expect(screen.queryByRole("button", { name: /复制收款/ })).toBeNull();
    expect((screen.getByRole("button", { name: "我已付款，通知导师" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not read or display a different buyer's claims after a session change", async () => {
    claims = [claim];
    boundary.client.auth = { getUser: async () => ({ data: { user: { id: "other-user" } }, error: null }) };
    checkout();
    await screen.findByRole("button", { name: /重试.*状态/ });
    expect(screen.queryByText(/待导师核对/)).toBeNull();
    expect(writes).toEqual([]);
  });

  it("shows persistent pending claims in my tutoring even before rights exist", async () => {
    claims = [claim];
    render(await TutoringPage());
    await screen.findByText(/待导师核对/);
  });

  it("reloads server-owned rights when a pending declaration becomes confirmed", async () => {
    claims = [claim];
    render(await TutoringPage());
    await screen.findByText(/待导师核对/);
    claims = [{ ...claim, status: "confirmed" }];
    fireEvent.click(screen.getByRole("button", { name: "刷新付款状态" }));
    await screen.findByText("导师已确认");
    expect(boundary.router.refresh).toHaveBeenCalledOnce();
  });

  it("shows the minimum enabled price rather than the first sorted offer", async () => {
    render(await MentorsPage());
    expect(screen.queryByText("100 USDT 起")).not.toBeNull();
    expect(screen.queryByText("500 USDT 起")).toBeNull();
  });

  it("presents service guarantees as one compact list", async () => {
    render(await MentorsPage());
    const guarantees = screen.getByRole("list", { name: "辅导服务保障" });
    expect(within(guarantees).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByRole("complementary", { name: "辅导服务说明" })).toBeNull();
  });

  it("presents the mentor directory as full-width profile rows", async () => {
    render(await MentorsPage());
    const directory = screen.getByRole("region", { name: "导师目录" });
    const profiles = within(directory).getByRole("list", { name: "导师列表" });
    expect(within(profiles).getAllByRole("listitem")).toHaveLength(1);
  });

  it("never submits twice on repeated clicks and restores the submitted result on status reads", async () => {
    checkout();
    const button = await screen.findByRole("button", { name: "我已付款，通知导师" });
    fireEvent.click(button); fireEvent.click(button);
    await screen.findByRole("region", { name: "付款待核对摘要" });
    expect(writes).toEqual(["submit_manual_mentor_payment"]);
  });

  it("restores checkout in the same mount after the submitted claim is rejected", async () => {
    checkout();
    fireEvent.click(await screen.findByRole("button", { name: "我已付款，通知导师" }));
    await screen.findByRole("region", { name: "付款待核对摘要" });

    claims = [{ ...claim, status: "rejected" }];
    fireEvent.click(screen.getByRole("button", { name: "刷新付款状态" }));

    const restoredCheckout = await screen.findByRole("button", { name: "我已付款，通知导师" });
    expect(screen.queryByText("已通知导师核对付款")).toBeNull();

    fireEvent.click(restoredCheckout);
    await screen.findByRole("region", { name: "付款待核对摘要" });
    expect(writes).toEqual(["submit_manual_mentor_payment", "submit_manual_mentor_payment"]);
  });

  it("removes already loaded private claims when the authenticated session changes", async () => {
    claims = [claim];
    checkout();
    await screen.findByRole("region", { name: "付款待核对摘要" });
    boundary.client.auth = { getUser: async () => ({ data: { user: null }, error: null }) };
    fireEvent.click(screen.getByRole("button", { name: "刷新付款状态" }));
    await screen.findByRole("button", { name: /重试.*状态/ });
    expect(screen.queryByText("订单编号：order")).toBeNull();
  });

  it("only retries status reads after an uncertain write response", async () => {
    boundary.client.rpc = async (name: string) => {
      writes.push(name);
      return { data: null, error: new Error("fetch failed") };
    };
    checkout();
    fireEvent.click(await screen.findByRole("button", { name: "我已付款，通知导师" }));
    await screen.findByRole("button", { name: "刷新付款状态" });
    fireEvent.click(screen.getByRole("button", { name: "刷新付款状态" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "我已付款，通知导师" })).toBeNull());
    expect(writes).toEqual(["submit_manual_mentor_payment"]);
  });

  it("retains a stable uncertain request and blocks a new payment after remount", async () => {
    boundary.client.rpc = async (name: string) => { writes.push(name); return { data: null, error: new Error("fetch failed") }; };
    const view = checkout();
    fireEvent.click(await screen.findByRole("button", { name: "我已付款，通知导师" }));
    await screen.findByRole("button", { name: "刷新付款状态" });
    view.unmount(); checkout();
    await screen.findByRole("button", { name: "刷新付款状态" });
    expect(screen.queryByRole("button", { name: "我已付款，通知导师" })).toBeNull();
    expect(screen.getByRole("region", { name: "付款待核对摘要" })).toBeDefined();
    expect(writes).toEqual(["submit_manual_mentor_payment"]);
    expect(await screen.findByRole("button", { name: "核对并重试原付款声明" })).toBeDefined();
  });

  it("retains ambiguity after a lost create-order response even when no claim can be found", async () => {
    boundary.client.rpc = async (name: string) => { writes.push(name); return { data: null, error: new Error("fetch failed") }; };
    const view = checkout();
    fireEvent.click(await screen.findByRole("button", { name: "我已付款，通知导师" }));
    await screen.findByRole("button", { name: "刷新付款状态" });
    view.unmount(); checkout();
    await screen.findByRole("button", { name: "刷新付款状态" });
    expect(screen.queryByRole("button", { name: "我已付款，通知导师" })).toBeNull();
    expect(writes).toEqual(["submit_manual_mentor_payment"]);
  });

  it("shows an authorized pending order without a declaration on a different device", async () => {
    orders = [pendingOrder, { ...pendingOrder, id: "other-owner-order", buyer_id: "other" }, { ...pendingOrder, id: "other-mentor-order", mentor_id: "other-mentor" }];
    checkout();
    await screen.findByRole("region", { name: "付款待核对摘要" });
    expect(screen.queryByText(/other-owner-order|other-mentor-order/)).toBeNull();
    expect(screen.queryByRole("button", { name: "我已付款，通知导师" })).toBeNull();
    expect(writes).toEqual([]);
  });

  it("does not start an order if the local ambiguity marker cannot be persisted", async () => {
    checkout();
    const button = await screen.findByRole("button", { name: "我已付款，通知导师" });
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); });
    fireEvent.click(button);
    await screen.findByText(/无法保存付款核对标记/);
    expect(writes).toEqual([]);
  });

  it("rechecks a marker written by another tab before starting a new order", async () => {
    checkout();
    const button = await screen.findByRole("button", { name: "我已付款，通知导师" });
    localStorage.setItem("wavekb:mentor-payment-attempt:student:mentor", JSON.stringify({ ownerId: "student", mentorId: "mentor", startedAt: "2026-09-05", orderId: "other-tab-order" }));
    fireEvent.click(button);
    await screen.findByRole("button", { name: "刷新付款状态" });
    expect(writes).toEqual([]);
    expect(localStorage.getItem("wavekb:mentor-payment-attempt:student:mentor")).toContain("other-tab-order");
  });

  it("hides payment instructions when another tab starts an unresolved submission", async () => {
    checkout();
    await screen.findByRole("button", { name: "我已付款，通知导师" });
    const key = "wavekb:mentor-payment-attempt:student:mentor";
    const value = JSON.stringify({ ownerId: "student", mentorId: "mentor", startedAt: "2026-09-05" });
    localStorage.setItem(key, value);
    act(() => window.dispatchEvent(new StorageEvent("storage", { key, newValue: value })));
    await screen.findByRole("button", { name: "刷新付款状态" });
    expect(screen.queryByRole("button", { name: /复制收款/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "我已付款，通知导师" })).toBeNull();
  });

  it.each(["buyer", "mentor"])("does not carry uncertainty to a different %s", async (scope) => {
    boundary.client.rpc = async () => ({ data: null, error: new Error("fetch failed") });
    const view = checkout();
    fireEvent.click(await screen.findByRole("button", { name: "我已付款，通知导师" }));
    await screen.findByRole("button", { name: "刷新付款状态" });
    view.unmount(); authenticatedBuyer = scope === "buyer" ? "other" : "student";
    render(<MentorCheckout actorId={authenticatedBuyer} mentorName="导师" offers={[offer]} paymentMethods={[{ ...method, mentor_id: scope === "mentor" ? "other-mentor" : "mentor" }]} returnPath={scope === "mentor" ? "/mentors/other-mentor" : "/mentors/mentor"} />);
    expect(await screen.findByRole("button", { name: "我已付款，通知导师" })).toBeDefined();
  });

  it("reconciles a known local order with its later authoritative declaration", async () => {
    localStorage.setItem("wavekb:mentor-payment-attempt:student:mentor", JSON.stringify({ ownerId: "student", mentorId: "mentor", startedAt: "2026-09-05", orderId: "order" }));
    const view = checkout();
    await screen.findByRole("region", { name: "付款待核对摘要" });
    view.unmount(); claims = [{ ...claim, status: "confirmed" }];
    checkout();
    await screen.findByRole("button", { name: "我已付款，通知导师" });
    expect(localStorage.getItem("wavekb:mentor-payment-attempt:student:mentor")).toBeNull();
  });

  it("retries an unknown response with exactly the same request and displayed quote", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: null, error: { message: "fetch failed" } }).mockImplementation(async () => { claims = [claim]; return { data: { order_id: "order", claim_id: "claim" }, error: null }; });
    boundary.client.rpc = rpc;
    checkout();
    fireEvent.click(await screen.findByRole("button", { name: "我已付款，通知导师" }));
    await screen.findByRole("button", { name: "核对并重试原付款声明" });
    const marker = JSON.parse(localStorage.getItem("wavekb:mentor-payment-attempt:student:mentor") || "null");
    expect(marker.requestId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(marker.expectedQuote).toEqual({ price_cents: 10000, currency: "USDT", duration_days: 30, weekly_questions: 3 });
    fireEvent.click(screen.getByRole("button", { name: "核对并重试原付款声明" }));
    await screen.findByText("待导师核对");
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
    expect(localStorage.getItem("wavekb:mentor-payment-attempt:student:mentor")).toBeNull();
  });

  it("re-enables submission after a storage failure before any network write", async () => {
    checkout();
    const button = await screen.findByRole("button", { name: "我已付款，通知导师" });
    const store = vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); });
    fireEvent.click(button);
    await screen.findByText(/无法保存付款核对标记/);
    expect((screen.getByRole("button", { name: "我已付款，通知导师" }) as HTMLButtonElement).disabled).toBe(false);
    expect(writes).toEqual([]);
    store.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "我已付款，通知导师" }));
    await screen.findByText("待导师核对");
    expect(writes).toEqual(["submit_manual_mentor_payment"]);
  });

  it("does not preserve uncertainty when the session failed before submitting", async () => {
    checkout();
    const button = await screen.findByRole("button", { name: "我已付款，通知导师" });
    boundary.client.auth = { getUser: async () => ({ data: { user: null }, error: null }) };
    fireEvent.click(button);
    await screen.findByRole("button", { name: "重试查询状态" });
    expect(writes).toEqual([]);
    boundary.client.auth = { getUser: async () => ({ data: { user: { id: "student" } }, error: null }) };
    fireEvent.click(screen.getByRole("button", { name: "重试查询状态" }));
    fireEvent.click(await screen.findByRole("button", { name: "我已付款，通知导师" }));
    await screen.findByText("待导师核对");
    expect(writes).toEqual(["submit_manual_mentor_payment"]);
  });

  it("a definite quote rejection shows useful guidance without a dead-end marker", async () => {
    boundary.client.rpc = async () => ({ data: null, error: { code: "P0001", message: "offer_changed" } });
    checkout();
    fireEvent.click(await screen.findByRole("button", { name: "我已付款，通知导师" }));
    await screen.findByText(/方案已更新，请联系导师核对已转账金额/);
    expect((screen.getByRole("button", { name: "我已付款，通知导师" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("button", { name: "核对并重试原付款声明" })).toBeNull();
    expect(localStorage.getItem("wavekb:mentor-payment-attempt:student:mentor")).toBeNull();
  });

  it("lets the buyer resume a legacy orphan rather than creating another order", async () => {
    orders = [pendingOrder];
    checkout();
    fireEvent.click(await screen.findByRole("button", { name: "已付款，补交原订单声明" }));
    await screen.findByText("待导师核对");
    expect(writes).toEqual(["submit_mentor_payment_claim"]);
  });

  it("requires unpaid confirmation before cancelling a legacy orphan and clearing its checkpoint", async () => {
    orders = [pendingOrder];
    localStorage.setItem("wavekb:mentor-payment-attempt:student:mentor", JSON.stringify({ ownerId: "student", mentorId: "mentor", startedAt: "2026-09-05", orderId: "order" }));
    checkout();
    const button = await screen.findByRole("button", { name: "取消未付款原订单" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "我确认此订单从未转账，需要取消" }));
    fireEvent.click(button);
    await screen.findByRole("button", { name: "我已付款，通知导师" });
    expect(writes).toEqual(["cancel_unsubmitted_mentor_order"]);
    expect(localStorage.getItem("wavekb:mentor-payment-attempt:student:mentor")).toBeNull();
  });

  it("does not offer manual declaration or cancellation for hosted-payment orders", async () => {
    orders = [{ ...pendingOrder, payment_provider: "stripe" }];
    checkout();
    await screen.findByText(/不是可补交声明的手工付款订单/);
    expect(screen.queryByRole("button", { name: "已付款，补交原订单声明" })).toBeNull();
    expect(screen.queryByRole("button", { name: "取消未付款原订单" })).toBeNull();
    expect(writes).toEqual([]);
  });
});

describe("mentor conversation reliability", () => {
  it("treats elapsed active rights as read-only and offers the same mentor renewal route", () => {
    render(<MentorThread actorId="student" thread={{ ...thread, ends_at: "2026-01-02T00:00:00Z" }} initialMessages={[]} />);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.queryByText("3 / 3")).toBeNull();
    expect(screen.getByRole("link", { name: /续订/ }).getAttribute("href")).toBe("/mentors/mentor");
  });

  it("refreshes incoming replies and stops all reads after unmount", async () => {
    vi.useFakeTimers();
    const view = render(<MentorThread actorId="student" thread={thread} initialMessages={[]} />);
    messages = [{ id: 2, sender_id: "mentor-owner", message_kind: "reply", body: "这是新回复", created_at: "2026-09-05T00:00:00Z" }];
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(screen.queryByText("这是新回复")).not.toBeNull();
    view.unmount();
    const readsBefore = readCount;
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(readCount).toBe(readsBefore);
  });

  it("keeps the existing mentor reply permission after the student's right expires", () => {
    render(<MentorThread actorId="mentor-owner" thread={{ ...thread, status: "expired" }} initialMessages={[]} />);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(false);
  });
});
