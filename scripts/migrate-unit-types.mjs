import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const unitsPath = path.join(repositoryRoot, "knowledge/units/all.jsonl");
const units = fs.readFileSync(unitsPath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const typeMap = {
  rule: "RULE",
  guideline: "GUIDELINE",
  definition: "DEFINITION",
  method: "METHOD",
  wave_personality: "CHARACTERISTIC",
  confirmation_signal: "CONFIRMATION",
  case_observation: "HISTORICAL_CASE",
  term: "TERMINOLOGY",
  wave_structure: "DEFINITION",
  price_ratio: "GUIDELINE",
  time_relationship: "GUIDELINE",
  common_error: "THEORY_BOUNDARY",
  condition: "THEORY_BOUNDARY",
  figure_explanation: "DEFINITION",
};

for (const unit of units) {
  const legacyType = unit.legacy_type || unit.type;
  const mapped = typeMap[legacyType] || unit.type;
  unit.legacy_type = legacyType;
  unit.type = unit.id.startsWith("ewp-theory-") || unit.id === "ewp-method-theory-vs-trading" ? "THEORY_BOUNDARY" : mapped;
}

fs.writeFileSync(unitsPath, `${units.map((unit) => JSON.stringify(unit)).join("\n")}\n`);
const counts = units.reduce((summary, unit) => ({ ...summary, [unit.type]: (summary[unit.type] || 0) + 1 }), {});
console.log(JSON.stringify({ units: units.length, types: counts }, null, 2));
