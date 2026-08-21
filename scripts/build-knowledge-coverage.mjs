import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const unitsPath = path.join(repositoryRoot, "knowledge/units/all.jsonl");
const defaultOutput = path.join(repositoryRoot, "knowledge/coverage/tenth-edition-pages.jsonl");
const packetsPath = path.join(repositoryRoot, "knowledge/source/packets.json");
const packetUnitMapPath = path.join(repositoryRoot, "knowledge/source/packet-unit-map.json");

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const distillationPath = option("--distillation") || process.env.WAVEKB_TENTH_DISTILLATION;
const outputPath = path.resolve(option("--output") || defaultOutput);
if (!distillationPath) {
  throw new Error("Pass --distillation /path/to/280-page-distillation.md or set WAVEKB_TENTH_DISTILLATION");
}
if (!fs.existsSync(distillationPath)) throw new Error(`Distillation file does not exist: ${distillationPath}`);

function readJsonl(filePath) {
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${filePath}:${index + 1}: ${error.message}`);
    }
  });
}

function physicalChapter(page) {
  if (page <= 24) return "前置内容";
  if (page <= 68) return "第一章";
  if (page <= 108) return "第二章";
  if (page <= 143) return "第三章";
  if (page <= 145) return "第二部分分隔";
  if (page <= 169) return "第四章";
  if (page <= 184) return "第五章";
  if (page <= 199) return "第六章";
  if (page <= 217) return "第七章";
  if (page <= 232) return "第八章";
  if (page === 233) return "附录前空白";
  if (page === 234) return "附录分隔";
  if (page <= 270) return "附录";
  if (page <= 274) return "词汇表";
  if (page <= 279) return "原出版者后记";
  return "归档元数据";
}

function parsePages(markdown) {
  const pattern = /^### PDF第(\d{3})页\s*$/gm;
  const matches = [...markdown.matchAll(pattern)];
  const pages = new Map();
  for (let index = 0; index < matches.length; index += 1) {
    const start = matches[index].index + matches[index][0].length;
    const end = matches[index + 1]?.index ?? markdown.length;
    const page = Number(matches[index][1]);
    const body = markdown.slice(start, end).trim();
    pages.set(page, body);
  }
  return pages;
}

function textTokens(value) {
  const normalized = String(value || "").toLocaleLowerCase("zh-CN");
  const words = normalized.match(/[a-z0-9]+|[\p{Script=Han}]+/gu) || [];
  const tokens = new Set();
  for (const word of words) {
    if (/^[a-z0-9]+$/.test(word)) {
      if (word.length > 1) tokens.add(word);
      continue;
    }
    for (let size = 2; size <= 4; size += 1) {
      for (let index = 0; index <= word.length - size; index += 1) tokens.add(word.slice(index, index + size));
    }
  }
  return tokens;
}

function unitSearchText(unit) {
  return [
    unit.title,
    unit.statement,
    unit.source?.section,
    ...(unit.conditions || []),
    ...(unit.invalidations || []),
    ...(unit.exceptions || []),
    ...(unit.action || []),
  ].join(" ");
}

function score(pageTokens, unitTokens) {
  if (!pageTokens.size || !unitTokens.size) return 0;
  let overlap = 0;
  for (const token of unitTokens) if (pageTokens.has(token)) overlap += token.length >= 4 ? 2 : 1;
  return overlap / Math.sqrt(pageTokens.size * unitTokens.size);
}

function classifyPage(body) {
  const figureMentions = [...new Set(body.match(/图\d+-\d+/g) || [])];
  const nonKnowledge = /无新增理论内容|无正文论证|空白页|为空白|归档元数据/.test(body);
  const navigation = /目录第\d+页|目录。|分隔页|封面|内封面|版权与CIP|题献页/.test(body);
  const pageKind = nonKnowledge ? "non_knowledge" : navigation ? "navigation_or_context" : figureMentions.length ? "content_with_figure" : "content";
  return { pageKind, figureMentions };
}

const units = readJsonl(unitsPath);
const unitById = new Map(units.map((unit) => [unit.id, unit]));
const packets = JSON.parse(fs.readFileSync(packetsPath, "utf8"));
const packetUnitMap = JSON.parse(fs.readFileSync(packetUnitMapPath, "utf8"));
const packetByPage = new Map();
for (const packet of packets) {
  if (!Object.hasOwn(packetUnitMap.packets, packet.id)) throw new Error(`Packet ${packet.id} has no reviewed Unit mapping`);
  for (let page = packet.pdf_start; page <= packet.pdf_end; page += 1) {
    if (packetByPage.has(page)) throw new Error(`PDF page ${page} occurs in multiple source packets`);
    packetByPage.set(page, packet);
  }
  for (const unitId of packetUnitMap.packets[packet.id]) {
    if (!unitById.has(unitId)) throw new Error(`Packet ${packet.id} references unknown Unit ${unitId}`);
  }
}
if (packetByPage.size !== 280) throw new Error(`Reviewed source packets cover ${packetByPage.size} pages instead of 280`);
const primaryRefs = new Map();
for (const unit of units) {
  if (unit.source?.authority !== "primary") continue;
  for (const page of unit.source?.pdf_pages || []) {
    if (!primaryRefs.has(page)) primaryRefs.set(page, []);
    primaryRefs.get(page).push(unit.id);
  }
}

const unitTokens = new Map(units.map((unit) => [unit.id, textTokens(unitSearchText(unit))]));
const pageBodies = parsePages(fs.readFileSync(distillationPath, "utf8"));
if (pageBodies.size !== 280 || Math.min(...pageBodies.keys()) !== 1 || Math.max(...pageBodies.keys()) !== 280) {
  throw new Error(`Expected exactly PDF pages 1-280, found ${pageBodies.size}`);
}

const rows = [];
for (let pdfPage = 1; pdfPage <= 280; pdfPage += 1) {
  const body = pageBodies.get(pdfPage) || "";
  const chapter = physicalChapter(pdfPage);
  const { pageKind, figureMentions } = classifyPage(body);
  const explicitUnitIds = [...new Set(primaryRefs.get(pdfPage) || [])].sort();
  const packet = packetByPage.get(pdfPage);
  const curatedUnitIds = packet ? packetUnitMap.packets[packet.id] : [];
  const mappedUnitIds = [...new Set([...explicitUnitIds, ...curatedUnitIds])].sort();
  const candidates = units.filter((unit) => unit.source?.chapter === chapter);
  const pageTokens = textTokens(body);
  const ranked = candidates
    .map((unit) => ({ unit_id: unit.id, score: score(pageTokens, unitTokens.get(unit.id)) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.unit_id.localeCompare(right.unit_id));
  const bestScore = ranked[0]?.score || 0;
  const suggestedUnitIds = mappedUnitIds.length || packet
    ? []
    : ranked.filter((item, index) => index < 3 && item.score >= Math.max(0.06, bestScore * 0.7)).map((item) => item.unit_id);
  const mappingMethod = explicitUnitIds.length && curatedUnitIds.length
    ? "explicit_and_curated_packet"
    : explicitUnitIds.length
      ? "explicit_primary_source_ref"
      : curatedUnitIds.length
        ? "curated_packet_mapping"
        : packet
          ? "curated_non_unit_page"
      : suggestedUnitIds.length
        ? "chapter_semantic_suggestion"
        : "unmapped";
  const status = mappedUnitIds.length || packet ? "OK" : "NEEDS_REVIEW";
  rows.push({
    source_id: "ewp-10-zh-2016",
    pdf_page: pdfPage,
    chapter,
    page_kind: pageKind,
    unit_ids: mappedUnitIds,
    suggested_unit_ids: suggestedUnitIds,
    mapping_method: mappingMethod,
    packet_id: packet?.id || null,
    review_method: packet ? packetUnitMap.review_method : null,
    figure_mentions: figureMentions,
    summary: body.split(/\r?\n/).filter((line) => /^- /.test(line)).map((line) => line.slice(2).trim()),
    status,
  });
}

for (const row of rows) {
  for (const unitId of [...row.unit_ids, ...row.suggested_unit_ids]) {
    if (!unitById.has(unitId)) throw new Error(`Unknown Unit ID in coverage row ${row.pdf_page}: ${unitId}`);
  }
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
const counts = rows.reduce((summary, row) => {
  summary[row.status] = (summary[row.status] || 0) + 1;
  summary[row.mapping_method] = (summary[row.mapping_method] || 0) + 1;
  return summary;
}, {});
console.log(JSON.stringify({ output: path.relative(repositoryRoot, outputPath), pages: rows.length, counts }, null, 2));
