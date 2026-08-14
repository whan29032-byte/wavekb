import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(appRoot, "../..");
const publicAssets = path.join(appRoot, "public/assets");
const assetDirectories = ["source-pages", "figures", "figures-v10"];

fs.mkdirSync(publicAssets, { recursive: true });

for (const directory of assetDirectories) {
  const source = path.join(repositoryRoot, "assets", directory);
  const destination = path.join(publicAssets, directory);
  if (!fs.existsSync(source)) throw new Error(`Missing legacy asset directory: ${source}`);
  fs.cpSync(source, destination, { recursive: true, force: true, preserveTimestamps: true });
}

const motiveWave = path.join(repositoryRoot, "community/blackgold-motive-wave.svg");
if (fs.existsSync(motiveWave)) {
  fs.copyFileSync(motiveWave, path.join(publicAssets, "blackgold-motive-wave.svg"));
}

console.log(`Synchronized legacy knowledge assets into ${publicAssets}.`);
