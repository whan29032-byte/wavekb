import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = path.resolve(process.argv[2] || path.join(repositoryRoot, "packages/knowledge/src/knowledge.json"));
const outputPath = path.resolve(process.argv[3] || path.join(repositoryRoot, "knowledge/images/registry.json"));
const compiled = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const byPath = new Map();

function classification(assetPath) {
  if (assetPath.startsWith("assets/figures-v10/")) {
    return { source_id: "ewp-10-zh-2016", edition: 10, authority: "primary", figure_type: "original_source_excerpt" };
  }
  if (assetPath.startsWith("assets/figures/")) {
    return { source_id: "ewp-11-zh-2021", edition: 11, authority: "supplement", figure_type: "book_figure" };
  }
  if (assetPath.startsWith("assets/source-pages/")) {
    return { source_id: "ewp-11-zh-2021", edition: 11, authority: "supplement", figure_type: "source_page_scan" };
  }
  throw new Error(`Unknown knowledge asset namespace: ${assetPath}`);
}

for (const page of compiled.pages || []) {
  for (const field of ["primary_figures", "figures", "supplement_figures", "source_images"]) {
    for (const asset of page[field] || []) {
      if (!asset.asset_path) continue;
      const existing = byPath.get(asset.asset_path) || {
        id: `image-${asset.asset_path.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}`,
        asset_path: asset.asset_path,
        ...classification(asset.asset_path),
        source_page: asset.pdf_page ?? null,
        book_pages: [],
        figure_nos: [],
        caption: "",
        width: asset.width,
        height: asset.height,
        bytes: asset.bytes,
        unit_ids: [],
      };
      existing.book_pages = [...new Set([...existing.book_pages, ...(asset.book_pages || [])])].sort((a, b) => a - b);
      existing.figure_nos = [...new Set([...existing.figure_nos, ...(asset.figure_nos || []), ...(asset.figure_ids || [])])].sort();
      existing.unit_ids = [...new Set([...existing.unit_ids, ...(asset.unit_ids || [])])].sort();
      if (!existing.caption) {
        existing.caption = existing.figure_nos.length
          ? existing.figure_nos.join("、")
          : `${existing.edition === 10 ? "第10版" : "第11版"} PDF 第${existing.source_page}页`;
      }
      byPath.set(asset.asset_path, existing);
    }
  }
}

const assets = [...byPath.values()].sort((left, right) => left.asset_path.localeCompare(right.asset_path));
const ids = new Set();
for (const asset of assets) {
  if (ids.has(asset.id)) throw new Error(`Duplicate image id: ${asset.id}`);
  ids.add(asset.id);
  if (!fs.existsSync(path.join(repositoryRoot, asset.asset_path))) throw new Error(`Missing image file: ${asset.asset_path}`);
}

const registry = {
  schema_version: 1,
  policy: "第10版原书摘录为 primary；第11版图示与来源页为 supplement。所有页面按 Unit ID 投影，不按章节机械堆图。",
  assets,
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(registry, null, 2)}\n`);
console.log(JSON.stringify({ output: path.relative(repositoryRoot, outputPath), assets: assets.length }, null, 2));
