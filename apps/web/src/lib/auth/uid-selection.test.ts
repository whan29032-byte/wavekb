import { describe, expect, it } from "vitest";
import { isUidAction, isValidUid } from "./uid-selection";

describe("UID selection validation", () => {
  it("allows only known gateway operations", () => {
    expect(isUidAction("status")).toBe(true);
    expect(isUidAction("complete")).toBe(true);
    expect(isUidAction("delete-account")).toBe(false);
  });

  it("accepts the public UID range", () => {
    expect(isValidUid(10000)).toBe(true);
    expect(isValidUid("999999")).toBe(true);
    expect(isValidUid(9999)).toBe(false);
    expect(isValidUid("123.4")).toBe(false);
  });
});
