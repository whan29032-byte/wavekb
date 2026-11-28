import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(appRoot, "../..");
const knowledgeFile = path.join(repositoryRoot, "packages/knowledge/src/knowledge.json");
const knowledge = JSON.parse(fs.readFileSync(knowledgeFile, "utf8"));
const assetFields = ["primary_figures", "figures", "supplement_figures", "source_images", "supplement_source_images"];
const referencedImages = new Set();
const referencedBooks = new Set();
const illustratedBookImages = new Set();

const transientTransport = new Set([
  "TimeoutError", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_SOCKET",
  "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH",
]);

async function probeAsset(url, mime, deadline) {
  for (let attempt = 1; ; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { ok: false, status: 0, contentType: "", transport: "PROBE_DEADLINE" };
    let response;
    try {
      response = await fetch(url, {
        headers: { range: "bytes=0-31", accept: mime === "application/pdf" ? "application/pdf" : "image/*" },
        signal: AbortSignal.timeout(Math.min(15_000, remaining)),
      });
    } catch (error) {
      const causes = Array.isArray(error?.cause?.errors) ? error.cause.errors : [];
      const codes = [error?.cause?.code, error?.code, ...causes.map((cause) => cause?.code), error?.name];
      const transient = codes.find((code) => transientTransport.has(code));
      if (transient && attempt < 3) {
        await delay(Math.min(250 * attempt, Math.max(0, deadline - Date.now())));
        continue;
      }
      const code = transient || codes.find((value) => typeof value === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value)) || "unknown";
      return { ok: false, status: 0, contentType: "", transport: `${code}; ${attempt} attempt(s)` };
    }

    const contentType = response.headers.get("content-type") || "";
    // The probe needs only status and headers; release the connection if a
    // server ignores Range and sends the full image or PDF instead.
    await response.body?.cancel().catch(() => undefined);
    return { ok: response.ok, status: response.status, contentType };
  }
}

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
  for (const page of book.text_pages || []) {
    if (page.source_image?.asset_path) referencedImages.add(page.source_image.asset_path);
    for (const figure of page.illustrations || []) {
      if (figure?.asset_path) {
        referencedImages.add(figure.asset_path);
        illustratedBookImages.add(figure.asset_path);
      }
    }
  }
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
  const imageSample = [...new Set([...Array.from({ length: sampleSize }, (_, index) => images[Math.floor(index * (images.length - 1) / Math.max(1, sampleSize - 1))]), ...illustratedBookImages])];
  const assets = [
    ...imageSample.map((assetPath) => ({ assetPath, mime: "image/" })),
    ...[...referencedBooks].sort().map((assetPath) => ({ assetPath, mime: "application/pdf" })),
  ];
  const failures = [];
  // This runs after activation, so leave a bounded window for the rollback.
  const deadline = Date.now() + 90_000;
  for (const { assetPath, mime } of assets) {
    const result = await probeAsset(`${productionOrigin}/${assetPath}`, mime, deadline);
    if (!result.ok || !result.contentType.toLowerCase().startsWith(mime)) {
      failures.push(`${assetPath}: HTTP ${result.status}, ${result.contentType || "missing MIME"}${result.transport ? ` (${result.transport})` : ""}`);
      if (result.transport) break;
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
