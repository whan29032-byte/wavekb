import { describe, expect, it } from "vitest";
import { adminMutationBodyLimit, isAllowedAdminBodyLength, isAllowedAdminPath } from "./paths";

describe("admin proxy path allowlist", () => {
  it("allows only the explicit read endpoints", () => {
    expect(isAllowedAdminPath("users", "GET")).toBe(true);
    expect(isAllowedAdminPath("users/summary", "GET")).toBe(true);
    expect(isAllowedAdminPath("moderation-audit", "GET")).toBe(true);
    expect(isAllowedAdminPath("directory", "GET")).toBe(true);
    expect(isAllowedAdminPath("dashboard", "GET")).toBe(true);
    expect(isAllowedAdminPath("providers", "GET")).toBe(true);
    expect(isAllowedAdminPath("users/abc", "GET")).toBe(false);
    expect(isAllowedAdminPath("../health", "GET")).toBe(false);
  });

  it("requires a UUID and an approved mutation action", () => {
    const userId = "79facf84-b98c-44f6-a223-b9ee4bc31f08";
    expect(isAllowedAdminPath(`users/${userId}/status`, "POST")).toBe(true);
    expect(isAllowedAdminPath(`users/${userId}/uid`, "POST")).toBe(true);
    expect(isAllowedAdminPath(`users/${userId}/delete`, "POST")).toBe(false);
    expect(isAllowedAdminPath("users/not-a-uuid/status", "POST")).toBe(false);
    expect(isAllowedAdminPath("directory", "POST")).toBe(true);
    expect(isAllowedAdminPath(`directory/${userId}`, "POST")).toBe(true);
    expect(isAllowedAdminPath(`directory/${userId}/delete`, "POST")).toBe(true);
    expect(isAllowedAdminPath("directory/not-a-uuid/delete", "POST")).toBe(false);
    expect(isAllowedAdminPath("providers", "POST")).toBe(true);
  });

  it("caps mutation payloads before proxying them", () => {
    expect(isAllowedAdminBodyLength(0)).toBe(true);
    expect(isAllowedAdminBodyLength(adminMutationBodyLimit)).toBe(true);
    expect(isAllowedAdminBodyLength(adminMutationBodyLimit + 1)).toBe(false);
    expect(isAllowedAdminBodyLength(Number.NaN)).toBe(false);
  });
});
