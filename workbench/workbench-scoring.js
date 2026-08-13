(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ElliottWorkbenchScoring = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function clamp(value, maximum) {
    return Math.min(maximum, Math.max(0, Number(value) || 0));
  }

  function bandFor(score) {
    if (score === null) return "已淘汰";
    if (score >= 75) return "高置信";
    if (score >= 55) return "中等置信";
    if (score >= 35) return "低置信";
    return "证据不足";
  }

  function scoreScenario(input) {
    if (input.rule_status === "eliminated") {
      return {
        structural_score: null,
        trading_suitability: null,
        band: "已淘汰",
        evidence: [],
        disclaimer: "硬规则违规，不能以指南分数挽救；本结果不是历史胜率。"
      };
    }
    const evidence = [
      {key: "structure", label: "结构完整性", score: clamp(input.structure, 40), maximum: 40},
      {key: "degree_context", label: "上下浪级一致性", score: clamp(input.degree_context, 20), maximum: 20},
      {key: "ratios_time", label: "比例与时间指南", score: clamp(input.ratios_time, 15), maximum: 15},
      {key: "supporting_guides", label: "通道、量能与个性", score: clamp(input.supporting_guides, 15), maximum: 15}
    ];
    const structural = evidence.reduce((sum, item) => sum + item.score, 0);
    const macro = clamp(input.macro && input.macro.score, 10);
    return {
      structural_score: structural,
      trading_suitability: structural + macro,
      band: bandFor(structural),
      evidence: [...evidence, {
        key: "macro",
        label: "市场环境（只影响交易适宜度）",
        score: macro,
        maximum: 10
      }],
      disclaimer: "置信评分用于比较当前证据，不是历史胜率或客观概率。"
    };
  }

  return {scoreScenario, bandFor};
});
