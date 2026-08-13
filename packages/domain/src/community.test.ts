import { describe, expect, it } from "vitest";
import { parseExternalReference, validatePost } from "./community";

describe("community post validation", () => {
  it("accepts a complete public post", () => {
    const result = validatePost({
      board: "idea_sharing",
      title: "推动浪内部的延长判断",
      body: "这里是一段足够长的正文，用来解释规则依据、失效条件和实际应用。",
      externalUrl: "https://www.youtube.com/watch?v=abc123",
      mode: "simple",
    });
    expect(result.ok).toBe(true);
    expect(result.value.externalKind).toBe("youtube");
  });

  it("allows short copy only when the simple post includes an image", () => {
    expect(validatePost({
      board: "case_submission",
      title: "附图案例判断",
      body: "看图",
      imageCount: 1,
      mode: "simple",
    }).ok).toBe(true);
  });

  it("rejects unsupported external links", () => {
    expect(parseExternalReference("https://example.com/post")).toMatchObject({ ok: false });
  });
});
