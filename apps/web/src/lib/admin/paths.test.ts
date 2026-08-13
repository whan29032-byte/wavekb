import { describe, expect, it } from "vitest";
import { isAllowedAdminPath } from "./paths";

describe("admin proxy path allowlist", () => {
  it("allows only the explicit read endpoints", () => {
    expect(isAllowedAdminPath("users", "GET")).toBe(true);
    expect(isAllowedAdminPath("users/summary", "GET")).toBe(true);
    expect(isAllowedAdminPath("moderation-audit", "GET")).toBe(true);
    expect(isAllowedAdminPath("users/abc", "GET")).toBe(false);
    expect(isAllowedAdminPath("../health", "GET")).toBe(false);
  });

  it("requires a UUID and an approved mutation action", () => {
    const userId = "79facf84-b98c-44f6-a223-b9ee4bc31f08";
    expect(isAllowedAdminPath(`users/${userId}/status`, "POST")).toBe(true);
    expect(isAllowedAdminPath(`users/${userId}/uid`, "POST")).toBe(true);
    expect(isAllowedAdminPath(`users/${userId}/delete`, "POST")).toBe(false);
    expect(isAllowedAdminPath("users/not-a-uuid/status", "POST")).toBe(false);
  });
});
