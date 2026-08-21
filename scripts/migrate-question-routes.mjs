import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const unitsPath = path.join(repositoryRoot, "knowledge/units/all.jsonl");
const questionsPath = path.join(repositoryRoot, "knowledge/questions/index.jsonl");
const units = fs.readFileSync(unitsPath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const unitById = new Map(units.map((unit) => [unit.id, unit]));
const questions = fs.readFileSync(questionsPath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));

const ruleTypes = new Set(["rule", "wave_structure", "condition", "definition"]);
const guidelineTypes = new Set(["guideline", "price_ratio", "time_relationship", "wave_personality"]);
const evidenceTypes = new Set(["confirmation_signal", "method", "case_observation", "figure_explanation"]);

for (const question of questions) {
  const allIds = [...new Set([...(question.required_unit_ids || []), ...(question.optional_unit_ids || [])])];
  const byType = (types) => allIds.filter((unitId) => {
    const unit = unitById.get(unitId);
    return types.has(unit?.legacy_type || unit?.type);
  });
  const ruleIds = byType(ruleTypes);
  const guidelineIds = byType(guidelineTypes);
  const evidenceIds = byType(evidenceTypes);
  const invalidationIds = allIds.filter((unitId) => /invalidation|multiple-counts|wait-unclear|theory-vs-trading|count-first/.test(unitId));
  const guidelineRouteIds = guidelineIds.length ? guidelineIds : ["ewp-method-multiple-counts"];
  const evidenceRouteIds = evidenceIds.length ? evidenceIds : ["ewp-method-indicators-assist-count"];
  const invalidationRouteIds = invalidationIds.length ? invalidationIds : ["ewp-method-objective-invalidation"];
  question.reasoning_route = [
    {
      stage: "rule_exclusion",
      unit_ids: ruleIds.length ? ruleIds : question.required_unit_ids.slice(0, 1),
      instruction: "先应用结构定义与硬规则，排除不可能计数。",
    },
    {
      stage: "guideline_ranking",
      unit_ids: guidelineRouteIds,
      instruction: "再用指南、比例、时间与波浪个性为仍有效的候选排序；不得推翻硬规则。",
    },
    {
      stage: "evidence_confirmation",
      unit_ids: evidenceRouteIds,
      instruction: "用独立证据确认或降低候选权重；单一指标或历史案例不能独立确认。",
    },
    {
      stage: "invalidation_management",
      unit_ids: invalidationRouteIds,
      instruction: `写明确认与失效条件；停止条件：${question.stop_conditions.join("；")}`,
    },
  ];
}

fs.writeFileSync(questionsPath, `${questions.map((question) => JSON.stringify(question)).join("\n")}\n`);
console.log(`Added four typed reasoning stages to ${questions.length} Questions`);
