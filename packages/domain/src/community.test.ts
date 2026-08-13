import { describe, expect, it } from "vitest";
import { parseExternalReference, splitProfileTags, validateMemberProfile, validatePost, validateProfileImage } from "./community";

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

describe("member profile validation", () => {
  it("normalizes unique profile tags", () => {
    expect(splitProfileTags("加密、黄金, 加密，股指")).toEqual(["加密", "黄金", "股指"]);
  });

  it("accepts a complete editable profile", () => {
    expect(validateMemberProfile({
      displayName: "浪型记录者",
      bio: "只保留可以复查的判断。",
      markets: ["加密", "黄金"],
      timeframes: ["日线", "4小时"],
      coverStyle: "wave-blue",
    })).toMatchObject({ ok: true, value: { coverStyle: "wave-blue" } });
  });

  it("rejects unsafe profile images", () => {
    expect(validateProfileImage({ type: "image/svg+xml", size: 200 }, "头像")).toBe("头像只支持 JPG、PNG 或 WebP。");
  });
});
