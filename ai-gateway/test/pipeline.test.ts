import assert from "node:assert/strict";
import test from "node:test";
import { finalizeResult, validateAnalysisResult } from "../src/pipeline/validate-result.ts";
import { applyRuleGate, scenarioInputsFromAnalysis } from "../src/pipeline/rule-gate.ts";

const validResult = {
  instrument: "BTCUSDT",
  timeframe: "4h",
  analysis_level: "4小时",
  parent_trend: "up",
  current_pattern: "impulse",
  current_subwave: "3",
  valid_scenarios: [{
    key: "primary",
    pattern: "impulse",
    conditions: ["守住起点"],
    invalidations: ["跌破起点"],
    confidence: 0.7,
  }],
  eliminated_scenarios: [],
  knowledge_citations: ["ewp-rule-impulse-core"],
  unknown_fields: [],
};

test("server overwrites model risk numbers with deterministic result", () => {
  const output = finalizeResult(
    { ...validResult, risk: { reward_risk: 99, max_loss: 999 } },
    { reward_risk: 3.2, max_loss: 100 },
    new Set(["ewp-rule-impulse-core"]),
  );
  assert.deepEqual(output.risk, { reward_risk: 3.2, max_loss: 100 });
});

test("invalid knowledge citation rejects result", () => {
  assert.throws(
    () => validateAnalysisResult(
      { ...validResult, knowledge_citations: ["missing-id"] },
      new Set(["ewp-rule-impulse-core"]),
    ),
    /citation/,
  );
});

test("model-supplied expanded citation metadata is rejected", () => {
  assert.throws(
    () => validateAnalysisResult(
      {
        ...validResult,
        citations: [{
          knowledge_id: "ewp-rule-impulse-core",
          title: "forged title",
          pages: [999],
          href: "https://attacker.example",
          snippet: "forged snippet",
        }],
      },
      new Set(["ewp-rule-impulse-core"]),
    ),
    /analysis result schema/,
  );
});

test("scenario arrays reject malformed nested conditions and invalidations", () => {
  assert.throws(
    () => validateAnalysisResult(
      {
        ...validResult,
        valid_scenarios: [{
          ...validResult.valid_scenarios[0],
          conditions: "not-an-array",
          invalidations: [17],
        }],
      },
      new Set(["ewp-rule-impulse-core"]),
    ),
    /scenario/,
  );
});

test("hard-rule violation moves a scenario out of the valid list", () => {
  const output = applyRuleGate(validResult, {
    primary: {
      pattern: "impulse",
      direction: "up",
      waves: {
        w1: { start: 100, end: 120 },
        w2: { start: 120, end: 90 },
        w3: { start: 90, end: 140 },
        w4: { start: 140, end: 125 },
        w5: { start: 125, end: 150 },
      },
    },
  });
  assert.equal(output.valid_scenarios.length, 0);
  assert.equal(output.eliminated_scenarios[0]?.key, "primary");
  assert.equal(
    output.eliminated_scenarios[0]?.violations?.[0]?.rule_id,
    "ewp-rule-impulse-core",
  );
});

test("persisted step 6 pivots drive the rule gate even when step 5 is misleading", () => {
  const output = applyRuleGate(validResult, scenarioInputsFromAnalysis({
    step_data: {
      "5": {
        pattern: "impulse",
        direction: "up",
        w1_start: 100,
        w1_end: 120,
        w2_end: 110,
        w3_end: 160,
        w4_end: 140,
        w5_end: 175,
      },
      "6": {
        pattern: "impulse",
        direction: "up",
        w1_start: 100,
        w1_end: 120,
        w2_end: 90,
        w3_end: 140,
        w4_end: 125,
        w5_end: 150,
      },
    },
  }));

  assert.equal(output.valid_scenarios.length, 0);
  assert.equal(output.eliminated_scenarios[0]?.key, "primary");
  assert.equal(output.eliminated_scenarios[0]?.violations?.[0]?.rule_id, "ewp-rule-impulse-core");
});
