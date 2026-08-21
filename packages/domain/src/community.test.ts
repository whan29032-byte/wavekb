import { describe, expect, it } from "vitest";
import { canRedeemReward, formatMentorPrice, formatRewardPoints, parseExternalReference, parseExternalReferences, remainingMentorQuota, rewardActionLabel, splitEntryTags, splitProfileTags, validateMemberProfile, validateMentorQuestion, validatePost, validatePrivateEntry, validateProfileImage } from "./community";

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
    expect(parseExternalReference("https://youtube.com/")).toMatchObject({ ok: false });
    expect(parseExternalReference("https://x.com/wavekb")).toMatchObject({ ok: false });
    expect(parseExternalReference("https://x.com/wavekb/status/123/extra")).toMatchObject({ ok: false });
    expect(parseExternalReference("https://youtu.be/abc12345/extra")).toMatchObject({ ok: false });
    expect(parseExternalReference("https://youtube.com/shorts/abc12345/extra")).toMatchObject({ ok: false });
  });

  it("normalizes up to five unique YouTube and X media references", () => {
    const result = parseExternalReferences([
      "https://youtu.be/abc12345",
      "https://x.com/wavekb/status/123",
      "https://youtu.be/abc12345",
    ]);
    expect(result).toMatchObject({ ok: true });
    expect(result.references).toEqual([
      { url: "https://youtu.be/abc12345", kind: "youtube", sort_order: 0 },
      { url: "https://x.com/wavekb/status/123", kind: "x", sort_order: 1 },
    ]);
    expect(parseExternalReferences(Array.from({ length: 6 }, (_, index) => `https://x.com/wavekb/status/${index + 1}`))).toMatchObject({ ok: false });
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

describe("mentor tutoring domain rules", () => {
  it("formats USDT prices without treating cents as whole tokens", () => {
    expect(formatMentorPrice(12800, "USDT")).toBe("128 USDT");
    expect(formatMentorPrice(12850, "USDT")).toBe("128.50 USDT");
  });

  it("calculates remaining weekly quota without going below zero", () => {
    expect(remainingMentorQuota({ weekly_question_limit: 3, questions_used: 1 })).toBe(2);
    expect(remainingMentorQuota({ weekly_question_limit: 3, questions_used: 8 })).toBe(0);
  });

  it("validates a concrete tutoring question", () => {
    expect(validateMentorQuestion("  这段三浪的失效位应该放在哪里？  ")).toMatchObject({ ok: true, value: "这段三浪的失效位应该放在哪里？" });
    expect(validateMentorQuestion("太短")).toMatchObject({ ok: false });
  });
});

describe("reward center domain rules", () => {
  it("formats point balances and known ledger actions", () => {
    expect(formatRewardPoints(12340)).toBe("12,340 积分");
    expect(rewardActionLabel("review_saved")).toBe("完成复盘");
    expect(rewardActionLabel("future_action")).toBe("积分变动");
  });

  it("blocks sold out and unaffordable products", () => {
    expect(canRedeemReward({ price_points: 100, stock: 0 }, 1000)).toMatchObject({ ok: false, reason: "sold_out" });
    expect(canRedeemReward({ price_points: 100, stock: -1 }, 99)).toMatchObject({ ok: false, reason: "insufficient" });
    expect(canRedeemReward({ price_points: 100, stock: 2 }, 100)).toMatchObject({ ok: true });
  });
});
