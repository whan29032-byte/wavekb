import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const unitsPath = path.join(repositoryRoot, "knowledge/units/all.jsonl");
const coveragePath = path.join(repositoryRoot, "knowledge/coverage/tenth-edition-pages.jsonl");
const units = fs.readFileSync(unitsPath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const coverage = fs.readFileSync(coveragePath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));

const pagesByUnit = new Map(units.map((unit) => [unit.id, []]));
const packetsByUnit = new Map(units.map((unit) => [unit.id, []]));
for (const row of coverage) {
  for (const unitId of row.unit_ids || []) {
    pagesByUnit.get(unitId)?.push(row.pdf_page);
    if (row.packet_id) packetsByUnit.get(unitId)?.push(row.packet_id);
  }
}

let added = 0;
for (const unit of units) {
  unit.source_refs = (unit.source_refs || [unit.source]).filter((ref) => ref.evidence_type !== "reviewed_packet_mapping");
  if (unit.source?.authority === "primary") continue;
  const pdfPages = [...new Set(pagesByUnit.get(unit.id) || [])].sort((left, right) => left - right);
  if (!pdfPages.length) throw new Error(`${unit.id} has no reviewed tenth-edition packet mapping`);
  unit.source_refs.push({
    source_id: "ewp-10-zh-2016",
    chapter: unit.source.chapter,
    section: "第10版人工复核语义分段",
    book_pages: [],
    pdf_pages: pdfPages,
    figures: [],
    authority: "primary",
    evidence_type: "reviewed_packet_mapping",
    packet_ids: [...new Set(packetsByUnit.get(unit.id) || [])].sort(),
  });
  added += 1;
}

fs.writeFileSync(unitsPath, `${units.map((unit) => JSON.stringify(unit)).join("\n")}\n`);
const mappingUnits = units.map((unit) => {
  const tenthPages = [...new Set((unit.source_refs || []).filter((ref) => ref.authority === "primary").flatMap((ref) => ref.pdf_pages || []))].sort((left, right) => left - right);
  return {
    unit_id: unit.id,
    tenth_pdf_pages: tenthPages,
    migration_action: unit.source.authority === "primary" ? "primary_source" : "add_primary_ref_keep_supplement",
    authority: unit.source.authority === "primary" ? "primary" : "mixed",
    notes: unit.source.authority === "primary"
      ? "第10版明确Unit来源页；第11版图示仅作补充。"
      : "第10版人工复核语义分段提供Primary追踪；第11版条目原页继续作为Supplement保留。",
  };
});
const unitMap = {
  primary_source_id: "ewp-10-zh-2016",
  supplement_source_id: "ewp-11-zh-2021",
  mapping_method: "explicit source refs plus manually reviewed semantic packets",
  units: mappingUnits,
};
fs.writeFileSync(path.join(repositoryRoot, "knowledge/source/tenth-edition-unit-map.json"), `${JSON.stringify(unitMap, null, 2)}\n`);
const migrationReport = {
  unit_count: units.length,
  primary_unit_count: units.filter((unit) => unit.source.authority === "primary").length,
  mixed_unit_count: units.filter((unit) => unit.source.authority === "supplement").length,
  units: units.map((unit, index) => ({
    id: unit.id,
    type: unit.type,
    legacy_type: unit.legacy_type,
    action: mappingUnits[index].migration_action,
    canonical_content_source: unit.source.source_id,
    source_authorities: [...new Set((unit.source_refs || []).map((ref) => ref.authority))],
    tenth_pdf_pages: mappingUnits[index].tenth_pdf_pages,
  })),
};
fs.writeFileSync(path.join(repositoryRoot, "knowledge/reports/tenth-edition-migration.json"), `${JSON.stringify(migrationReport, null, 2)}\n`);
console.log(`Added reviewed tenth-edition source refs to ${added} supplement-led Units; refreshed the 117-Unit source map and migration report`);
