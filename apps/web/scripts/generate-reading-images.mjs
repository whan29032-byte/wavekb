import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertPinnedReadingImageSource, assertReadingImageProof, collectReadingImageSources,
  createReadingImageManifest, deriveReadingImage, readingImageEncoder, readingImageSizeScript, sha256,
} from "./lib/reading-images.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(appRoot, "../..");
const manifestPath = path.join(appRoot, "src/lib/knowledge/generated-reading-images.json");
const integrityPath = path.join(repositoryRoot, "knowledge/reading/image-delivery-integrity.json");
const outputDirectory = path.join(appRoot, "public/assets/reading-images");
const workerPath = path.join(appRoot, "public/sw.js");
const updateManifest = process.argv.includes("--update-manifest");
if (process.argv.slice(2).some((argument) => argument !== "--update-manifest")) throw new Error("Unknown reading image generation argument");
const start = performance.now();
const sources = collectReadingImageSources(JSON.parse(fs.readFileSync(path.join(repositoryRoot, "packages/knowledge/src/knowledge.json"), "utf8")));
if (!sources.length) throw new Error("No referenced reading images to generate");

let expected = new Map();
if (!updateManifest) {
  const pinned = JSON.parse(fs.readFileSync(integrityPath, "utf8"));
  if (pinned.schema_version !== 1 || JSON.stringify(pinned.encoder) !== JSON.stringify(readingImageEncoder) || !Array.isArray(pinned.assets)) {
    throw new Error("Reading image delivery integrity schema or encoder mismatch");
  }
  expected = new Map(pinned.assets.map((asset) => [asset.source_path, asset]));
  if (expected.size !== pinned.assets.length || expected.size !== sources.length || sources.some((source) => !expected.has(source.source_path))) {
    throw new Error("Reading image source set changed; explicit reviewed manifest update required");
  }
}

fs.mkdirSync(outputDirectory, { recursive: true });
if (fs.realpathSync(outputDirectory) !== outputDirectory) throw new Error("Unsafe generated reading image directory");
const results = new Array(sources.length);
let index = 0;
async function worker() {
  while (index < sources.length) {
    const position = index++;
    const source = sources[position];
    const sourcePath = path.join(repositoryRoot, source.source_path);
    if (fs.realpathSync(sourcePath) !== sourcePath || !fs.lstatSync(sourcePath).isFile()) throw new Error(`Unsafe reading image source: ${source.source_path}`);
    const bytes = fs.readFileSync(sourcePath);
    if (!updateManifest) assertPinnedReadingImageSource(source, bytes, expected.get(source.source_path));
    const result = await deriveReadingImage(source, bytes);
    if (!updateManifest) assertReadingImageProof(result.proof, expected.get(source.source_path));
    // Never substitute an optimized image at the original PNG route. Both the
    // original source and its public copy must still be the exact source bytes.
    if (sha256(fs.readFileSync(sourcePath)) !== result.proof.source_sha256) throw new Error(`Reading image changed during generation: ${source.source_path}`);
    const publicSource = path.join(appRoot, "public", source.source_path);
    if (sha256(fs.readFileSync(publicSource)) !== result.proof.source_sha256) throw new Error(`Public original PNG differs: ${source.source_path}`);
    const destination = path.join(outputDirectory, `${result.proof.webp_sha256}.webp`);
    if (fs.existsSync(destination) && (fs.lstatSync(destination).isSymbolicLink() || !fs.lstatSync(destination).isFile())) {
      throw new Error(`Unsafe reading image derivative: ${destination}`);
    }
    fs.writeFileSync(destination, result.bytes);
    if (sha256(fs.readFileSync(destination)) !== result.proof.webp_sha256) throw new Error(`Written reading image hash mismatch: ${source.source_path}`);
    results[position] = result.proof;
  }
}
await Promise.all(Array.from({ length: Math.min(4, sources.length) }, () => worker()));
const manifest = createReadingImageManifest(results);
if (updateManifest) {
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
  fs.writeFileSync(integrityPath, `${JSON.stringify({ schema_version: 1, encoder: readingImageEncoder, assets: results }, null, 2)}\n`);
} else if (JSON.stringify(JSON.parse(fs.readFileSync(manifestPath, "utf8"))) !== JSON.stringify(manifest)) {
  throw new Error("Reading image client manifest differs from verified derivatives");
}
const workerSource = fs.readFileSync(workerPath, "utf8");
const sizeProjection = /\/\* BEGIN VERIFIED READING IMAGE SIZES \*\/[\s\S]*?\/\* END VERIFIED READING IMAGE SIZES \*\//g;
if ([...workerSource.matchAll(sizeProjection)].length !== 1) throw new Error("Missing or duplicate verified worker image-size projection");
// Publish the unchanged public policy and byte-verification helper in the same
// worker response, rather than two serial importScripts network round trips.
const helperProjection = /\/\* BEGIN BUNDLED PUBLIC WORKER HELPERS \*\/[\s\S]*?\/\* END BUNDLED PUBLIC WORKER HELPERS \*\//g;
if ([...workerSource.matchAll(helperProjection)].length !== 1) throw new Error("Missing or duplicate public worker helper projection");
const helpers = ["sw-policy.js", "sw-reading-images.js"].map((name) => fs.readFileSync(path.join(appRoot, "public", name), "utf8")).join("\n");
const helperBundle = `/* BEGIN BUNDLED PUBLIC WORKER HELPERS */\n${helpers}\n/* END BUNDLED PUBLIC WORKER HELPERS */`;
fs.writeFileSync(workerPath, workerSource.replace(sizeProjection, readingImageSizeScript(results)).replace(helperProjection, () => helperBundle));
const originalBytes = results.reduce((sum, asset) => sum + asset.source_bytes, 0);
const derivedBytes = results.reduce((sum, asset) => sum + asset.webp_bytes, 0);
console.log(`Verified ${results.length} native-size, pixel-identical WebP reading images: ${originalBytes} -> ${derivedBytes} bytes (${((1 - derivedBytes / originalBytes) * 100).toFixed(2)}% less); originals unchanged; ${(performance.now() - start).toFixed(0)} ms.`);
