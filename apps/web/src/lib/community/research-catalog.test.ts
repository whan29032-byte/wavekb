import { describe, expect, it } from "vitest";
import { BOARD_SLUGS } from "@wavekb/domain";
import { compileStructuredPost, parseEditableStructuredPost, parseStructuredPost, type StructuredPost } from "./research-catalog";

describe("professional post compiler", () => {
  it("preserves the legacy case-analysis structure", () => {
    const body = compileStructuredPost({
      market: "crypto", instrument: "BTC", timeframe: "4小时", pattern: "impulse", position: "浪3", direction: "up",
      thesis: "主升段候选", evidence: "浪2未越浪1起点", invalidation: "跌破结构起点", question: "浪3是否延长？",
      primaryCount: "当前处于浪3", alternateCount: "复杂浪B", confirmation: "突破前高", application: "", notes: "观察成交量",
    }, "case_submission");
    expect(body).toContain("【分析对象】\n品种：BTC　市场：加密资产　周期：4小时　浪型：普通推动浪　当前位置：浪3　方向：上涨");
    expect(body).toContain("【首选计数】\n当前处于浪3");
    expect(body).toContain("【失效条件】\n跌破结构起点");
  });

  it("round-trips professional fields so an edit does not erase them", () => {
    const body = compileStructuredPost({
      market: "crypto", instrument: "BINANCE:BTCUSDT", timeframe: "4小时", pattern: "impulse", position: "浪3", direction: "up",
      thesis: "等待同级别确认", evidence: "硬规则先淘汰", invalidation: "跌破起点", question: "是否延长？",
      primaryCount: "", alternateCount: "", confirmation: "", application: "控制仓位", notes: "补充观察成交量",
    }, "idea_sharing");

    expect(parseStructuredPost(body)).toEqual({
      market: "crypto", instrument: "BINANCE:BTCUSDT", timeframe: "4小时", pattern: "impulse", position: "浪3", direction: "up",
      thesis: "等待同级别确认", evidence: "硬规则先淘汰", invalidation: "跌破起点", question: "是否延长？",
      primaryCount: "", alternateCount: "", confirmation: "", application: "控制仓位", notes: "补充观察成交量",
    });
  });

  it("does not mistake ordinary prose for a professional post", () => {
    expect(parseStructuredPost("普通正文，即使很长也应继续使用简易发布模式。")).toBeNull();
  });
});

describe("lossless professional post editing", () => {
  const base: StructuredPost = {
    market: "precious_metals", instrument: "XAUUSD", timeframe: "日线", pattern: "impulse", position: "浪3", direction: "up",
    thesis: "等待同级别确认", evidence: "先检查硬规则", invalidation: "跌破起点", question: "是否延长？",
    primaryCount: "当前处于浪3", alternateCount: "复杂浪B", confirmation: "突破前高", application: "控制仓位", notes: "",
  };

  it.each(BOARD_SLUGS)("retains canonical %s posts with empty supplementary notes", (board) => {
    const body = compileStructuredPost(base, board);
    const parsed = parseEditableStructuredPost(`  ${body}\n`, board);
    expect(parsed).not.toBeNull();
    expect(parsed?.notes).toBe("");
    expect(compileStructuredPost(parsed!, board)).toBe(body);
  });

  it.each([
    "开场说明。\n\n【核心观点】\n当前判断。\n\n【补充说明】\n已有备注。",
    "【分析对象】\n品种：XAUUSD　市场：贵金属　周期：日线\n\n【核心观点】\n当前判断。\n\n【自定义观察】\n必须保留的观察。\n\n【补充说明】\n已有备注。",
    "【分析对象】\n品种：XAUUSD　市场：贵金属　周期：日线\n\n【核心观点】\n首段判断。\n\n【核心观点】\n第二段判断。\n\n【补充说明】\n已有备注。",
  ])("keeps ambiguous or partially recognized text in the raw editor", (body) => {
    expect(parseStructuredPost(body)).not.toBeNull();
    expect(parseEditableStructuredPost(body, "idea_sharing")).toBeNull();
  });

  it("does not erase headings entered inside a professional field", () => {
    const body = compileStructuredPost({ ...base, thesis: "首段判断。\n\n【核心观点】\n第二段判断。", notes: "已有备注。" }, "idea_sharing");
    expect(parseEditableStructuredPost(body, "idea_sharing")).toBeNull();
  });

  it("does not reinterpret another board's professional sections", () => {
    const body = compileStructuredPost(base, "case_submission");
    expect(parseEditableStructuredPost(body, "idea_sharing")).toBeNull();
  });
});
