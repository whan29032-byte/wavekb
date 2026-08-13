import { describe, expect, it } from "vitest";
import { mentorOrderTransitions } from "./mentors-client-repository";

describe("mentor order transitions", () => {
  it("allows payment to activate rights and refund to revoke them", () => {
    expect(mentorOrderTransitions("pending")).toContain("paid");
    expect(mentorOrderTransitions("paid")).toContain("refunded");
  });

  it("does not reopen refunded orders or refund unpaid orders", () => {
    expect(mentorOrderTransitions("refunded")).toEqual(["refunded"]);
    expect(mentorOrderTransitions("pending")).not.toContain("refunded");
  });
});
