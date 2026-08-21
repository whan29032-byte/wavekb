import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const knowledgeRoot = path.join(repositoryRoot, "knowledge");
const errors = [];
const warnings = [];

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    errors.push(`${path.relative(repositoryRoot, filePath)}: ${error.message}`);
    return {};
  }
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) {
    errors.push(`Missing ${path.relative(repositoryRoot, filePath)}`);
    return [];
  }
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line, index) => {
    try {
      return [JSON.parse(line)];
    } catch (error) {
      errors.push(`${path.relative(repositoryRoot, filePath)}:${index + 1}: ${error.message}`);
      return [];
    }
  });
}

function expect(condition, message) {
  if (!condition) errors.push(message);
}

function uniqueIds(rows, label) {
  const ids = rows.map((row) => row.id);
  expect(ids.every(Boolean), `${label} contains a missing id`);
  expect(new Set(ids).size === ids.length, `${label} contains duplicate ids`);
  return new Set(ids);
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

const units = readJsonl(path.join(knowledgeRoot, "units/all.jsonl"));
const relations = readJsonl(path.join(knowledgeRoot, "structure/relations.jsonl"));
const questions = readJsonl(path.join(knowledgeRoot, "questions/index.jsonl"));
const coverage = readJsonl(path.join(knowledgeRoot, "coverage/tenth-edition-pages.jsonl"));
const manifest = readJson(path.join(knowledgeRoot, "source/manifest.json"));
const supplements = readJson(path.join(knowledgeRoot, "source/supplements.json"));
const framework = readJson(path.join(knowledgeRoot, "source/framework.json"));
const imageRegistry = readJson(path.join(knowledgeRoot, "images/registry.json"));
const sourceRanges = readJson(path.join(knowledgeRoot, "source/ranges.json"));
const sourcePackets = readJson(path.join(knowledgeRoot, "source/packets.json"));
const packetUnitMap = readJson(path.join(knowledgeRoot, "source/packet-unit-map.json"));
const visualSampling = readJson(path.join(knowledgeRoot, "reports/visual-sampling.json"));
const compiled = readJson(path.join(repositoryRoot, "packages/knowledge/src/knowledge.json"));
const chapterFiles = fs.readdirSync(path.join(knowledgeRoot, "chapters")).filter((name) => name.endsWith(".jsonl")).sort();
const imageIds = new Set((imageRegistry.assets || []).map((asset) => asset.id));
const assetById = new Map((imageRegistry.assets || []).map((asset) => [asset.id, asset]));

expect(units.length === 117, `Expected 117 Units, found ${units.length}`);
expect(relations.length === 174, `Expected 174 Relations, found ${relations.length}`);
expect(questions.length === 18, `Expected 18 Questions, found ${questions.length}`);
const unitIds = uniqueIds(units, "Units");
const allowedCurrentTypes = new Set(["RULE", "GUIDELINE", "DEFINITION", "METHOD", "CHARACTERISTIC", "CONFIRMATION", "HISTORICAL_CASE", "THEORY_BOUNDARY", "TERMINOLOGY"]);
const requiredUnitFields = ["id", "title", "type", "summary", "content", "conditions", "invalidations", "guidelines", "examples", "common_mistakes", "source_refs", "image_refs", "related_units", "chapter_refs", "tags"];
for (const unit of units) {
  for (const field of requiredUnitFields) expect(Object.hasOwn(unit, field), `${unit.id} is missing schema field ${field}`);
  expect(Boolean(unit.title), `${unit.id} is missing title`);
  expect(allowedCurrentTypes.has(unit.type), `${unit.id} has unknown type ${unit.type}`);
  expect(Boolean(unit.statement), `${unit.id} is missing statement`);
  expect(Boolean(unit.source?.source_id), `${unit.id} is missing source_id`);
  expect(!Object.hasOwn(unit, "relations"), `${unit.id} duplicates canonical Relations inside the Unit`);
  expect(Array.isArray(unit.source_refs) && unit.source_refs.length > 0, `${unit.id} is missing source_refs`);
  for (const sourceRef of unit.source_refs || []) {
    expect(Boolean(sourceRef.source_id && sourceRef.authority), `${unit.id} contains an incomplete source_ref`);
    if (sourceRef.authority === "primary") {
      expect(sourceRef.source_id === manifest.source_id, `${unit.id} has a primary source_ref with the wrong source_id`);
      expect((sourceRef.pdf_pages || []).every((page) => Number.isInteger(page) && page >= 1 && page <= 280), `${unit.id} has an invalid page in a primary source_ref`);
    }
  }
  if (unit.source?.authority === "supplement") {
    expect(unit.source_refs.some((sourceRef) => sourceRef.authority === "primary" && sourceRef.evidence_type === "reviewed_packet_mapping"), `${unit.id} supplement-led content is missing its reviewed tenth-edition mapping`);
  }
  for (const imageId of unit.image_refs || []) expect(imageIds.has(imageId), `${unit.id} references missing image ${imageId}`);
  for (const relatedId of unit.related_units || []) expect(unitIds.has(relatedId), `${unit.id} references missing related Unit ${relatedId}`);
  expect(Array.isArray(unit.source?.pdf_pages) && unit.source.pdf_pages.length > 0, `${unit.id} is missing source pages`);
  if (unit.source?.authority === "primary") {
    expect(unit.source.source_id === manifest.source_id, `${unit.id} primary source_id does not match manifest`);
    expect(unit.source.pdf_pages.every((page) => Number.isInteger(page) && page >= 1 && page <= 280), `${unit.id} has an invalid primary PDF page`);
  }
}
const restoredUnits = units.filter((unit) => unit.content_audit?.status === "RESTORED");
expect(restoredUnits.length === 38, `Expected 38 source-restored Units, found ${restoredUnits.length}`);
expect(restoredUnits.filter((unit) => unit.content_audit.authority === "primary").length === 13, "Primary restored Unit count drifted");
expect(restoredUnits.filter((unit) => unit.content_audit.authority === "supplement").length === 25, "Supplement restored Unit count drifted");
for (const unit of restoredUnits) {
  expect(unit.content.length > unit.summary.length, `${unit.id} restored content is still only a summary`);
  expect(unit.content_audit.authority === unit.source.authority, `${unit.id} restoration authority conflicts with its source`);
}

for (const relation of relations) {
  expect(unitIds.has(relation.source), `Relation source does not exist: ${relation.source}`);
  expect(unitIds.has(relation.target), `Relation target does not exist: ${relation.target}`);
  expect(relation.source !== relation.target, `Self relation: ${relation.source}`);
  expect(new Set(["prerequisite", "related", "rule", "guideline", "confirmation", "invalidates", "commonly_confused", "example", "method", "source"]).has(relation.type), `Unknown Relation type: ${relation.type}`);
}
const genericRelations = relations.filter((relation) => relation.type === "related").length;
if (genericRelations) warnings.push(`${genericRelations} Relations still use the generic related type`);
const relationDegree = new Map(units.map((unit) => [unit.id, 0]));
const relationAdjacency = new Map(units.map((unit) => [unit.id, new Set()]));
for (const relation of relations) {
  relationDegree.set(relation.source, relationDegree.get(relation.source) + 1);
  relationDegree.set(relation.target, relationDegree.get(relation.target) + 1);
  relationAdjacency.get(relation.source).add(relation.target);
  relationAdjacency.get(relation.target).add(relation.source);
}
expect([...relationDegree.values()].every((count) => count > 0), "Orphan Units remain in Relations");
for (const unit of units) {
  expect(JSON.stringify([...(unit.related_units || [])].sort()) === JSON.stringify([...relationAdjacency.get(unit.id)].sort()), `${unit.id} related_units projection drifted from canonical Relations`);
}

for (const question of questions) {
  for (const unitId of [...(question.required_unit_ids || []), ...(question.optional_unit_ids || [])]) {
    expect(unitIds.has(unitId), `${question.id} references missing Unit ${unitId}`);
  }
  expect(JSON.stringify((question.reasoning_route || []).map((stage) => stage.stage)) === JSON.stringify(["rule_exclusion", "guideline_ranking", "evidence_confirmation", "invalidation_management"]), `${question.id} does not preserve the four-stage reasoning order`);
  for (const stage of question.reasoning_route || []) {
    expect((stage.unit_ids || []).length > 0, `${question.id}/${stage.stage} has no productizable Unit route`);
    for (const unitId of stage.unit_ids || []) expect(unitIds.has(unitId), `${question.id}/${stage.stage} references missing Unit ${unitId}`);
  }
}

const chapterUnitIds = [];
for (const fileName of chapterFiles) {
  const rows = readJsonl(path.join(knowledgeRoot, "chapters", fileName));
  for (const row of rows) {
    expect(Object.keys(row).every((key) => key === "unit_id" || key === "order"), `${fileName} contains duplicated Unit body fields`);
    expect(unitIds.has(row.unit_id), `${fileName} references missing Unit ${row.unit_id}`);
    chapterUnitIds.push(row.unit_id);
  }
}
expect(chapterUnitIds.length === 117, `Expected 117 Chapter Unit references, found ${chapterUnitIds.length}`);
expect(new Set(chapterUnitIds).size === 117, "Chapter indexes contain duplicate or missing Units");

expect(coverage.length === 280, `Expected 280 coverage rows, found ${coverage.length}`);
expect(new Set(coverage.map((row) => row.pdf_page)).size === 280, "Coverage pages are not unique");
expect(coverage.every((row, index) => row.pdf_page === index + 1), "Coverage pages are not ordered 1-280");
for (const row of coverage) {
  expect(row.source_id === manifest.source_id, `Coverage page ${row.pdf_page} has the wrong source_id`);
  expect(["OK", "NEEDS_REVIEW"].includes(row.status), `Coverage page ${row.pdf_page} has invalid status ${row.status}`);
  for (const unitId of [...(row.unit_ids || []), ...(row.suggested_unit_ids || [])]) {
    expect(unitIds.has(unitId), `Coverage page ${row.pdf_page} references missing Unit ${unitId}`);
  }
}
const coverageNeedsReview = coverage.filter((row) => row.status === "NEEDS_REVIEW").length;
expect(coverageNeedsReview === 0, `${coverageNeedsReview} of 280 coverage rows still need manual review`);

function expandedPages(ranges) {
  return ranges.flatMap((range) => Array.from({ length: range.pdf_end - range.pdf_start + 1 }, (_, index) => range.pdf_start + index));
}
for (const [label, ranges] of [["Source ranges", sourceRanges], ["Source packets", sourcePackets]]) {
  expect(Array.isArray(ranges), `${label} is not an array`);
  const pages = expandedPages(Array.isArray(ranges) ? ranges : []);
  expect(pages.length === 280, `${label} does not cover exactly 280 pages`);
  expect(new Set(pages).size === 280, `${label} contains overlapping or duplicate pages`);
  expect(pages.every((page, index) => page === index + 1), `${label} is not contiguous from PDF page 1 to 280`);
}
const packetIds = new Set(sourcePackets.map((packet) => packet.id));
expect(new Set(Object.keys(packetUnitMap.packets || {})).size === packetIds.size, "Reviewed packet mapping count does not match source packets");
const packetMappedUnits = new Set();
for (const [packetId, mappedUnitIds] of Object.entries(packetUnitMap.packets || {})) {
  expect(packetIds.has(packetId), `Reviewed mapping references unknown packet ${packetId}`);
  for (const unitId of mappedUnitIds) {
    expect(unitIds.has(unitId), `Reviewed packet ${packetId} references unknown Unit ${unitId}`);
    packetMappedUnits.add(unitId);
  }
}
expect(packetMappedUnits.size === 117, `Reviewed source packets map ${packetMappedUnits.size} of 117 Units`);
expect(coverage.every((row) => row.packet_id && row.review_method), "Coverage contains a page without reviewed packet provenance");
expect(visualSampling.source_sha256 === manifest.sha256, "Visual sampling source hash does not match the primary manifest");
expect(visualSampling.rendered_page_count === 280, "Visual sampling did not render all 280 primary pages");
expect((visualSampling.sections || []).every((section) => section.pdf_start >= 1 && section.pdf_end <= 280), "Visual sampling references pages outside the tenth edition");

expect(Array.isArray(imageRegistry.assets) && imageRegistry.assets.length > 0, "Image registry is empty");
for (const asset of imageRegistry.assets || []) {
  expect(Boolean(asset.id && asset.asset_path && asset.source_id && asset.authority && asset.figure_type && asset.caption), `Image registry entry is incomplete: ${asset.asset_path || asset.id}`);
  expect(fs.existsSync(path.join(repositoryRoot, asset.asset_path || "")), `Missing image file: ${asset.asset_path}`);
  for (const unitId of asset.unit_ids || []) expect(unitIds.has(unitId), `${asset.id} references missing Unit ${unitId}`);
}
const coreFigureUnits = ["ewp-rule-impulse-core", "ewp-guide-extension", "ewp-guide-truncation", "ewp-rule-diagonal", "ewp-guide-diagonal", "ewp-rule-zigzag", "ewp-rule-flat", "ewp-guide-flat", "ewp-rule-triangle", "ewp-guide-triangle", "ewp-rule-combination", "ewp-guide-combination"];
for (const unitId of coreFigureUnits) {
  const unit = units.find((item) => item.id === unitId);
  expect(unit.image_refs.some((imageId) => assetById.get(imageId)?.authority === "primary"), `${unitId} has no traceable tenth-edition primary figure`);
}

expect(compiled.schema_version === 2, `Expected compiled schema_version 2, found ${compiled.schema_version}`);
expect(compiled.pages?.length === 161, `Expected 161 compiled pages, found ${compiled.pages?.length}`);
expect(compiled.relations?.length === 174, "Compiled Relations count drifted");
expect(compiled.questions?.length === 18, "Compiled Questions count drifted");
expect(compiled.themes?.length === 8, "Compiled theme count drifted");
const compiledPageIds = uniqueIds(compiled.pages || [], "Compiled pages");
for (const unitId of unitIds) expect(compiledPageIds.has(`unit-${unitId}`), `Missing compiled page for Unit ${unitId}`);
for (const page of compiled.pages || []) {
  for (const unitId of page.source_unit_ids || []) expect(unitIds.has(unitId), `${page.id} references missing Unit ${unitId}`);
  expect(!(page.figures || []).length, `${page.id} uses deprecated mixed figures`);
  expect(!(page.source_images || []).length, `${page.id} uses deprecated mixed source_images`);
  if (page.kind === "core") expect(page.generation_source === "canonical_units", `${page.id} does not generate its body from canonical Units`);
}

const sourceFiles = [manifest, ...(supplements.sources || [])];
for (const source of sourceFiles) {
  if (!source.path || !fs.existsSync(source.path)) {
    warnings.push(`${source.source_id} source file is unavailable; hash could not be verified`);
  } else {
    expect(sha256(source.path) === source.sha256, `${source.source_id} SHA-256 mismatch`);
  }
}
if (framework.path && fs.existsSync(framework.path)) expect(sha256(framework.path) === framework.sha256, "Framework SHA-256 mismatch");
else warnings.push("Framework source file is unavailable; hash could not be verified");

const status = {
  ok: errors.length === 0,
  counts: {
    source_pages: coverage.length,
    coverage_ok: coverage.length - coverageNeedsReview,
    coverage_needs_review: coverageNeedsReview,
    units: units.length,
    relations: relations.length,
    broken_relations: errors.filter((message) => message.startsWith("Relation ")).length,
    questions: questions.length,
    compiled_pages: compiled.pages?.length || 0,
    image_assets: imageRegistry.assets?.length || 0,
    restored_units: restoredUnits.length,
    generic_relations: genericRelations,
    primary_source_verified: Boolean(manifest.path && fs.existsSync(manifest.path) && sha256(manifest.path) === manifest.sha256),
  },
  warnings,
  errors,
};
console.log(JSON.stringify(status, null, 2));
if (errors.length) process.exitCode = 1;
