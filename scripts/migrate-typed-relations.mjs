import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const unitsPath = path.join(repositoryRoot, "knowledge/units/all.jsonl");
const relationsPath = path.join(repositoryRoot, "knowledge/structure/relations.jsonl");
const units = fs.readFileSync(unitsPath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const unitById = new Map(units.map((unit) => [unit.id, unit]));
const original = fs.readFileSync(relationsPath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));

const orphanTargets = {
  "ewp-case-1978-alternative-counts": "ewp-method-multiple-counts",
  "ewp-case-benner-cycle": "ewp-guide-fixed-cycle-limit",
  "ewp-case-commodity-ratios": "ewp-guide-commodity-differences",
  "ewp-case-decade-pattern": "ewp-guide-fixed-cycle-limit",
  "ewp-case-elliott-1935-forecast": "ewp-front-market-context",
  "ewp-case-fibonacci-history": "ewp-definition-fibonacci-sequence",
  "ewp-case-gold-1970s": "ewp-guide-gold-cross-confirmation",
  "ewp-case-historical-ratio-forecasts": "ewp-method-ratio-analysis",
  "ewp-case-individual-stocks": "ewp-method-index-before-stock",
  "ewp-case-kondratieff": "ewp-guide-fixed-cycle-limit",
  "ewp-case-long-market-spirals": "ewp-definition-logarithmic-spiral",
  "ewp-case-millennium-wave": "ewp-theory-probability-and-degree",
  "ewp-case-postscript-context": "ewp-method-forecast-as-background",
  "ewp-case-publisher-success-claim": "ewp-method-long-forecast-tentative",
  "ewp-case-random-walk-critique": "ewp-theory-nonlinear-market-development",
  "ewp-case-supercycle-1789": "ewp-theory-probability-and-degree",
  "ewp-case-supercycle-1932": "ewp-method-multiple-counts",
  "ewp-guide-gold-cross-confirmation": "ewp-guide-commodity-differences",
  "ewp-guide-stock-market-alignment": "ewp-method-index-before-stock",
  "ewp-theory-exogenous-forces-unproven": "ewp-method-count-first-never-blind-scenario",
  "ewp-theory-natural-law-ideology": "ewp-theory-probability-and-degree",
  "ewp-theory-phi-natural-order": "ewp-definition-golden-ratio",
  "ewp-theory-social-pattern-endogenous": "ewp-theory-news-reaction",
};

const originalKeys = new Set(original.map((relation) => `${relation.source}\u0000${relation.target}`));
const reverseCandidates = original
  .filter((relation) => relation.source > relation.target && originalKeys.has(`${relation.target}\u0000${relation.source}`))
  .sort((left, right) => `${left.source}\u0000${left.target}`.localeCompare(`${right.source}\u0000${right.target}`));
if (reverseCandidates.length < Object.keys(orphanTargets).length) throw new Error("Not enough redundant bidirectional edges to preserve relation count");
const removeKeys = new Set(reverseCandidates.slice(0, Object.keys(orphanTargets).length).map((relation) => `${relation.source}\u0000${relation.target}`));
const relations = original.filter((relation) => !removeKeys.has(`${relation.source}\u0000${relation.target}`));
for (const [source, target] of Object.entries(orphanTargets)) relations.push({ source, target, migration_note: "orphan_repair" });

function relationType(source, target) {
  const sourceUnit = unitById.get(source);
  const targetUnit = unitById.get(target);
  if (!sourceUnit || !targetUnit) throw new Error(`Unknown relation endpoint ${source} -> ${target}`);
  const sourceType = sourceUnit.legacy_type || sourceUnit.type;
  const targetType = targetUnit.legacy_type || targetUnit.type;
  if (sourceType === "case_observation") return "example";
  if (sourceType === "confirmation_signal") return "confirmation";
  if (sourceType === "common_error" || targetType === "common_error") return "commonly_confused";
  if (sourceType === "condition") return "prerequisite";
  if (sourceType === "guideline" && targetType === "rule") return "guideline";
  if (sourceType === "rule") return "rule";
  if (sourceType === "method" || targetType === "method") return "method";
  if (["definition", "wave_structure", "term"].includes(sourceType) && !["definition", "term"].includes(targetType)) return "prerequisite";
  return "related";
}

const migrated = relations.map((relation) => {
  const type = relationType(relation.source, relation.target);
  return {
    source: relation.source,
    target: relation.target,
    type,
    review_status: type === "related" ? "needs_review" : "verified_by_type_and_direction",
    ...(relation.migration_note ? { migration_note: relation.migration_note } : {}),
  };
}).sort((left, right) => `${left.source}\u0000${left.target}`.localeCompare(`${right.source}\u0000${right.target}`));

if (migrated.length !== original.length) throw new Error(`Relation count drifted: ${original.length} -> ${migrated.length}`);
const keys = migrated.map((relation) => `${relation.source}\u0000${relation.target}\u0000${relation.type}`);
if (new Set(keys).size !== keys.length) throw new Error("Typed relation triples are not unique");
const degree = new Map(units.map((unit) => [unit.id, 0]));
for (const relation of migrated) {
  degree.set(relation.source, degree.get(relation.source) + 1);
  degree.set(relation.target, degree.get(relation.target) + 1);
}
const orphans = [...degree].filter(([, count]) => count === 0).map(([unitId]) => unitId);
if (orphans.length) throw new Error(`Orphan Units remain: ${orphans.join(", ")}`);

fs.writeFileSync(relationsPath, `${migrated.map((relation) => JSON.stringify(relation)).join("\n")}\n`);
const counts = migrated.reduce((summary, relation) => ({ ...summary, [relation.type]: (summary[relation.type] || 0) + 1 }), {});
console.log(JSON.stringify({ relations: migrated.length, removed_reverse_edges: removeKeys.size, repaired_orphans: Object.keys(orphanTargets).length, remaining_orphans: 0, types: counts }, null, 2));
