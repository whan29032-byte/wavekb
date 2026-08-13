(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ElliottWaveRuleEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PAGE_IDS = Object.freeze({
    impulse: "core-impulse",
    diagonal: "core-diagonal",
    zigzag: "core-zigzag",
    flat: "core-flat",
    triangle: "core-triangle",
    combination: "core-combination"
  });
  const RULE_IDS = Object.freeze({
    impulse: "ewp-rule-impulse-core",
    diagonal: "ewp-rule-diagonal",
    zigzag: "ewp-rule-zigzag",
    flat: "ewp-rule-flat",
    triangle: "ewp-rule-triangle",
    combination: "ewp-rule-combination"
  });

  function check(pattern, key, passed, message) {
    return {
      key,
      status: passed === null ? "unknown" : passed ? "passed" : "failed",
      rule_id: RULE_IDS[pattern],
      knowledge_page_id: PAGE_IDS[pattern],
      message
    };
  }

  function impulseChecks(scenario) {
    const waves = scenario.waves || {};
    const {w1, w2, w3, w4, w5} = waves;
    if (![w1, w2, w3, w4, w5].every(Boolean)) {
      return [check("impulse", "complete", null, "需要完整浪1至浪5数据。")];
    }
    const up = scenario.direction !== "down";
    const w2Valid = up ? w2.end >= w1.start : w2.end <= w1.start;
    const w3Beyond = up ? w3.end > w1.end : w3.end < w1.end;
    const length1 = Math.abs(w1.end - w1.start);
    const length3 = Math.abs(w3.end - w2.end);
    const length5 = Math.abs(w5.end - w4.end);
    const w3NotShortest = !(length3 < length1 && length3 < length5);
    const noOverlap = up ? w4.end >= w1.end : w4.end <= w1.end;
    return [
      check("impulse", "wave2_origin", w2Valid, "浪2不得越过浪1起点。"),
      check("impulse", "wave3_beyond_wave1", w3Beyond, "浪3必须越过浪1终点。"),
      check("impulse", "wave3_not_shortest", w3NotShortest, "浪3不得是浪1、3、5中最短者。"),
      check("impulse", "wave4_no_overlap", noOverlap, "普通推动浪的浪4不得进入浪1价格区域。")
    ];
  }

  function diagonalChecks(scenario) {
    const checks = [];
    const allowed = scenario.diagonal_type === "ending"
      ? new Set(["wave5", "C"])
      : new Set(["wave1", "A"]);
    checks.push(check(
      "diagonal",
      "position",
      allowed.has(scenario.position),
      "引导斜纹只允许在浪1或锯齿A；终结斜纹只允许在浪5或C。"
    ));
    const waves = scenario.waves || {};
    const {w1, w2, w3, w4} = waves;
    if (![w1, w2, w3, w4].every(Boolean)) {
      checks.push(check("diagonal", "complete", null, "需要完整浪1至浪4数据。"));
      return checks;
    }
    const up = scenario.direction !== "down";
    checks.push(
      check("diagonal", "wave2_origin", up ? w2.end >= w1.start : w2.end <= w1.start, "浪2不得越过浪1起点。"),
      check("diagonal", "wave3_beyond_wave1", up ? w3.end > w1.end : w3.end < w1.end, "浪3必须越过浪1终点。"),
      check("diagonal", "wave4_beyond_wave2", up ? w4.end >= w2.end : w4.end <= w2.end, "浪4不得越过浪2终点。")
    );
    return checks;
  }

  function zigzagChecks(scenario) {
    const legs = scenario.legs || [];
    const structureValid = legs.length
      ? legs.join("-") === "5-3-5"
      : scenario.a && scenario.b && scenario.c
        ? ["impulse", "diagonal"].includes(scenario.a.structure)
          && ["impulse", "diagonal"].includes(scenario.c.structure)
        : null;
    let bValid = null;
    if (scenario.a && scenario.b) {
      const upA = scenario.a.end > scenario.a.start;
      bValid = upA
        ? scenario.b.end <= scenario.a.start
        : scenario.b.end >= scenario.a.start;
    }
    return [
      check("zigzag", "structure", structureValid, "锯齿形按5-3-5展开，A和C为允许的驱动结构。"),
      check("zigzag", "b_origin", bValid, "B浪不得越过A浪起点。")
    ];
  }

  function flatChecks(scenario) {
    const {a, b, c} = scenario;
    if (!a || !b || !c) {
      return [check("flat", "complete", null, "需要A、B、C结构数据。")];
    }
    const span = Math.abs(a.end - a.start);
    const retrace = span ? Math.abs(b.end - a.end) / span : 0;
    return [
      check("flat", "b_retracement", retrace >= 0.9, "平台形B浪至少回撤A浪的90%。"),
      check("flat", "c_structure", ["impulse", "diagonal"].includes(c.structure), "平台形C浪必须是推动或斜纹结构。")
    ];
  }

  function triangleChecks(scenario) {
    const legs = scenario.legs || [];
    const allowedPositions = new Set(["wave4", "B", "X", "combination_last"]);
    const zigzagLike = legs.filter(leg => ["zigzag", "zigzag_combination"].includes(leg)).length;
    return [
      check("triangle", "five_legs", legs.length === 5, "三角形必须包含A至E五个子浪。"),
      check("triangle", "zigzag_legs", legs.length ? zigzagLike >= 4 : null, "至少四个子浪应为锯齿或锯齿联合。"),
      check("triangle", "position", allowedPositions.has(scenario.position), "三角形只能出现在大一级模式规定的末段位置。")
    ];
  }

  function combinationChecks(scenario) {
    const components = scenario.components || [];
    const triangleIndex = components.indexOf("triangle");
    return [
      check("combination", "component_count", components.length >= 2 && components.length <= 3, "联合形由两个或三个调整模式构成。"),
      check("combination", "triangle_last", triangleIndex < 0 || triangleIndex === components.length - 1, "三角形只能作为联合形最后一个作用模式。")
    ];
  }

  const REGISTRY = Object.freeze({
    impulse: impulseChecks,
    diagonal: diagonalChecks,
    zigzag: zigzagChecks,
    flat: flatChecks,
    triangle: triangleChecks,
    combination: combinationChecks
  });

  function evaluateScenario(scenario) {
    const evaluator = REGISTRY[scenario.pattern];
    if (!evaluator) {
      return {
        status: "unknown",
        violations: [],
        checks: [],
        message: "尚未选择可检查的浪型。"
      };
    }
    const checks = evaluator(scenario);
    const violations = checks.filter(item => item.status === "failed");
    return {
      status: violations.length
        ? "eliminated"
        : checks.some(item => item.status === "unknown")
          ? "unknown"
          : "valid",
      violations,
      checks
    };
  }

  return {REGISTRY, evaluateScenario};
});
