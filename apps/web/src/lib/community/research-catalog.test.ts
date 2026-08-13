import { describe, expect, it } from "vitest";
import { compileStructuredPost } from "./research-catalog";

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
});
