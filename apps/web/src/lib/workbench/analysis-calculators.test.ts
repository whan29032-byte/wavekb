import { describe, expect, it } from "vitest";
import { calculateMaxDrawdown, calculateRisk, evaluateImpulse } from "./analysis-calculators";

describe("workbench analysis calculators", () => {
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
