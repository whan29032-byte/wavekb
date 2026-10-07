import { describe, expect, it } from "vitest";
import { canRedeemReward, formatLotteryProbability, formatMentorPrice, formatRewardPoints, parseExternalReference, parseExternalReferences, remainingMentorQuota, rewardActionLabel, splitEntryTags, splitProfileTags, validateMemberProfile, validateMentorQuestion, validatePost, validatePrivateEntry, validateProfileImage } from "./community";

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

  it.each(["simple", "professional"] as const)("requires the database minimum body length in %s mode, including attached images", (mode) => {
    const input = {
      board: "case_submission",
      title: "附图案例判断",
      imageCount: 1,
      mode,
    };
    expect(validatePost({ ...input, body: "看图" })).toMatchObject({ ok: false, fields: { body: "正文需要 20-20000 个字符。" } });
    expect(validatePost({ ...input, body: "字".repeat(19) }).ok).toBe(false);
    expect(validatePost({ ...input, body: "字".repeat(20) }).ok).toBe(true);
  });

  it("counts title and body characters like PostgreSQL, including supplementary Unicode characters", () => {
    const input = { board: "idea_sharing", title: "😀😀研究稿", body: "😀".repeat(20) };
    expect(validatePost(input).ok).toBe(true);
    expect(validatePost({ ...input, title: "😀😀字" })).toMatchObject({ ok: false, fields: { title: "标题需要 5-120 个字符。" } });
    expect(validatePost({ ...input, body: "😀".repeat(19) })).toMatchObject({ ok: false, fields: { body: "正文需要 20-20000 个字符。" } });
    expect(validatePost({ ...input, title: "😀".repeat(120) }).ok).toBe(true);
    expect(validatePost({ ...input, title: "😀".repeat(121) }).ok).toBe(false);
  });

  it.each([
    "https://youtube.com/watch?v=abc12345",
    "https://www.youtube.com/watch?v=abc12345&t=1#chart",
    "https://m.youtube.com/watch?feature=share&v=abc12345&t=1",
    "https://youtube.com/shorts/abc12345",
    "https://www.youtube.com/embed/abc12345/",
    "https://youtu.be/abc12345?si=share",
    "https://youtube-nocookie.com/embed/abc12345",
    "https://www.youtube-nocookie.com/embed/abc12345/",
  ])("accepts database-supported YouTube links: %s", (url) => {
    expect(parseExternalReference(url)).toMatchObject({ ok: true, kind: "youtube", url });
  });

  it.each([
    "https://x.com/wavekb/status/123",
    "https://www.x.com/wavekb/status/123/?s=20#chart",
    "https://mobile.x.com/wavekb/status/123",
    "https://twitter.com/wavekb/status/123",
    "https://www.twitter.com/wavekb/status/123",
    "https://mobile.twitter.com/wavekb/status/123",
  ])("accepts database-supported X links: %s", (url) => {
    expect(parseExternalReference(url)).toMatchObject({ ok: true, kind: "x", url });
  });

  it.each([
    "https://m.youtube.com/shorts/abc12345",
    "https://m.youtube.com/embed/abc12345",
    "https://youtube-nocookie.com/watch?v=abc12345",
    "https://youtube-nocookie.com/shorts/abc12345",
    "https://www.youtu.be/abc12345",
    "https://www.m.youtube.com/watch?v=abc12345",
    "https://x.com:8443/wavekb/status/123",
    "https://username:password@x.com/wavekb/status/123",
    "https://youtube.com/watch?v=%61bc12345",
  ])("rejects link formats rejected by the database: %s", (url) => {
    expect(parseExternalReference(url)).toMatchObject({ ok: false });
  });

  it("enforces the database limit on the normalized media URL", () => {
    const prefix = "https://x.com/wavekb/status/123?note=";
    const atLimit = prefix + "a".repeat(1000 - prefix.length);
    expect(parseExternalReference(atLimit)).toMatchObject({ ok: true, url: atLimit });
    expect(parseExternalReference(`${atLimit}a`)).toMatchObject({ ok: false, error: "媒体引用链接不能超过 1000 个字符。" });
    const expanded = prefix + "中".repeat(110);
    expect(expanded.length).toBeLessThan(1000);
    expect(new URL(expanded).toString().length).toBeGreaterThan(1000);
    expect(parseExternalReference(expanded)).toMatchObject({ ok: false, error: "媒体引用链接不能超过 1000 个字符。" });
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
  it("formats lottery basis points without losing precision", () => {
    expect(formatLotteryProbability(1)).toBe("0.01%");
    expect(formatLotteryProbability(250)).toBe("2.50%");
    expect(formatLotteryProbability(10000)).toBe("100.00%");
  });

  it("formats point balances and known ledger actions", () => {
    expect(formatRewardPoints(12340)).toBe("12,340 积分");
    expect(rewardActionLabel("review_saved")).toBe("完成复盘");
    expect(rewardActionLabel("lottery_entry")).toBe("抽奖参与");
    expect(rewardActionLabel("lottery_prize")).toBe("抽奖奖励");
    expect(rewardActionLabel("future_action")).toBe("积分变动");
  });

  it("blocks sold out and unaffordable products", () => {
    expect(canRedeemReward({ price_points: 100, stock: 0 }, 1000)).toMatchObject({ ok: false, reason: "sold_out" });
    expect(canRedeemReward({ price_points: 100, stock: -1 }, 99)).toMatchObject({ ok: false, reason: "insufficient" });
    expect(canRedeemReward({ price_points: 100, stock: 2 }, 100)).toMatchObject({ ok: true });
  });
});
