import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pagesRoot = path.join(repositoryRoot, "knowledge/pages");

function markdownFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(filePath);
    return entry.isFile() && entry.name.endsWith(".md") ? [filePath] : [];
  });
}

let migrated = 0;
for (const filePath of markdownFiles(pagesRoot)) {
  const relativePath = path.relative(repositoryRoot, filePath);
  if (relativePath.includes("/candidate/")) continue;
  const source = fs.readFileSync(filePath, "utf8");
  if (!source.startsWith("---\n")) throw new Error(`${relativePath} is missing YAML front matter`);
  const end = source.indexOf("\n---\n", 4);
  if (end < 0) throw new Error(`${relativePath} has unterminated YAML front matter`);
  const frontMatter = source.slice(0, end + 5);
  const output = `${frontMatter}\n<!-- View configuration only. Body is generated from canonical Units by scripts/build-knowledge.mjs. -->\n`;
  if (source !== output) {
    fs.writeFileSync(filePath, output);
    migrated += 1;
  }
}

console.log(`Converted ${migrated} knowledge pages to Unit-backed view configurations; candidate pages were left unchanged`);
