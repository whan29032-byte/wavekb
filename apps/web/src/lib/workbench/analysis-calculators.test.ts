import { describe, expect, it } from "vitest";
import { calculateMaxDrawdown, calculateRisk, evaluateImpulse } from "./analysis-calculators";

describe("workbench analysis calculators", () => {
  it("does not turn trailing separators into a zero price", () => {
    expect(calculateMaxDrawdown(" 100,110, ", false, false)).toMatchObject({ ok: true, max_drawdown: 0 });
  });

  it.each(["100,oops,110", "100,Infinity,110", "100,-1,110"])("rejects malformed or negative series: %s", (raw) => {
    expect(calculateMaxDrawdown(raw, false, false).ok).toBe(false);
  });

  it("retains an explicitly entered zero equity point", () => {
    expect(calculateMaxDrawdown("100,0", false, false)).toMatchObject({ ok: true, max_drawdown_percent: 100 });
  });

  it("reports the largest percentage drawdown, not the percentage at the largest cash loss", () => {
    expect(calculateMaxDrawdown("100,50,1000,800", false, false)).toMatchObject({ max_drawdown: 200, max_drawdown_percent: 50 });
  });

  it("rejects incomplete rule inputs rather than eliminating a structure", () => {
    expect(evaluateImpulse({ w1_start: NaN }, "up").status).toBe("invalid_input");
  });

  it("rejects pivots whose legs contradict the selected direction", () => {
    expect(evaluateImpulse({ w1_start: 100, w1_end: 90, w2_end: 110, w3_end: 160, w4_end: 170, w5_end: 175 }, "up").status).toBe("invalid_input");
  });

  it("accepts mirrored downward pivots", () => {
    expect(evaluateImpulse({ w1_start: 175, w1_end: 155, w2_end: 165, w3_end: 115, w4_end: 135, w5_end: 100 }, "down").status).toBe("valid");
  });
  it("measures drawdown without treating it as structural proof", () => {
    expect(calculateMaxDrawdown("100,120,90,130", false, false)).toMatchObject({ ok: true, max_drawdown: 30, max_drawdown_percent: 25, classification: "仅记录统计回撤，不能据此宣布上涨结束" });
  });

  it("calculates position size and reward risk", () => {
    expect(calculateRisk({ equity: 100000, risk_percent: 1, entry: 100, stop: 95, target: 115, contract_multiplier: 1, lot_size: 1, fees: 0 })).toMatchObject({ ok: true, max_loss: 1000, max_position: 200, reward_risk: 3 });
  });

  it("eliminates an impulse that violates a hard rule", () => {
    expect(evaluateImpulse({ w1_start: 100, w1_end: 120, w2_end: 90, w3_end: 160, w4_end: 140, w5_end: 175 }, "up").status).toBe("eliminated");
  });
});
