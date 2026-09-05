import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const knowledgeRoot = path.join(repositoryRoot, "knowledge");
const outputPath = path.join(repositoryRoot, "packages/knowledge/src/knowledge.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${filePath}:${index + 1}: ${error.message}`);
    }
  });
}

function markdownFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(filePath);
    return entry.isFile() && entry.name.endsWith(".md") ? [filePath] : [];
  });
}

function parseFrontMatter(source, filePath) {
  if (!source.startsWith("---\n")) throw new Error(`${filePath} is missing YAML front matter`);
  const end = source.indexOf("\n---\n", 4);
  if (end < 0) throw new Error(`${filePath} has unterminated YAML front matter`);
  const metadata = {};
  let listKey = null;
  for (const line of source.slice(4, end).split(/\r?\n/)) {
    const scalar = line.match(/^([a-zA-Z0-9_]+):(?:\s*(.*))?$/);
    if (scalar) {
      const [, key, rawValue = ""] = scalar;
      listKey = rawValue ? null : key;
      if (!rawValue || rawValue === "[]") metadata[key] = [];
      else if (/^-?\d+$/.test(rawValue)) metadata[key] = Number(rawValue);
      else if (rawValue === "null") metadata[key] = null;
      else if (rawValue === "true" || rawValue === "false") metadata[key] = rawValue === "true";
      else metadata[key] = rawValue.replace(/^['"]|['"]$/g, "");
      continue;
    }
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && listKey) metadata[listKey].push(item[1].replace(/^['"]|['"]$/g, ""));
  }
  return { metadata, body: source.slice(end + 5).trim() };
}

function parseSections(body) {
  const sections = [];
  let current = null;
  let paragraph = [];
  function flushParagraph() {
    if (current && paragraph.length) current.paragraphs.push(paragraph.join("\n").trim());
    paragraph = [];
  }
  for (const line of body.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      flushParagraph();
      current = { title: heading[1].trim(), paragraphs: [], items: [] };
      sections.push(current);
      continue;
    }
    if (!current) continue;
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      current.items.push(bullet[1].trim());
    } else if (!line.trim()) {
      flushParagraph();
    } else {
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  return sections;
}

function sourceLabel(unit) {
  const source = unit.source || {};
  const pages = (source.pdf_pages || []).length ? `PDF ${source.pdf_pages.join(", ")}` : "页码待复核";
  const figures = (source.figures || []).length ? `；图 ${source.figures.join(", ")}` : "";
  return `${unit.title}：${source.source_id || "来源待补"} / ${source.chapter || "章节待补"} / ${pages}${figures} / ${source.authority || "authority待补"}`;
}

function unitSections(unit) {
  const contentParagraphs = String(unit.content || unit.summary || unit.statement || "").split(/\n\n+/).filter(Boolean);
  const sections = [
    { title: "快速答案", paragraphs: [unit.summary || unit.statement], items: [] },
    { title: "完整解释", paragraphs: contentParagraphs, items: [] },
  ];
  if (unit.type === "RULE") {
    sections.push({ title: "强制规则与适用条件", paragraphs: ["以下条件属于该规则的适用范围；指南和常见表现不能替代规则检查。"], items: unit.conditions || [] });
  } else if (unit.type === "GUIDELINE") {
    sections.push({ title: "指南（非硬规则）", paragraphs: ["本条是候选排序指南，不满足时不应单独否定结构，满足时也不能单独确认结构。"], items: unit.guidelines || [] });
  } else {
    sections.push({ title: "类型与使用边界", paragraphs: [`知识类型：${unit.type}。先检查适用条件，再结合规则、证据和失效管理使用。`], items: unit.conditions || [] });
  }
  sections.push(
    { title: "失效与边界", paragraphs: unit.invalidations?.length ? [] : ["本条没有独立硬失效位；仍须服从关联规则及具体候选数浪的失效条件。"], items: unit.invalidations || [] },
    { title: "案例与上下文", paragraphs: [], items: unit.examples || [] },
    { title: "常见错误", paragraphs: [], items: unit.common_mistakes || [] },
    { title: "相关知识", paragraphs: [], items: (unit.related_units || []).map((unitId) => `${unitId} — ${unitById.get(unitId)?.title || "未知 Unit"}`) },
    { title: "原书来源", paragraphs: [], items: [sourceLabel(unit)] },
  );
  return sections.filter((section) => section.paragraphs.length || section.items.length);
}

function aggregateSections(sourceUnitIds) {
  const sourceUnits = sourceUnitIds.map((unitId) => unitById.get(unitId));
  const rules = sourceUnits.filter((unit) => unit.type === "RULE");
  const guidelines = sourceUnits.filter((unit) => unit.type === "GUIDELINE");
  const confirmations = sourceUnits.filter((unit) => unit.type === "CONFIRMATION");
  const cases = sourceUnits.filter((unit) => unit.type === "HISTORICAL_CASE");
  const sections = [
    { title: "快速答案", paragraphs: ["本页是同一批 Units 的阅读视图；每条摘要可继续进入对应 Unit 查看完整解释、失效条件与来源。"], items: sourceUnits.map((unit) => `${unit.title}：${unit.summary || unit.statement}`) },
    { title: "完整解释", paragraphs: sourceUnits.map((unit) => `${unit.title}（${unit.type}）\n${unit.content || unit.summary || unit.statement}`), items: [] },
    { title: "强制规则", paragraphs: rules.length ? ["先用规则排除不合法候选。"] : [], items: rules.map((unit) => `${unit.title}：${unit.summary || unit.statement}`) },
    { title: "指南（非硬规则）", paragraphs: guidelines.length ? ["规则通过后，再用指南排序剩余候选。"] : [], items: guidelines.map((unit) => `${unit.title}：${unit.summary || unit.statement}`) },
    { title: "证据确认", paragraphs: confirmations.length ? ["确认类证据不能反向覆盖结构规则。"] : [], items: confirmations.map((unit) => `${unit.title}：${unit.summary || unit.statement}`) },
    { title: "失效管理", paragraphs: [], items: sourceUnits.flatMap((unit) => (unit.invalidations || []).map((item) => `${unit.title}：${item}`)) },
    { title: "历史案例", paragraphs: cases.length ? ["以下均为历史案例或作者在特定时点的研判，不是统计证明。"] : [], items: cases.map((unit) => `${unit.title}：${unit.summary || unit.statement}`) },
    { title: "原书来源", paragraphs: [], items: sourceUnits.map(sourceLabel) },
  ];
  return sections.filter((section) => section.paragraphs.length || section.items.length);
}

function pagePriority(relativePath, id) {
  if (relativePath.includes("/distilled/") && id.startsWith("unit-")) return 10;
  if (relativePath.includes("/distilled/")) return 20;
  if (relativePath.includes("/core/")) return 30;
  return 40;
}

function publicAsset(asset) {
  return {
    id: asset.id,
    asset_path: asset.asset_path,
    source_id: asset.source_id,
    edition: asset.edition,
    authority: asset.authority,
    figure_type: asset.figure_type,
    pdf_page: asset.source_page,
    book_pages: asset.book_pages,
    figure_nos: asset.figure_nos,
    caption: asset.caption,
    width: asset.width,
    height: asset.height,
  };
}

function assetsForPage(page, assets) {
  if (page.id === "core-full-book" || page.id.startsWith("full-")) return [];
  const sourceUnits = new Set(page.source_unit_ids);
  return assets.filter((asset) => asset.unit_ids.some((unitId) => sourceUnits.has(unitId)));
}

const units = readJsonl(path.join(knowledgeRoot, "units/all.jsonl"));
const unitById = new Map(units.map((unit) => [unit.id, unit]));
const relations = readJsonl(path.join(knowledgeRoot, "structure/relations.jsonl"));
const questions = readJsonl(path.join(knowledgeRoot, "questions/index.jsonl"));
const taxonomy = readJson(path.join(knowledgeRoot, "structure/taxonomy.json"));
const roots = readJson(path.join(knowledgeRoot, "pages/roots.json")).roots;
const imageRegistry = readJson(path.join(knowledgeRoot, "images/registry.json"));
const manifest = readJson(path.join(knowledgeRoot, "source/manifest.json"));
const framework = readJson(path.join(knowledgeRoot, "source/framework.json"));
const library = readJson(path.join(knowledgeRoot, "source/library.json"));
const coverage = readJsonl(path.join(knowledgeRoot, "coverage/tenth-edition-pages.jsonl"));

if (!library || !Array.isArray(library.books)) throw new Error("knowledge/source/library.json must contain a books array");
const libraryBookIds = new Set();
for (const book of library.books) {
  for (const field of ["id", "title", "eyebrow", "description", "source_label", "coverage_note", "generated_on", "pdf_path", "cover_path", "sha256"]) {
    if (!book?.[field]) throw new Error(`Knowledge library book is missing ${field}`);
  }
  if (libraryBookIds.has(book.id)) throw new Error(`Duplicate knowledge library book id: ${book.id}`);
  libraryBookIds.add(book.id);
  for (const assetPath of [book.pdf_path, book.cover_path]) {
    if (!String(assetPath).startsWith("assets/books/") || String(assetPath).includes("..")) throw new Error(`Unsafe knowledge library asset path: ${assetPath}`);
    if (!fs.existsSync(path.join(repositoryRoot, assetPath))) throw new Error(`Missing knowledge library asset: ${assetPath}`);
  }
  if (!Number.isInteger(book.pdf_pages) || book.pdf_pages < 1 || !Number.isInteger(book.source_page_count) || book.source_page_count < 1) {
    throw new Error(`Knowledge library book has invalid page counts: ${book.id}`);
  }
  if (!Array.isArray(book.topics) || !book.topics.length || !Array.isArray(book.reading_guide) || !book.reading_guide.length || !Array.isArray(book.boundaries) || !book.boundaries.length) {
    throw new Error(`Knowledge library book is missing reading metadata: ${book.id}`);
  }
}
const adjacentRelations = new Map(units.map((unit) => [unit.id, []]));
for (const relation of relations) {
  adjacentRelations.get(relation.source).push(relation.target);
  adjacentRelations.get(relation.target).push(relation.source);
}

const parsedPages = markdownFiles(path.join(knowledgeRoot, "pages")).map((filePath) => {
  const relativePath = path.relative(repositoryRoot, filePath);
  const { metadata, body } = parseFrontMatter(fs.readFileSync(filePath, "utf8"), relativePath);
  if (!metadata.id || !metadata.title || !metadata.kind) throw new Error(`${relativePath} is missing id/title/kind`);
  const sourceUnitIds = metadata.source_unit_ids || [];
  for (const unitId of sourceUnitIds) if (!unitById.has(unitId)) throw new Error(`${relativePath} references unknown Unit ${unitId}`);
  const page = {
    id: metadata.id,
    title: metadata.title,
    kind: metadata.kind,
    order: Number(metadata.order || 0),
    parent: metadata.parent ?? null,
    status: metadata.status || "needs_review",
    visibility: metadata.visibility || "public",
    source_unit_ids: sourceUnitIds,
    source_authorities: [...new Set(sourceUnitIds.flatMap((unitId) => (unitById.get(unitId)?.source_refs || [unitById.get(unitId)?.source]).map((source) => source?.authority)).filter(Boolean))],
    unit_types: [...new Set(sourceUnitIds.map((unitId) => unitById.get(unitId)?.type).filter(Boolean))],
    source_refs: sourceUnitIds.flatMap((unitId) => {
      const unit = unitById.get(unitId);
      return (unit.source_refs || [unit.source]).map((source) => ({
        unit_id: unitId,
        source_id: source?.source_id,
        authority: source?.authority,
        chapter: source?.chapter,
        section: source?.section,
        pdf_pages: source?.pdf_pages || [],
        figures: source?.figures || [],
      }));
    }),
    search_terms: [...new Set(sourceUnitIds.flatMap((unitId) => {
      const unit = unitById.get(unitId);
      return [unit?.title, unit?.type, ...(unit?.source_refs || [unit?.source]).flatMap((source) => [source?.chapter, source?.section, source?.source_id]), ...(unit?.tags || []), ...(unit?.aliases || [])].filter(Boolean);
    }))],
    related_page_ids: metadata.id.startsWith("unit-")
      ? [...new Set(adjacentRelations.get(metadata.id.slice(5)) || [])].map((unitId) => `unit-${unitId}`)
      : metadata.related_page_ids || [],
    sections: relativePath.includes("/candidate/")
      ? parseSections(body)
      : metadata.id.startsWith("unit-") && sourceUnitIds.length === 1
        ? unitSections(unitById.get(sourceUnitIds[0]))
        : aggregateSections(sourceUnitIds),
    generation_source: relativePath.includes("/candidate/") ? "markdown_candidate" : "canonical_units",
    _relative_path: relativePath,
  };
  const linkedAssets = assetsForPage(page, imageRegistry.assets);
  page.primary_figures = linkedAssets.filter((asset) => asset.authority === "primary" && asset.figure_type === "original_source_excerpt").map(publicAsset);
  page.supplement_figures = linkedAssets.filter((asset) => asset.authority === "supplement" && asset.figure_type === "book_figure").map(publicAsset);
  page.supplement_source_images = linkedAssets.filter((asset) => asset.authority === "supplement" && asset.figure_type === "source_page_scan").map(publicAsset);
  // Compatibility fields remain empty so consumers cannot silently merge editions.
  page.figures = [];
  page.source_images = [];
  return page;
});
const allPageIds = new Set(parsedPages.map((page) => page.id));
const pages = parsedPages.filter((page) => page.visibility !== "hidden");

pages.sort((left, right) => {
  const priority = pagePriority(left._relative_path, left.id) - pagePriority(right._relative_path, right.id);
  if (priority) return priority;
  if (left.order !== right.order) return left.order - right.order;
  return left.id.localeCompare(right.id);
});
for (const page of pages) {
  delete page._relative_path;
  delete page.visibility;
}

const pageIds = new Set();
for (const page of pages) {
  if (pageIds.has(page.id)) throw new Error(`Duplicate page id: ${page.id}`);
  pageIds.add(page.id);
}
for (const page of pages) {
  for (const relatedId of page.related_page_ids) {
    if (!allPageIds.has(relatedId)) console.warn(`WARN ${page.id} references missing page ${relatedId}`);
  }
}

const chapterFiles = fs.readdirSync(path.join(knowledgeRoot, "chapters")).filter((name) => name.endsWith(".jsonl")).sort();
const chapters = chapterFiles.map((fileName) => ({
  id: fileName.replace(/\.jsonl$/, ""),
  unit_ids: readJsonl(path.join(knowledgeRoot, "chapters", fileName)).sort((left, right) => left.order - right.order).map((entry) => entry.unit_id),
}));

const data = {
  schema_version: 2,
  pages,
  roots,
  themes: taxonomy.roots,
  chapters,
  questions,
  relations,
  library,
  summary: {
    source: {
      source_id: manifest.source_id,
      pdf_pages: manifest.pdf_pages,
      authority: manifest.authority,
      coverage_rows: coverage.length,
      coverage_ok: coverage.filter((row) => row.status === "OK").length,
      coverage_needs_review: coverage.filter((row) => row.status === "NEEDS_REVIEW").length,
      source_present: fs.existsSync(manifest.path),
    },
    framework: {
      source_id: framework.source_id,
      title: framework.title,
      sha256: framework.sha256,
      source_file: path.basename(framework.path),
      read_only: framework.read_only,
    },
    knowledge: {
      units: units.length,
      relations: relations.length,
      questions: questions.length,
      chapters: chapters.length,
    },
    pages: {
      core: pages.filter((page) => page.kind === "core").length,
      candidate: pages.filter((page) => page.kind === "candidate").length,
      total: pages.length,
    },
  },
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(data)}\n`);
console.log(JSON.stringify({ output: path.relative(repositoryRoot, outputPath), pages: pages.length, units: units.length, relations: relations.length, questions: questions.length, library_books: library.books.length }, null, 2));
