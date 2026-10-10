import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminMentorOrder } from "./mentors-types";
import { adminMentorMutations, mentorOrderTransitions } from "./mentors-client-repository";

describe("mentor order transitions", () => {
  it("allows payment to activate rights and refund to revoke them", () => {
    expect(mentorOrderTransitions("pending")).toContain("paid");
    expect(mentorOrderTransitions("paid")).toContain("refunded");
  });

  it("does not reopen refunded orders or refund unpaid orders", () => {
    expect(mentorOrderTransitions("refunded")).toEqual(["refunded"]);
    expect(mentorOrderTransitions("cancelled")).toEqual(["cancelled"]);
    expect(mentorOrderTransitions("pending")).not.toContain("refunded");
  });

  it("uses an audited database RPC with expected status rather than a table PATCH", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: "order-1", status: "paid" }, error: null });
    const from = vi.fn();
    const client = { rpc, from } as unknown as SupabaseClient;
    const order = { id: "order-1", status: "pending", paid_at: null } as AdminMentorOrder;
    await expect(adminMentorMutations(client).updateOrder(order, "paid")).resolves.toEqual({ id: "order-1", status: "paid" });
    expect(rpc).toHaveBeenCalledWith("admin_transition_mentor_order", { p_order_id: "order-1", p_expected_status: "pending", p_status: "paid", p_reason: "后台订单状态更新" });
    expect(from).not.toHaveBeenCalled();
  });

  it("propagates stale-state rejection from the database", async () => {
    const error = { message: "order_changed_concurrently" };
    const client = { rpc: vi.fn().mockResolvedValue({ data: null, error }) } as unknown as SupabaseClient;
    await expect(adminMentorMutations(client).updateOrder({ id: "order-1", status: "pending" } as AdminMentorOrder, "paid")).rejects.toEqual(error);
  });
});
