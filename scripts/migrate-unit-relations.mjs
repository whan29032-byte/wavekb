import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const unitsPath = path.join(repositoryRoot, "knowledge/units/all.jsonl");
const units = fs.readFileSync(unitsPath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
for (const unit of units) delete unit.relations;
fs.writeFileSync(unitsPath, `${units.map((unit) => JSON.stringify(unit)).join("\n")}\n`);
console.log(`Removed duplicated relation projections from ${units.length} Units; knowledge/structure/relations.jsonl is canonical`);
