import { createHash } from "node:crypto";
import sharp from "sharp";

const sourcePathPattern = /^assets\/(?:source-pages|figures|figures-v10|books)\/[a-z0-9/-]+\.png$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const assetFields = ["primary_figures", "figures", "supplement_figures", "source_images", "supplement_source_images"];

export const readingImageEncoder = Object.freeze({ sharp: "0.35.5", format: "webp", lossless: true, effort: 6 });
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// This is a presentation-only projection. Source paths, metadata and files are
// never rewritten; include only images already referenced by the reading data.
export function collectReadingImageSources(knowledge) {
  const sources = new Map();
  function add(value) {
    const asset = typeof value === "string" ? { asset_path: value } : value;
    if (!asset?.asset_path) return;
    const sourcePath = String(asset.asset_path).replace(/^\//, "");
    if (!sourcePathPattern.test(sourcePath) || sourcePath.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
      throw new Error(`Unsafe or unsupported reading image path: ${sourcePath}`);
    }
    const incoming = { source_path: sourcePath };
    for (const field of ["width", "height"]) {
      if (asset[field] === undefined) continue;
      if (!Number.isInteger(asset[field]) || asset[field] < 1) throw new Error(`Invalid reading image ${field}: ${sourcePath}`);
      incoming[field] = asset[field];
    }
    if (asset.asset_sha256 !== undefined) {
      if (!sha256Pattern.test(asset.asset_sha256)) throw new Error(`Invalid reading image source SHA-256: ${sourcePath}`);
      incoming.source_sha256 = asset.asset_sha256;
    }
    const existing = sources.get(sourcePath) || { source_path: sourcePath };
    for (const field of ["width", "height", "source_sha256"]) {
      if (incoming[field] !== undefined && existing[field] !== undefined && incoming[field] !== existing[field]) {
        throw new Error(`Conflicting reading image ${field}: ${sourcePath}`);
      }
    }
    sources.set(sourcePath, { ...existing, ...incoming });
  }
  for (const page of knowledge.pages || []) {
    for (const field of assetFields) for (const asset of page[field] || []) add(asset);
  }
  for (const book of knowledge.library?.books || []) {
    add(book.cover_path);
    for (const page of book.text_pages || []) {
      add(page.source_image);
      for (const figure of page.illustrations || []) add(figure);
    }
  }
  return [...sources.values()].sort((left, right) => left.source_path.localeCompare(right.source_path, "en"));
}

export function assertPinnedReadingImageSource(source, bytes, expected) {
  if (!expected || expected.source_path !== source.source_path || sha256(bytes) !== expected.source_sha256) {
    throw new Error(`Reading image source changed; explicit reviewed manifest update required: ${source.source_path}`);
  }
}

export async function deriveReadingImage(source, sourceBytes) {
  if (sharp.versions.sharp !== readingImageEncoder.sharp) throw new Error("Reading image encoder version mismatch");
  const sourceSha256 = sha256(sourceBytes);
  if (source.source_sha256 && source.source_sha256 !== sourceSha256) throw new Error(`Reading image provenance SHA-256 mismatch: ${source.source_path}`);
  if (!sourceBytes.subarray(0, 8).equals(pngSignature)) throw new Error(`Reading image is not PNG: ${source.source_path}`);
  const original = sharp(sourceBytes);
  const metadata = await original.metadata();
  if (metadata.format !== "png" || (metadata.pages || 1) !== 1 || !metadata.width || !metadata.height) {
    throw new Error(`Unsupported reading image: ${source.source_path}`);
  }
  for (const field of ["width", "height"]) {
    if (source[field] !== undefined && source[field] !== metadata[field]) throw new Error(`Reading image source ${field} mismatch: ${source.source_path}`);
  }
  const originalPixels = await original.clone().ensureAlpha().raw().toBuffer();
  const webp = await original.clone().webp({ lossless: true, effort: readingImageEncoder.effort }).toBuffer();
  const derived = sharp(webp);
  const derivedMetadata = await derived.metadata();
  const derivedPixels = await derived.clone().ensureAlpha().raw().toBuffer();
  if (derivedMetadata.format !== "webp" || metadata.width !== derivedMetadata.width || metadata.height !== derivedMetadata.height
    || !originalPixels.equals(derivedPixels)) {
    throw new Error(`Reading image derivative is not native-size pixel-identical: ${source.source_path}`);
  }
  const webpSha256 = sha256(webp);
  return {
    bytes: webp,
    proof: {
      source_path: source.source_path,
      source_sha256: sourceSha256,
      pixel_sha256: sha256(originalPixels),
      width: metadata.width,
      height: metadata.height,
      source_bytes: sourceBytes.length,
      webp_bytes: webp.length,
      webp_sha256: webpSha256,
      url: `/assets/reading-images/${webpSha256}.webp`,
    },
  };
}

export function createReadingImageManifest(proofs) {
  const manifest = {};
  for (const proof of proofs) {
    if (!sourcePathPattern.test(proof.source_path) || !sha256Pattern.test(proof.webp_sha256)
      || proof.url !== `/assets/reading-images/${proof.webp_sha256}.webp` || manifest[`/${proof.source_path}`]) {
      throw new Error(`Invalid or duplicate reading image proof: ${proof.source_path}`);
    }
    manifest[`/${proof.source_path}`] = proof.url;
  }
  return manifest;
}

// Static source-verified lengths remove a serial network probe. The hash still
// names the complete bytes; this is not a license to skip response/SHA checks.
export function createReadingImageSizes(proofs) {
  const sizes = {};
  for (const proof of proofs) {
    if (!sha256Pattern.test(proof.webp_sha256) || proof.url !== `/assets/reading-images/${proof.webp_sha256}.webp`
      || !Number.isSafeInteger(proof.webp_bytes) || proof.webp_bytes <= 0
      || (sizes[proof.webp_sha256] !== undefined && sizes[proof.webp_sha256] !== proof.webp_bytes)) {
      throw new Error(`Invalid or conflicting reading image size: ${proof.source_path}`);
    }
    sizes[proof.webp_sha256] = proof.webp_bytes;
  }
  return Object.fromEntries(Object.entries(sizes).sort(([left], [right]) => left.localeCompare(right, "en")));
}

export function readingImageSizeScript(proofs) {
  return `/* BEGIN VERIFIED READING IMAGE SIZES */\nself.WaveKBReadingImageSizes = Object.freeze(${JSON.stringify(createReadingImageSizes(proofs))});\n/* END VERIFIED READING IMAGE SIZES */`;
}

export function assertReadingImageProof(actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Reading image delivery proof changed; explicit reviewed manifest update required: ${actual.source_path}`);
  }
}
