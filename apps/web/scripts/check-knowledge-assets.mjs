import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(appRoot, "../..");
const knowledgeFile = path.join(repositoryRoot, "packages/knowledge/src/knowledge.json");
const knowledge = JSON.parse(fs.readFileSync(knowledgeFile, "utf8"));
const assetFields = ["primary_figures", "figures", "supplement_figures", "source_images", "supplement_source_images"];
const referenced = new Set();

for (const page of knowledge.pages || []) {
  for (const field of assetFields) {
    for (const asset of page[field] || []) {
      if (asset?.asset_path) referenced.add(String(asset.asset_path).replace(/^\/+/, ""));
    }
  }
}

const missing = [];
for (const assetPath of [...referenced].sort()) {
  if (!assetPath.startsWith("assets/") || assetPath.includes("..")) {
    missing.push(`${assetPath} (unsafe path)`);
    continue;
  }
  if (!fs.existsSync(path.join(repositoryRoot, assetPath))) missing.push(assetPath);
}

if (missing.length) {
  console.error(`Missing ${missing.length} of ${referenced.size} referenced knowledge assets:`);
  for (const item of missing) console.error(`- ${item}`);
  process.exitCode = 1;
} else {
  console.log(`Verified ${referenced.size} unique knowledge image references; no files are missing.`);
}

const productionOrigin = String(process.env.KNOWLEDGE_ASSET_CHECK_ORIGIN || "").replace(/\/$/, "");
if (productionOrigin && referenced.size && !process.exitCode) {
  const assets = [...referenced].sort();
  const sampleSize = Math.min(12, assets.length);
  const sample = Array.from({ length: sampleSize }, (_, index) => assets[Math.floor(index * (assets.length - 1) / Math.max(1, sampleSize - 1))]);
  const failures = [];
  for (const assetPath of sample) {
    const response = await fetch(`${productionOrigin}/${assetPath}`, {
      headers: { range: "bytes=0-31", accept: "image/*" },
      signal: AbortSignal.timeout(15_000),
    }).catch((error) => ({ ok: false, status: 0, headers: new Headers(), error }));
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.toLowerCase().startsWith("image/")) {
      failures.push(`${assetPath}: HTTP ${response.status}, ${contentType || "missing MIME"}`);
    }
  }
  if (failures.length) {
    console.error("Production knowledge asset sample failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(`Verified ${sample.length} production image URLs with image MIME types.`);
  }
}
