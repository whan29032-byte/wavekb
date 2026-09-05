import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MentorCheckout } from "./mentor-checkout";
import { MentorThread } from "./mentor-thread";
import TutoringPage from "@/app/tutoring/page";
import MentorsPage from "@/app/mentors/page";
import type { MentorOffer, MentorPaymentMethod, MentorThread as Thread } from "@wavekb/domain";
import { installBrowserStorage } from "@/test/browser-storage";

const boundary = vi.hoisted(() => ({ client: {} as Record<string, unknown>, router: { refresh: vi.fn() } }));
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
const pendingOrder = { id: "order", buyer_id: "student", mentor_id: "mentor", offer_id: "offer", payment_method_id: "method", status: "pending", created_at: "2026-09-01T00:00:00Z" };
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
    rpc: async (name: string) => {
      if (name === "list_mentor_messages") { readCount++; return { data: messages, error: null }; }
      writes.push(name);
      if (name === "create_manual_mentor_order") return { data: "order", error: null };
      if (name === "submit_mentor_payment_claim") { claims = [claim]; return { data: "claim", error: null }; }
      return { data: 1, error: null };
    },
  };
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

function checkout(paymentMethod = method) {
  return render(<MentorCheckout actorId="student" mentorName="导师" offers={[offer]} paymentMethods={[paymentMethod]} returnPath="/mentors/mentor" />);
}

describe("mentor payment reliability", () => {
  it("restores a pending declaration after remount and blocks another payment submission", async () => {
    claims = [claim];
    const view = checkout();
    await screen.findByText(/待导师核对/);
    expect(screen.queryByRole("button", { name: "我已付款，通知导师" })).toBeNull();
    expect(document.querySelector(`time[datetime="${claim.submitted_at}"]`)).not.toBeNull();
    view.unmount();
    checkout();
    await screen.findByText(/待导师核对/);
    expect(writes).toEqual([]);
  });

  it("keeps pending declarations visible when the mentor withdraws all offers", async () => {
    claims = [claim];
    render(<MentorCheckout actorId="student" mentorName="导师" offers={[]} paymentMethods={[]} returnPath="/mentors/mentor" />);
    await screen.findByText(/待导师核对/);
    expect(writes).toEqual([]);
  });

  it("fails closed on a claim-read failure and retries the read without creating an order", async () => {
    readError = true;
    checkout();
    await screen.findByRole("button", { name: /重试.*状态/ });
    expect(screen.queryByRole("button", { name: "我已付款，通知导师" })).toBeNull();
    readError = false; claims = [claim];
    fireEvent.click(screen.getByRole("button", { name: /重试.*状态/ }));
    await screen.findByText(/待导师核对/);
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
    expect(copy).toHaveBeenCalledWith("123456789");
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

  it("never submits twice on repeated clicks and restores the submitted result on status reads", async () => {
    checkout();
    const button = await screen.findByRole("button", { name: "我已付款，通知导师" });
    fireEvent.click(button); fireEvent.click(button);
    await screen.findByText(/待导师核对/);
    expect(writes).toEqual(["create_manual_mentor_order", "submit_mentor_payment_claim"]);
  });

  it("removes already loaded private claims when the authenticated session changes", async () => {
    claims = [claim];
    checkout();
    await screen.findByText(/待导师核对/);
    boundary.client.auth = { getUser: async () => ({ data: { user: null }, error: null }) };
    fireEvent.click(screen.getByRole("button", { name: "刷新付款状态" }));
    await screen.findByRole("button", { name: /重试.*状态/ });
    expect(screen.queryByText(/待导师核对/)).toBeNull();
    expect(screen.queryByText("订单编号：order")).toBeNull();
  });

  it("only retries status reads after an uncertain write response", async () => {
    boundary.client.rpc = async (name: string) => {
      writes.push(name);
      if (name === "create_manual_mentor_order") return { data: "order", error: null };
      return { data: null, error: new Error("fetch failed") };
    };
    checkout();
    fireEvent.click(await screen.findByRole("button", { name: "我已付款，通知导师" }));
    await screen.findByRole("button", { name: "刷新付款状态" });
    fireEvent.click(screen.getByRole("button", { name: "刷新付款状态" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "我已付款，通知导师" })).toBeNull());
    expect(writes).toEqual(["create_manual_mentor_order", "submit_mentor_payment_claim"]);
  });

  it("retains an uncertain order ID and blocks a duplicate after the checkout is remounted", async () => {
    boundary.client.rpc = async (name: string) => { writes.push(name); return name === "create_manual_mentor_order" ? { data: "order", error: null } : { data: null, error: new Error("fetch failed") }; };
    const view = checkout();
    fireEvent.click(await screen.findByRole("button", { name: "我已付款，通知导师" }));
    await screen.findByRole("button", { name: "刷新付款状态" });
    view.unmount(); checkout();
    await screen.findByRole("button", { name: "刷新付款状态" });
    expect(screen.queryByRole("button", { name: "我已付款，通知导师" })).toBeNull();
    expect(screen.getByText(/待核实订单编号：order/)).toBeDefined();
    expect(writes).toEqual(["create_manual_mentor_order", "submit_mentor_payment_claim"]);
  });

  it("retains ambiguity after a lost create-order response even when no claim can be found", async () => {
    boundary.client.rpc = async (name: string) => { writes.push(name); return { data: null, error: new Error("fetch failed") }; };
    const view = checkout();
    fireEvent.click(await screen.findByRole("button", { name: "我已付款，通知导师" }));
    await screen.findByRole("button", { name: "刷新付款状态" });
    view.unmount(); checkout();
    await screen.findByRole("button", { name: "刷新付款状态" });
    expect(screen.queryByRole("button", { name: "我已付款，通知导师" })).toBeNull();
    expect(writes).toEqual(["create_manual_mentor_order"]);
  });

  it("shows an authorized pending order without a declaration on a different device", async () => {
    orders = [pendingOrder, { ...pendingOrder, id: "other-owner-order", buyer_id: "other" }, { ...pendingOrder, id: "other-mentor-order", mentor_id: "other-mentor" }];
    checkout();
    await screen.findByText(/待核实订单编号：order/);
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
    boundary.client.rpc = async (name: string) => name === "create_manual_mentor_order" ? { data: "order", error: null } : { data: null, error: new Error("fetch failed") };
    const view = checkout();
    fireEvent.click(await screen.findByRole("button", { name: "我已付款，通知导师" }));
    await screen.findByText(/待核实订单编号：order/);
    view.unmount(); claims = [{ ...claim, status: "confirmed" }];
    checkout();
    await screen.findByRole("button", { name: "我已付款，通知导师" });
    expect(localStorage.getItem("wavekb:mentor-payment-attempt:student:mentor")).toBeNull();
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
