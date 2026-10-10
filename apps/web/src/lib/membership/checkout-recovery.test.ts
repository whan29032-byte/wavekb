import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMembershipAttempt, membershipAttemptKey, readMembershipAttempt, safeMembershipCheckoutUrl, writeMembershipAttempt } from "./checkout-recovery";
import { membershipPreviewActor, membershipPreviewPlan, membershipPreviewRequest } from "@/components/membership-commerce.fixtures";
import { membershipQuote } from "./commerce-types";
import { installBrowserStorage } from "@/test/browser-storage";
const attempt = { ownerId: membershipPreviewActor, requestId: membershipPreviewRequest, expectedQuote: membershipQuote(membershipPreviewPlan, membershipPreviewPlan.prices[0]) };
beforeEach(installBrowserStorage); afterEach(() => vi.restoreAllMocks());
describe("membership checkout recovery", () => {
  it("retains the original frozen quote and ID across reloads", () => { writeMembershipAttempt(attempt); expect(readMembershipAttempt(membershipPreviewActor)).toEqual(attempt); });
  it("does not overwrite or delete another tab's unresolved request", () => { writeMembershipAttempt(attempt); expect(() => writeMembershipAttempt({ ...attempt, requestId: "00000000-0000-4000-8000-000000000009" })).toThrow(); expect(readMembershipAttempt(membershipPreviewActor)).toEqual(attempt); expect(() => clearMembershipAttempt({ ...attempt, requestId: "00000000-0000-4000-8000-000000000009" })).toThrow(); });
  it("fails closed for disabled storage", () => { vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new DOMException("denied", "SecurityError"); }); expect(() => writeMembershipAttempt(attempt)).toThrow(); });
  it.each(["{", "null", JSON.stringify({ ...attempt, ownerId: "00000000-0000-4000-8000-000000000010" }), JSON.stringify({ ...attempt, expectedQuote: { ...attempt.expectedQuote, amount_minor: 0 } })])("retains corrupt or wrong-owner checkpoint for manual verification (%s)", (raw) => { window.localStorage.setItem(membershipAttemptKey(membershipPreviewActor), raw); expect(() => readMembershipAttempt(membershipPreviewActor)).toThrow(); expect(window.localStorage.getItem(membershipAttemptKey(membershipPreviewActor))).toBe(raw); });
  it.each(["http://checkout.stripe.com/pay", "https://checkout.stripe.com.evil.test/pay", "https://evil.test/?checkout.stripe.com", "https://user@checkout.stripe.com/pay", "https://checkout.stripe.com:444/pay", "//checkout.stripe.com/pay", "javascript:alert(1)"])("rejects untrusted checkout URL %s", (url) => { expect(() => safeMembershipCheckoutUrl(url)).toThrow(); });
  it("accepts only the exact HTTPS provider origin", () => { expect(safeMembershipCheckoutUrl("https://checkout.stripe.com/c/pay/cs_test_preview")).toBe("https://checkout.stripe.com/c/pay/cs_test_preview"); });
});
