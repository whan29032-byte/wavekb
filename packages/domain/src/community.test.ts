import { describe, expect, it } from "vitest";
import { parseExternalReference, splitEntryTags, splitProfileTags, validateMemberProfile, validatePost, validatePrivateEntry, validateProfileImage } from "./community";

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

describe("private workbench record validation", () => {
  it("normalizes a complete private record", () => {
    const result = validatePrivateEntry({
      kind: "review",
      title: "  BTC 主升段复盘  ",
      body: "保留可以复查的判断。",
      instrument: "BTCUSDT",
      market: "加密",
      timeframe: "4小时",
      tags: splitEntryTags("主升、纪律，主升"),
      knowledgeIds: ["unit-rule-impulse"],
      reviewData: { editor_mode: "professional", execution_score: 4 },
    });
    expect(result.ok).toBe(true);
    expect(result.value.title).toBe("BTC 主升段复盘");
    expect(result.value.tags).toEqual(["主升", "纪律"]);
  });

  it("rejects an invalid record kind and empty title", () => {
    const result = validatePrivateEntry({ kind: "public", title: "", body: "", instrument: "", market: "", timeframe: "", tags: [], knowledgeIds: [], reviewData: {} });
    expect(result.ok).toBe(false);
    expect(result.fields.kind).toBeTruthy();
    expect(result.fields.title).toBeTruthy();
  });
});
