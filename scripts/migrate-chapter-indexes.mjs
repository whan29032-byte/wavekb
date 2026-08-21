import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chaptersRoot = path.join(repositoryRoot, "knowledge/chapters");
for (const fileName of fs.readdirSync(chaptersRoot).filter((name) => name.endsWith(".jsonl")).sort()) {
  const filePath = path.join(chaptersRoot, fileName);
  const rows = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const indexes = rows.map((row, index) => ({ unit_id: row.unit_id || row.id, order: (index + 1) * 10 }));
  if (indexes.some((row) => !row.unit_id)) throw new Error(`${fileName} contains a row without unit id`);
  fs.writeFileSync(filePath, `${indexes.map((row) => JSON.stringify(row)).join("\n")}\n`);
  console.log(`${fileName}: ${indexes.length} Unit references`);
}
