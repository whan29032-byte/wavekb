import { describe, expect, it, vi } from "vitest";
import { cancelUnsubmittedMentorOrder, getMyMentorOfferQuote, isDefiniteMentorCheckoutFailure, resumeManualMentorPayment, submitManualMentorPayment } from "./client-repository";

const input = { offerId: "offer-id", paymentMethodId: "method-id", buyerNote: "  转账编号 94217  ", requestId: "11111111-1111-4111-8111-111111111111", expectedQuote: { price_cents: 10000, currency: "USDT", duration_days: 30, weekly_questions: 3 } };

describe("atomic manual mentor payment", () => {
  it("uses the authenticated canonical discounted quote and rechecks identity after receiving it", async () => {
    const quote = { ...input.expectedQuote, price_cents: 9000, base_price_cents: 10000, discount_bps: 1000 };
    const rpc = vi.fn(async () => ({ data: quote, error: null }));
    const getUser = vi.fn().mockResolvedValueOnce({ data: { user: { id: "actor" } }, error: null }).mockResolvedValueOnce({ data: { user: { id: "other" } }, error: null });
    await expect(getMyMentorOfferQuote({ rpc, auth: { getUser } } as never, "actor", "offer")).rejects.toThrow("authentication_required");
    expect(getUser).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("get_my_mentor_offer_quote", { p_actor_id: "actor", p_offer_id: "offer" });
  });
  it("rejects malformed or unverified quote data without falling back to the offer's base price", async () => {
    const client = { auth: { getUser: async () => ({ data: { user: { id: "actor" } }, error: null }) }, rpc: async () => ({ data: { ...input.expectedQuote, price_cents: 0 }, error: null }) };
    await expect(getMyMentorOfferQuote(client as never, "actor", "offer")).rejects.toThrow("offer_quote_unavailable");
  });
  it("submits the order and declaration in one RPC with a caller-owned request ID", async () => {
    const rpc = vi.fn(async () => ({ data: { order_id: "order-id", claim_id: "claim-id" }, error: null }));
    expect(await submitManualMentorPayment({ rpc } as never, input)).toEqual({ orderId: "order-id", claimId: "claim-id" });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("submit_manual_mentor_payment", {
      p_offer_id: "offer-id", p_payment_method_id: "method-id", p_buyer_note: "转账编号 94217", p_request_id: input.requestId, p_expected_quote: input.expectedQuote,
    });
  });
  it("retains the identical request ID when a lost response is retried", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: null, error: { message: "fetch failed", code: "" } }).mockResolvedValueOnce({ data: { order_id: "same-order", claim_id: "same-claim" }, error: null });
    await expect(submitManualMentorPayment({ rpc } as never, input)).rejects.toMatchObject({ definite: false });
    expect(await submitManualMentorPayment({ rpc } as never, input)).toEqual({ orderId: "same-order", claimId: "same-claim" });
    expect(rpc.mock.calls[0][1]).toEqual(rpc.mock.calls[1][1]);
  });
  it.each(["mentor_unavailable", "checkout_pending_exists", "account_ineligible"])("distinguishes rolled-back %s from an unknown response", async (message) => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: "P0001", message } }));
    await expect(submitManualMentorPayment({ rpc } as never, input)).rejects.toMatchObject({ definite: true });
    expect(isDefiniteMentorCheckoutFailure(new Error(message))).toBe(true);
  });
  it("does not treat an incomplete successful response as proof of no write", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    await expect(submitManualMentorPayment({ rpc } as never, input)).rejects.toMatchObject({ definite: false });
  });
  it("resumes the existing order rather than creating a replacement", async () => {
    const rpc = vi.fn(async () => ({ data: "claim", error: null }));
    await resumeManualMentorPayment({ rpc } as never, "original-order", " note ");
    expect(rpc).toHaveBeenCalledExactlyOnceWith("submit_mentor_payment_claim", { p_order_id: "original-order", p_buyer_note: "note" });
  });
  it("includes explicit unpaid confirmation when cancelling an unclaimed order", async () => {
    const rpc = vi.fn(async () => ({ data: "original-order", error: null }));
    await cancelUnsubmittedMentorOrder({ rpc } as never, "original-order", true);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("cancel_unsubmitted_mentor_order", { p_order_id: "original-order", p_confirm_unpaid: true });
  });
});
