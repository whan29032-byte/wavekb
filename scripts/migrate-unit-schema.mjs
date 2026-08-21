import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const knowledgeRoot = path.join(repositoryRoot, "knowledge");
const unitsPath = path.join(knowledgeRoot, "units/all.jsonl");
const units = fs.readFileSync(unitsPath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const relations = fs.readFileSync(path.join(knowledgeRoot, "structure/relations.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const registry = JSON.parse(fs.readFileSync(path.join(knowledgeRoot, "images/registry.json"), "utf8"));
const taxonomy = JSON.parse(fs.readFileSync(path.join(knowledgeRoot, "structure/taxonomy.json"), "utf8"));

const adjacency = new Map(units.map((unit) => [unit.id, []]));
for (const relation of relations) {
  adjacency.get(relation.source).push(relation.target);
  adjacency.get(relation.target).push(relation.source);
}
const chapterRefs = new Map(units.map((unit) => [unit.id, []]));
for (const fileName of fs.readdirSync(path.join(knowledgeRoot, "chapters")).filter((name) => name.endsWith(".jsonl")).sort()) {
  const chapterId = fileName.replace(/\.jsonl$/, "");
  const rows = fs.readFileSync(path.join(knowledgeRoot, "chapters", fileName), "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  for (const row of rows) chapterRefs.get(row.unit_id).push(chapterId);
}
const themeByUnit = new Map();
function walkTheme(node, rootId) {
  for (const unitId of node.unit_ids || []) themeByUnit.set(unitId, rootId);
  for (const child of node.children || []) walkTheme(child, rootId);
}
for (const root of taxonomy.roots || []) walkTheme(root, root.id);
const imagesByUnit = new Map(units.map((unit) => [unit.id, []]));
for (const asset of registry.assets || []) for (const unitId of asset.unit_ids || []) imagesByUnit.get(unitId)?.push(asset.id);

for (const unit of units) {
  unit.summary ||= unit.statement;
  unit.content ||= [unit.statement, unit.reasoning].filter(Boolean).join("\n\n");
  unit.guidelines ||= unit.type === "GUIDELINE" ? [unit.statement] : [];
  unit.examples ||= unit.type === "HISTORICAL_CASE" ? [unit.statement] : [];
  unit.common_mistakes ||= unit.legacy_type === "common_error" ? [unit.statement] : [];
  unit.source_refs ||= [unit.source];
  unit.image_refs = [...new Set(imagesByUnit.get(unit.id))].sort();
  unit.related_units = [...new Set(adjacency.get(unit.id))].sort();
  unit.chapter_refs = [...new Set(chapterRefs.get(unit.id))].sort();
  unit.tags = [...new Set([unit.type.toLocaleLowerCase(), unit.legacy_type, unit.source.chapter, themeByUnit.get(unit.id)].filter(Boolean))];
}

fs.writeFileSync(unitsPath, `${units.map((unit) => JSON.stringify(unit)).join("\n")}\n`);
console.log(`Migrated ${units.length} Units to the phase-two schema without changing statements`);
