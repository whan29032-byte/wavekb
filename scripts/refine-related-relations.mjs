import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const relationsPath = path.join(repositoryRoot, "knowledge/structure/relations.jsonl");
const relations = fs.readFileSync(relationsPath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));

const explicitTypes = new Map(Object.entries({
  "ewp-case-golden-rectangle|ewp-definition-golden-ratio": "example",
  "ewp-definition-fibonacci-sequence|ewp-definition-golden-ratio": "prerequisite",
  "ewp-definition-golden-section|ewp-definition-golden-ratio": "commonly_confused",
  "ewp-guide-gold-cross-confirmation|ewp-guide-commodity-differences": "confirmation",
  "ewp-guide-scale-invariance-long-short|ewp-definition-repeating-form": "confirmation",
  "ewp-structure-fractal-cycle|ewp-definition-wave-degree": "prerequisite",
  "ewp-theory-nonlinear-market-development|ewp-definition-repeating-form": "prerequisite",
}));

let refined = 0;
for (const relation of relations) {
  if (relation.type !== "related") continue;
  const key = `${relation.source}|${relation.target}`;
  let type = explicitTypes.get(key);
  if (!type && relation.source.startsWith("ewp-personality-") && relation.target.startsWith("ewp-personality-")) type = "related";
  else if (!type && relation.source.startsWith("ewp-personality-") && relation.target.includes("volume-personality")) type = "confirmation";
  else if (!type && relation.source.startsWith("ewp-personality-")) type = "example";
  else if (!type && relation.source.startsWith("ewp-theory-news-reaction") && relation.target.startsWith("ewp-personality-")) type = "example";
  else if (!type && relation.source.startsWith("ewp-guide-") && relation.target.startsWith("ewp-rule-")) type = "guideline";
  else if (!type && relation.source.startsWith("ewp-guide-") && relation.target.startsWith("ewp-method-")) type = "guideline";
  else if (!type && relation.source.startsWith("ewp-guide-") && relation.target.startsWith("ewp-guide-")) type = "guideline";

  if (type && type !== "related") {
    relation.type = type;
    relation.review_status = "reviewed";
    relation.migration_note = relation.migration_note ? `${relation.migration_note};semantic_refinement` : "semantic_refinement";
    refined += 1;
  }
}

fs.writeFileSync(relationsPath, `${relations.map((relation) => JSON.stringify(relation)).join("\n")}\n`);
const remaining = relations.filter((relation) => relation.type === "related").length;
console.log(`Refined ${refined} generic Relations; ${remaining} genuinely broad related edges remain`);
