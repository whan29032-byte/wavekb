import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  assertPinnedReadingImageSource, assertReadingImageProof, collectReadingImageSources,
  createReadingImageManifest, createReadingImageSizes, deriveReadingImage, readingImageEncoder, readingImageSizeScript, sha256,
} from "../apps/web/scripts/lib/reading-images.mjs";

const appRequire = createRequire(new URL("../apps/web/package.json", import.meta.url));
const sharp = appRequire("sharp");
const root = path.resolve(import.meta.dirname, "..");
const fixture = { asset_path: "assets/books/sample/figure-p005.png", width: 24, height: 18 };

test("collects only existing reading references and deduplicates consistent provenance", () => {
  const sources = collectReadingImageSources({ pages: [{ primary_figures: [fixture], supplement_figures: [fixture] }], library: { books: [{ cover_path: "assets/books/sample/cover.png", text_pages: [{ illustrations: [fixture] }] }] } });
  assert.deepEqual(sources, [{ source_path: "assets/books/sample/cover.png" }, { source_path: fixture.asset_path, width: 24, height: 18 }]);
  for (const asset_path of ["assets/books/sample/../secret.png", "https://example.com/image.png", "assets/books/sample/figure.jpg", "assets/books//figure.png", "assets/books/sample/./figure.png"]) {
    assert.throws(() => collectReadingImageSources({ pages: [{ figures: [{ ...fixture, asset_path }] }] }), /Unsafe/);
  }
  assert.throws(() => collectReadingImageSources({ pages: [{ figures: [fixture, { ...fixture, width: 25 }] }] }), /Conflicting/);
});

test("derivation is native-size lossless, content-addressed and preserves original bytes", async () => {
  const source = collectReadingImageSources({ pages: [{ figures: [fixture] }] })[0];
  const original = await sharp({ create: { width: 24, height: 18, channels: 3, background: { r: 26, g: 119, b: 233 } } }).png().toBuffer();
  const originalHash = sha256(original);
  const result = await deriveReadingImage(source, original);
  assert.equal(sha256(original), originalHash);
  assert.equal(result.proof.source_sha256, originalHash);
  assert.equal(result.proof.webp_sha256, sha256(result.bytes));
  assert.equal(result.proof.url, `/assets/reading-images/${sha256(result.bytes)}.webp`);
  assert.equal(result.proof.width, 24);
  assert.equal(result.proof.height, 18);
  assert.deepEqual(await sharp(result.bytes).ensureAlpha().raw().toBuffer(), await sharp(original).ensureAlpha().raw().toBuffer());
  assert.deepEqual(createReadingImageManifest([result.proof]), { [`/${fixture.asset_path}`]: result.proof.url });
  await assert.rejects(deriveReadingImage({ ...source, width: 25 }, original), /width mismatch/);
  await assert.rejects(deriveReadingImage({ ...source, source_sha256: "a".repeat(64) }, original), /provenance/);
  await assert.rejects(deriveReadingImage(source, Buffer.from("not PNG")), /not PNG/);
});

test("normal builds cannot silently accept changed sources, pixels, dimensions or encoded bytes", () => {
  const source = { source_path: fixture.asset_path };
  const bytes = Buffer.from("source bytes");
  const expected = { source_path: fixture.asset_path, source_sha256: sha256(bytes), pixel_sha256: "a".repeat(64), width: 24, height: 18, webp_sha256: "b".repeat(64) };
  assertPinnedReadingImageSource(source, bytes, expected);
  assert.throws(() => assertPinnedReadingImageSource(source, Buffer.from("changed"), expected), /explicit reviewed/);
  assert.throws(() => assertPinnedReadingImageSource(source, bytes, undefined), /explicit reviewed/);
  assertReadingImageProof(expected, expected);
  for (const change of [{ width: 25 }, { pixel_sha256: "c".repeat(64) }, { webp_sha256: "c".repeat(64) }]) {
    assert.throws(() => assertReadingImageProof({ ...expected, ...change }, expected), /explicit reviewed/);
  }
  assert.throws(() => createReadingImageManifest([{ ...expected, url: "/assets/reading-images/unhashed.webp" }]), /Invalid/);
});

test("worker sizes come only from complete content-addressed verified metadata", () => {
  const hash = "a".repeat(64);
  const proof = { source_path: fixture.asset_path, webp_sha256: hash, webp_bytes: 404664, url: `/assets/reading-images/${hash}.webp` };
  assert.deepEqual(createReadingImageSizes([proof, proof]), { [hash]: 404664 });
  for (const webp_bytes of [0, -1, 1.2, Number.MAX_SAFE_INTEGER + 1, "404664", undefined]) {
    assert.throws(() => createReadingImageSizes([{ ...proof, webp_bytes }]), /Invalid/);
  }
  assert.throws(() => createReadingImageSizes([proof, { ...proof, webp_bytes: 404665 }]), /conflicting/);
  assert.throws(() => createReadingImageSizes([{ ...proof, url: "/assets/original.png" }]), /Invalid/);
  const scope = {};
  new Function("self", readingImageSizeScript([proof]))(scope);
  assert.deepEqual(scope.WaveKBReadingImageSizes, { [hash]: 404664 });
  assert.equal(Object.isFrozen(scope.WaveKBReadingImageSizes), true);
});

test("checked-in manifest covers exactly the current references with unchanged source hashes and dimensions", async () => {
  const knowledge = JSON.parse(fs.readFileSync(path.join(root, "packages/knowledge/src/knowledge.json"), "utf8"));
  const sources = collectReadingImageSources(knowledge);
  const integrity = JSON.parse(fs.readFileSync(path.join(root, "knowledge/reading/image-delivery-integrity.json"), "utf8"));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "apps/web/src/lib/knowledge/generated-reading-images.json"), "utf8"));
  assert.equal(sources.length, 420);
  assert.deepEqual(integrity.encoder, readingImageEncoder);
  assert.deepEqual(integrity.assets.map((asset) => asset.source_path), sources.map((source) => source.source_path));
  assert.deepEqual(manifest, createReadingImageManifest(integrity.assets));
  const workerSource = fs.readFileSync(path.join(root, "apps/web/public/sw.js"), "utf8");
  const projection = workerSource.match(/\/\* BEGIN VERIFIED READING IMAGE SIZES \*\/[\s\S]*?\/\* END VERIFIED READING IMAGE SIZES \*\//)?.[0];
  assert.equal(projection, readingImageSizeScript(integrity.assets));
  assert.ok(workerSource.indexOf(projection) < workerSource.indexOf("importScripts("));
  // Unit contracts run before assets:sync in a clean checkout. Derive actual
  // bytes in memory from the pinned original rather than trusting a leftover
  // build artifact (or skipping validation when that artifact is absent).
  let next = 0;
  async function verifySource() {
    while (next < sources.length) {
      const index = next++;
      const source = sources[index];
      const original = fs.readFileSync(path.join(root, source.source_path));
      assertPinnedReadingImageSource(source, original, integrity.assets[index]);
      const result = await deriveReadingImage(source, original);
      assertReadingImageProof(result.proof, integrity.assets[index]);
      assert.equal(result.bytes.byteLength, integrity.assets[index].webp_bytes);
      assert.equal(sha256(result.bytes), integrity.assets[index].webp_sha256);
    }
  }
  await Promise.all(Array.from({ length: 4 }, verifySource));
});
