import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(repositoryRoot, "index.html");
const outputPath = path.join(repositoryRoot, "packages/knowledge/src/knowledge.json");
const html = fs.readFileSync(sourcePath, "utf8");
const match = html.match(/<script type="application\/json" id="elliott-kb-data">([\s\S]*?)<\/script>/);

if (!match) throw new Error("index.html does not contain elliott-kb-data");

const data = JSON.parse(match[1]);
if (!Array.isArray(data.pages) || !Array.isArray(data.roots)) throw new Error("knowledge data has an invalid shape");

const ids = new Set();
for (const page of data.pages) {
  if (!page.id || ids.has(page.id)) throw new Error(`duplicate or missing knowledge id: ${page.id}`);
  ids.add(page.id);
}

if (data.summary?.framework?.path) {
  data.summary.framework.source_file = path.basename(data.summary.framework.path);
  delete data.summary.framework.path;
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(data)}\n`);
console.log(`Extracted ${data.pages.length} knowledge pages to ${path.relative(repositoryRoot, outputPath)}`);
