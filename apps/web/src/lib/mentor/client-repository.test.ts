import { describe, expect, it, vi } from "vitest";
import { submitManualMentorPayment } from "./client-repository";

describe("manual mentor payment transaction", () => {
  it("records the returned order ID before a claim can fail", async () => {
    const checkpoints: string[] = [];
    await expect(submitManualMentorPayment({} as never, { offerId: "offer", paymentMethodId: "method", buyerNote: "", onOrderCreated: (id) => { checkpoints.push(id); } }, {
      createOrder: async () => "known-order", submitClaim: async () => { throw new Error("ambiguous claim response"); },
    })).rejects.toThrow("ambiguous claim response");
    expect(checkpoints).toEqual(["known-order"]);
  });
  it("creates the pending order before submitting its payment claim", async () => {
    const calls: string[] = [];
    const result = await submitManualMentorPayment({} as never, {
      offerId: "offer-id",
      paymentMethodId: "method-id",
      buyerNote: "  转账编号 94217  ",
    }, {
      createOrder: vi.fn(async () => { calls.push("order"); return "order-id"; }),
      submitClaim: vi.fn(async (_orderId, note) => { calls.push(`claim:${note}`); return "claim-id"; }),
    });
    expect(calls).toEqual(["order", "claim:转账编号 94217"]);
    expect(result).toEqual({ orderId: "order-id", claimId: "claim-id" });
  });

  it("does not submit a claim when order creation fails", async () => {
    const submitClaim = vi.fn(async () => "claim-id");
    await expect(submitManualMentorPayment({} as never, {
      offerId: "offer-id",
      paymentMethodId: "method-id",
      buyerNote: "",
    }, {
      createOrder: vi.fn(async () => { throw new Error("offer unavailable"); }),
      submitClaim,
    })).rejects.toThrow("offer unavailable");
    expect(submitClaim).not.toHaveBeenCalled();
  });
});
