import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync } from "node:zlib";
import { inspectVisionImage, stripVisionMetadata } from "../src/research/vision-image-format.ts";
import { normalizeVisionImageIds, VISION_MAX_BYTES, VISION_MAX_IMAGES } from "../src/research/vision-input.ts";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWPgUbLgUbJgQKEAGCcCZRaxQyQAAAAASUVORK5CYII=";
const JPEG = "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAADAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCfAFEB/9k=";
const PROGRESSIVE_JPEG = "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wgARCAADAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUAQEAAAAAAAAAAAAAAAAAAAAD/9oADAMBAAIQAxAAAAGZhD//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAn//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/AX//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/AX//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/An//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IX//2gAMAwEAAgADAAAAEPf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==";
const WEBP = "UklGRjAAAABXRUJQVlA4ICQAAABQAQCdASoCAAMAAUAmJQBOgC6gAP77LkvF3YjjJ4dVU9ffoAA=";
const LOSSLESS_WEBP = "UklGRh4AAABXRUJQVlA4TBEAAAAvAYAAEAdQkTIUp4CBiOh/AAA=";
const ALPHA_WEBP = "UklGRlIAAABXRUJQVlA4WAoAAAAQAAAAAQAAAgAAQUxQSAcAAAAAgICAgICAAFZQOCAkAAAAUAEAnQEqAgADAAFAJiUAToAuoAD++y5Lxd2I4yeHVVPX36AA";
const bad = (error: any) => error.message === "invalid_image_input" && error.code === "invalid_image_input";
function crc(bytes: Uint8Array) {
  let value = 0xffffffff;
  for (const byte of bytes) { value ^= byte; for (let b = 0; b < 8; b++) value = value >>> 1 ^ ((value & 1) ? 0xedb88320 : 0); }
  return (value ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, body: Uint8Array) {
  const result = Buffer.alloc(body.length + 12); result.writeUInt32BE(body.length); result.write(type, 4); Buffer.from(body).copy(result, 8);
  result.writeUInt32BE(crc(result.subarray(4, -4)), result.length - 4); return result;
}
function makePng(width: number, height: number, raw = Buffer.alloc(height * (width * 3 + 1))) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}

test("browser-safe IDs are bounded, canonical, distinct and independent of caller mutations", () => {
  const ids = ["11111111-1111-4111-8111-111111111111", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"];
  assert.equal(VISION_MAX_IMAGES, 3); assert.equal(VISION_MAX_BYTES, 2 * 1024 * 1024);
  assert.deepEqual(normalizeVisionImageIds(undefined), []); assert.deepEqual(normalizeVisionImageIds([]), []);
  const normalized = normalizeVisionImageIds([ids[0], ids[1]!.toUpperCase()]); assert.deepEqual(normalized, ids);
  normalized.pop(); assert.equal(ids.length, 2);
  for (const input of [null, {}, "image", [ids[0], ids[0]], [ids[1], ids[1]!.toUpperCase()], ["https://example.invalid"], ["../image.png"], [123], new Array(1), [...ids, ids[0], ids[1]]]) {
    assert.throws(() => normalizeVisionImageIds(input), bad);
  }
  let accessed = false; const getter: unknown[] = []; Object.defineProperty(getter, 0, { get() { accessed = true; return ids[0]; } });
  assert.throws(() => normalizeVisionImageIds(getter), bad); assert.equal(accessed, false);
  const extra = [ids[0]]; Object.defineProperty(extra, "private", { value: "metadata" }); assert.throws(() => normalizeVisionImageIds(extra), bad);
});

for (const [base64, mimeType] of [[PNG, "image/png"], [JPEG, "image/jpeg"], [PROGRESSIVE_JPEG, "image/jpeg"], [WEBP, "image/webp"], [LOSSLESS_WEBP, "image/webp"], [ALPHA_WEBP, "image/webp"]]) {
  test(`real ${mimeType} encoded raster returns its dimensions`, () => {
    assert.deepEqual(inspectVisionImage(Buffer.from(base64!, "base64")), { mimeType, width: 2, height: 3 });
  });
}
test("every truncated valid-file prefix fails with a fixed safe error", () => {
  for (const base64 of [PNG, JPEG, PROGRESSIVE_JPEG, WEBP, LOSSLESS_WEBP, ALPHA_WEBP]) {
    const bytes = Buffer.from(base64, "base64");
    for (let end = 0; end < bytes.length; end++) assert.throws(() => inspectVisionImage(bytes.subarray(0, end)), bad);
    assert.throws(() => inspectVisionImage(Buffer.concat([bytes, Buffer.from([0])])), bad);
  }
});
test("rejects non-raster, empty, oversized and header-only fake images", () => {
  for (const bytes of [Buffer.from("<svg><script>private</script></svg>"), Buffer.from("GIF89a synthetic"), Buffer.alloc(0), Buffer.alloc(VISION_MAX_BYTES + 1), Buffer.from("FFD8FFC00011080003000203012200021101031101FFD9", "hex"), Buffer.from("89504e470d0a1a0a", "hex")]) {
    assert.throws(() => inspectVisionImage(bytes), bad);
  }
});
test("PNG verifies CRC, complete compressed scanlines, filter bytes and nonanimated structure", () => {
  assert.deepEqual(inspectVisionImage(makePng(3, 2)), { mimeType: "image/png", width: 3, height: 2 });
  const crcFailure = Buffer.from(PNG, "base64"); crcFailure[crcFailure.length - 1]! ^= 1; assert.throws(() => inspectVisionImage(crcFailure), bad);
  assert.throws(() => inspectVisionImage(makePng(3, 2, Buffer.alloc(1))), bad);
  const badFilter = Buffer.alloc(20); badFilter[0] = 5; assert.throws(() => inspectVisionImage(makePng(3, 2, badFilter)), bad);
  const png = makePng(3, 2); const apng = Buffer.concat([png.subarray(0, 33), pngChunk("acTL", Buffer.alloc(8)), png.subarray(33)]);
  assert.throws(() => inspectVisionImage(apng), bad);
});
test("dimension and pixel ceilings apply before PNG decompression", () => {
  for (const [width, height] of [[0, 2], [2, 0], [4097, 2], [2, 4097], [4096, 4096]]) {
    assert.throws(() => inspectVisionImage(makePng(width!, height!, Buffer.from([0]))), bad);
  }
});
test("WebP rejects animations, mismatched canvas, fake size, feature flags and invalid frame payload", () => {
  for (const update of [(b: Buffer) => { b[20]! |= 2; }, (b: Buffer) => { b[20]! |= 1; }, (b: Buffer) => { b[24] = 2; }, (b: Buffer) => { b.writeUInt32LE(b.length, 4); }, (b: Buffer) => { b[20]! |= 0x08; }]) {
    const bytes = Buffer.from(ALPHA_WEBP, "base64"); update(bytes); assert.throws(() => inspectVisionImage(bytes), bad);
  }
  const frame = Buffer.from(WEBP, "base64"); frame[23] = 0; assert.throws(() => inspectVisionImage(frame), bad);
});

function jpegSegment(marker: number, body: Uint8Array) {
  const segment = Buffer.alloc(body.length + 4); segment[0] = 0xff; segment[1] = marker; segment.writeUInt16BE(body.length + 2, 2); Buffer.from(body).copy(segment, 4);
  return segment;
}
function webpChunk(type: string, body: Uint8Array) {
  const chunk = Buffer.alloc(8 + body.length + (body.length & 1)); chunk.write(type); chunk.writeUInt32LE(body.length, 4); Buffer.from(body).copy(chunk, 8);
  return chunk;
}
const privateMetadata = Buffer.from("private-owner-email@example.invalid GPS-location secret-notes");
test("PNG transmission copy removes all common text and EXIF chunks but retains color/codec bytes", () => {
  const png = Buffer.from(PNG, "base64");
  const color = pngChunk("sRGB", Buffer.from([0]));
  const metadata = ["tEXt", "zTXt", "iTXt", "eXIf"].map((type) => pngChunk(type, privateMetadata));
  const original = Buffer.concat([png.subarray(0, 33), color, ...metadata, png.subarray(33)]), preserved = Buffer.from(original);
  const cleaned = stripVisionMetadata(original);
  assert.deepEqual(inspectVisionImage(cleaned), { mimeType: "image/png", width: 2, height: 3 });
  assert.deepEqual(Buffer.from(cleaned), Buffer.concat([png.subarray(0, 33), color, png.subarray(33)]));
  assert.deepEqual(original, preserved); assert.equal(Buffer.from(cleaned).includes(privateMetadata), false);
  cleaned[0] = 0; assert.deepEqual(original, preserved);
});
test("JPEG transmission copy strips APP1 through APP13, APP15 and COM while keeping scan entropy and codec profiles", () => {
  for (const base64 of [JPEG, PROGRESSIVE_JPEG]) {
    const jpeg = Buffer.from(base64, "base64"), app0 = jpegSegment(0xe0, Buffer.from("JFIF\0codec")), app14 = jpegSegment(0xee, Buffer.from("Adobe-color"));
    const metadata = [...Array.from({ length: 13 }, (_, index) => index + 0xe1), 0xef, 0xfe].map((marker) => jpegSegment(marker, privateMetadata));
    const original = Buffer.concat([jpeg.subarray(0, 2), app0, ...metadata, app14, jpeg.subarray(2)]), preserved = Buffer.from(original);
    const cleaned = stripVisionMetadata(original);
    assert.deepEqual(inspectVisionImage(cleaned), { mimeType: "image/jpeg", width: 2, height: 3 });
    assert.deepEqual(Buffer.from(cleaned), Buffer.concat([jpeg.subarray(0, 2), app0, app14, jpeg.subarray(2)]));
    assert.deepEqual(original, preserved); assert.equal(Buffer.from(cleaned).includes(privateMetadata), false);
  }
});
test("WebP transmission copy removes EXIF/XMP and updates VP8X flags and RIFF size without altering the original", () => {
  const webp = Buffer.from(ALPHA_WEBP, "base64");
  const original = Buffer.concat([webp, webpChunk("EXIF", privateMetadata), webpChunk("XMP ", privateMetadata)]);
  original[20]! |= 0x0c; original.writeUInt32LE(original.length - 8, 4);
  const preserved = Buffer.from(original), cleaned = stripVisionMetadata(original);
  assert.deepEqual(inspectVisionImage(cleaned), { mimeType: "image/webp", width: 2, height: 3 });
  assert.deepEqual(Buffer.from(cleaned), webp); assert.deepEqual(original, preserved);
  assert.equal(Buffer.from(cleaned).includes(privateMetadata), false);
});
test("metadata stripping requires a valid raster and always returns an independent copy", () => {
  for (const base64 of [PNG, JPEG, PROGRESSIVE_JPEG, WEBP, LOSSLESS_WEBP, ALPHA_WEBP]) {
    const original = Buffer.from(base64, "base64"), cleaned = stripVisionMetadata(original);
    assert.deepEqual(Buffer.from(cleaned), original); cleaned[0] = 0; assert.notEqual(original[0], 0);
  }
  for (const invalid of [Buffer.from("<svg>private</svg>"), Buffer.from(PNG, "base64").subarray(0, 32)]) assert.throws(() => stripVisionMetadata(invalid), bad);
});
