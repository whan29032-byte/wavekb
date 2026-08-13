import { describe, expect, it } from "vitest";
import { isAllowedAiBodyLength, isAllowedAiPath } from "./paths";

const id = "123e4567-e89b-42d3-a456-426614174000";

describe("AI gateway allowlist", () => {
  it("allows only user connection and analysis job endpoints", () => {
    expect(isAllowedAiPath("user/ai-connections", "GET")).toBe(true);
    expect(isAllowedAiPath(`user/ai-connections/${id}/rotate-key`, "POST")).toBe(true);
    expect(isAllowedAiPath(`analyses/${id}/ai-run`, "POST")).toBe(true);
    expect(isAllowedAiPath("admin/providers", "GET")).toBe(false);
    expect(isAllowedAiPath("user/ai-connections/not-a-uuid/default", "POST")).toBe(false);
  });

  it("caps request bodies", () => {
    expect(isAllowedAiBodyLength(64 * 1024)).toBe(true);
    expect(isAllowedAiBodyLength(64 * 1024 + 1)).toBe(false);
  });
});
