import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(appRoot, "../..");
const knowledgeFile = path.join(repositoryRoot, "packages/knowledge/src/knowledge.json");
const knowledge = JSON.parse(fs.readFileSync(knowledgeFile, "utf8"));
const assetFields = ["primary_figures", "figures", "supplement_figures", "source_images", "supplement_source_images"];
const referencedImages = new Set();
const referencedBooks = new Set();

for (const page of knowledge.pages || []) {
  for (const field of assetFields) {
    for (const asset of page[field] || []) {
      if (asset?.asset_path) referencedImages.add(String(asset.asset_path).replace(/^\/+/, ""));
    }
  }
}
for (const book of knowledge.library?.books || []) {
  if (book?.pdf_path) referencedBooks.add(String(book.pdf_path).replace(/^\/+/, ""));
  if (book?.cover_path) referencedImages.add(String(book.cover_path).replace(/^\/+/, ""));
}

const missing = [];
for (const assetPath of [...referencedImages, ...referencedBooks].sort()) {
  if (!assetPath.startsWith("assets/") || assetPath.includes("..")) {
    missing.push(`${assetPath} (unsafe path)`);
    continue;
  }
  if (!fs.existsSync(path.join(repositoryRoot, assetPath))) missing.push(assetPath);
}

if (missing.length) {
  console.error(`Missing ${missing.length} of ${referencedImages.size + referencedBooks.size} referenced knowledge assets:`);
  for (const item of missing) console.error(`- ${item}`);
  process.exitCode = 1;
} else {
  console.log(`Verified ${referencedImages.size} knowledge image references and ${referencedBooks.size} book PDFs; no files are missing.`);
}

const productionOrigin = String(process.env.KNOWLEDGE_ASSET_CHECK_ORIGIN || "").replace(/\/$/, "");
if (productionOrigin && (referencedImages.size || referencedBooks.size) && !process.exitCode) {
  const images = [...referencedImages].sort();
  const sampleSize = Math.min(12, images.length);
  const imageSample = Array.from({ length: sampleSize }, (_, index) => images[Math.floor(index * (images.length - 1) / Math.max(1, sampleSize - 1))]);
  const assets = [
    ...imageSample.map((assetPath) => ({ assetPath, mime: "image/" })),
    ...[...referencedBooks].sort().map((assetPath) => ({ assetPath, mime: "application/pdf" })),
  ];
  const failures = [];
  for (const { assetPath, mime } of assets) {
    const response = await fetch(`${productionOrigin}/${assetPath}`, {
      headers: { range: "bytes=0-31", accept: mime === "application/pdf" ? "application/pdf" : "image/*" },
      signal: AbortSignal.timeout(15_000),
    }).catch((error) => ({ ok: false, status: 0, headers: new Headers(), error }));
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.toLowerCase().startsWith(mime)) {
      failures.push(`${assetPath}: HTTP ${response.status}, ${contentType || "missing MIME"}`);
    }
  }
  if (failures.length) {
    console.error("Production knowledge asset sample failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(`Verified ${imageSample.length} production image URLs and ${referencedBooks.size} production book PDFs with expected MIME types.`);
  }
}
