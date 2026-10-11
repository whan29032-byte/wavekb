import { inflateSync } from "node:zlib";
import { VISION_MAX_BYTES } from "./vision-input.ts";

export type VisionImageFormat = { mimeType: "image/jpeg" | "image/png" | "image/webp"; width: number; height: number };
function invalid(): never { throw Object.assign(new Error("invalid_image_input"), { code: "invalid_image_input" }); }
function dimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || width > 4096 || height > 4096 || width * height > 16_000_000) invalid();
}
const ascii = (bytes: Uint8Array, start: number, count: number) => String.fromCharCode(...bytes.subarray(start, start + count));
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(bytes: Uint8Array): VisionImageFormat {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8, width = 0, height = 0, depth = 0, color = 0, interlace = 0, ended = false, idatClosed = false, palette = false;
  const data: Uint8Array[] = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) invalid();
    const length = view.getUint32(offset), type = ascii(bytes, offset + 4, 4), end = offset + 12 + length;
    if (end > bytes.length || !/^[A-Za-z]{4}$/u.test(type) || crc32(bytes.subarray(offset + 4, end - 4)) !== view.getUint32(end - 4)) invalid();
    const content = bytes.subarray(offset + 8, end - 4);
    if (type === "IHDR") {
      if (offset !== 8 || length !== 13) invalid();
      width = view.getUint32(offset + 8); height = view.getUint32(offset + 12); dimensions(width, height);
      depth = content[8]!; color = content[9]!; interlace = content[12]!;
      const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!depths[color]?.includes(depth) || content[10] !== 0 || content[11] !== 0 || interlace > 1) invalid();
    } else {
      if (!width) invalid();
      if (type === "IDAT") {
        if (idatClosed || (color === 3 && !palette)) invalid();
        data.push(content);
      } else {
        if (data.length) idatClosed = true;
        if (["acTL", "fcTL", "fdAT"].includes(type)) invalid();
        if (type === "PLTE") {
          if (palette || data.length || color === 0 || color === 4 || !length || length % 3 || length > 768 || (color === 3 && length / 3 > 2 ** depth)) invalid();
          palette = true;
        } else if (type === "IEND") {
          if (length || !data.length || end !== bytes.length) invalid();
          ended = true;
        } else if (type[0] === type[0]!.toUpperCase()) invalid();
      }
    }
    offset = end;
  }
  if (!ended) invalid();
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color]!;
  const rows: number[] = [];
  const passes = interlace ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]];
  for (const [x, y, dx, dy] of passes) {
    const pw = Math.max(0, Math.ceil((width - x!) / dx!)), ph = Math.max(0, Math.ceil((height - y!) / dy!));
    if (pw) for (let row = 0; row < ph; row++) rows.push(Math.ceil(pw * channels * depth / 8));
  }
  const expected = rows.reduce((sum, row) => sum + row + 1, 0), compressed = Buffer.concat(data);
  const inflated = inflateSync(compressed, { maxOutputLength: expected, info: true }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
  if (inflated.buffer.length !== expected || inflated.engine.bytesWritten !== compressed.length) invalid();
  let at = 0;
  for (const length of rows) { if (inflated.buffer[at]! > 4) invalid(); at += length + 1; }
  return { mimeType: "image/png", width, height };
}
function jpeg(bytes: Uint8Array): VisionImageFormat {
  let offset = 2, width = 0, height = 0, scans = 0, quantization = false, huffman = false, restart = false;
  const componentIds = new Set<number>();
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) invalid();
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      if (offset !== bytes.length || !width || !scans || !quantization || !huffman) invalid();
      return { mimeType: "image/jpeg", width, height };
    }
    if (marker === undefined || marker === 0 || marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || offset + 2 > bytes.length) invalid();
    const length = bytes[offset]! * 256 + bytes[offset + 1]!, end = offset + length;
    if (length < 2 || end > bytes.length) invalid();
    const content = bytes.subarray(offset + 2, end);
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (width || content.length < 6 || content[0] !== 8) invalid();
      height = content[1]! * 256 + content[2]!; width = content[3]! * 256 + content[4]!; dimensions(width, height);
      const count = content[5]!;
      if (![1, 3, 4].includes(count) || content.length !== 6 + 3 * count) invalid();
      for (let i = 0; i < count; i++) {
        const id = content[6 + 3 * i]!, sampling = content[7 + 3 * i]!;
        if (componentIds.has(id) || (sampling >> 4) < 1 || (sampling >> 4) > 4 || (sampling & 15) < 1 || (sampling & 15) > 4 || content[8 + 3 * i]! > 3) invalid();
        componentIds.add(id);
      }
    } else if (marker === 0xdb) {
      let at = 0;
      while (at < content.length) {
        const table = content[at++]!; if ((table >> 4) > 1 || (table & 15) > 3) invalid();
        at += (table >> 4) ? 128 : 64; if (at > content.length) invalid(); quantization = true;
      }
    } else if (marker === 0xc4) {
      let at = 0;
      while (at < content.length) {
        if (at + 17 > content.length) invalid();
        const table = content[at++]!; if ((table >> 4) > 1 || (table & 15) > 3) invalid();
        let symbols = 0, capacity = 1;
        for (let i = 0; i < 16; i++) { const count = content[at++]!; symbols += count; capacity = capacity * 2 - count; if (capacity < 0) invalid(); }
        if (!symbols || symbols > 256 || at + symbols > content.length) invalid();
        at += symbols; huffman = true;
      }
    } else if (marker === 0xdd) { if (content.length !== 2) invalid(); restart = content[0] !== 0 || content[1] !== 0; }
    else if (marker === 0xda) {
      const count = content[0]!;
      if (!width || !quantization || !huffman || count < 1 || count > componentIds.size || content.length !== 1 + 2 * count + 3) invalid();
      const scanIds = new Set<number>();
      for (let i = 0; i < count; i++) {
        const id = content[1 + 2 * i]!, selector = content[2 + 2 * i]!;
        if (!componentIds.has(id) || scanIds.has(id) || (selector >> 4) > 3 || (selector & 15) > 3) invalid(); scanIds.add(id);
      }
      scans++; offset = end; let entropyBytes = 0;
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) { offset++; entropyBytes++; continue; }
        let next = offset + 1; while (bytes[next] === 0xff) next++;
        if (bytes[next] === 0) { if (next !== offset + 1) invalid(); offset = next + 1; entropyBytes++; continue; }
        if (bytes[next]! >= 0xd0 && bytes[next]! <= 0xd7) { if (!restart) invalid(); offset = next + 1; continue; }
        break;
      }
      if (!entropyBytes) invalid(); continue;
    } else if (!(marker >= 0xe0 && marker <= 0xef) && marker !== 0xfe) invalid();
    offset = end;
  }
  return invalid();
}
function webp(bytes: Uint8Array): VisionImageFormat {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 20 || view.getUint32(4, true) + 8 !== bytes.length) invalid();
  let offset = 12, width = 0, height = 0, extendedWidth = 0, extendedHeight = 0, flags = 0, losslessAlpha = false, image = false;
  const seen = new Set<string>();
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) invalid();
    const type = ascii(bytes, offset, 4), length = view.getUint32(offset + 4, true), end = offset + 8 + length, padded = end + (length & 1);
    if (padded > bytes.length || (length & 1 && bytes[end] !== 0) || seen.has(type)) invalid();
    seen.add(type); const c = bytes.subarray(offset + 8, end);
    if (type === "VP8X") {
      if (offset !== 12 || length !== 10 || c[0]! & 0xc3 || c[1] || c[2] || c[3]) invalid();
      flags = c[0]!;
      extendedWidth = 1 + c[4]! + (c[5]! << 8) + (c[6]! << 16); extendedHeight = 1 + c[7]! + (c[8]! << 8) + (c[9]! << 16); dimensions(extendedWidth, extendedHeight);
    } else if (type === "VP8 ") {
      if (image || length < 11 || c[0]! & 1 || (c[0]! >> 1 & 7) > 3 || !(c[0]! & 16) || ascii(c, 3, 3) !== "\x9d\x01\x2a") invalid();
      const partition = (c[0]! + (c[1]! << 8) + (c[2]! << 16)) >>> 5;
      if (partition < 7 || partition + 3 >= length) invalid();
      width = (c[6]! + (c[7]! << 8)) & 0x3fff; height = (c[8]! + (c[9]! << 8)) & 0x3fff; image = true;
    } else if (type === "VP8L") {
      if (image || seen.has("ALPH") || length < 6 || c[0] !== 0x2f || c[4]! & 0xe0) invalid();
      const bits = c[1]! + (c[2]! << 8) + (c[3]! << 16) + (c[4]! << 24);
      losslessAlpha = Boolean(bits & 0x10000000);
      width = 1 + (bits & 0x3fff); height = 1 + (bits >>> 14 & 0x3fff); image = true;
    } else if (type === "ALPH") {
      if (!extendedWidth || image || !length || c[0]! & 0xc0 || (c[0]! & 3) > 1 || (c[0]! >> 4 & 3) > 1
        || (!(c[0]! & 3) && length !== 1 + extendedWidth * extendedHeight)) invalid();
    } else if (!["ICCP", "EXIF", "XMP "].includes(type) || !extendedWidth || !length || (type === "ICCP" && image)) invalid();
    offset = padded;
  }
  if (!image || (extendedWidth && (width !== extendedWidth || height !== extendedHeight))) invalid();
  if (extendedWidth && (Boolean(flags & 0x20) !== seen.has("ICCP") || Boolean(flags & 0x08) !== seen.has("EXIF")
    || Boolean(flags & 0x04) !== seen.has("XMP ") || Boolean(flags & 0x10) !== (seen.has("ALPH") || losslessAlpha))) invalid();
  dimensions(width, height); return { mimeType: "image/webp", width, height };
}

/** Bounded container/codestream validation; never trust declared MIME or suffix. */
export function inspectVisionImage(value: Uint8Array): VisionImageFormat {
  try {
    if (!(value instanceof Uint8Array) || value.byteLength < 12 || value.byteLength > VISION_MAX_BYTES) invalid();
    if (ascii(value, 0, 8) === "\x89PNG\r\n\x1a\n") return png(value);
    if (value[0] === 0xff && value[1] === 0xd8) return jpeg(value);
    if (ascii(value, 0, 4) === "RIFF" && ascii(value, 8, 4) === "WEBP") return webp(value);
    return invalid();
  } catch { return invalid(); }
}

/**
 * Remove common nonvisual metadata from a fresh transmission copy. This is not
 * image anonymization: the visible pixels (and retained codec/color fields)
 * can still contain private information. The original storage bytes never
 * change. Container and frame validation happens before and after stripping.
 */
export function stripVisionMetadata(bytes: Uint8Array): Uint8Array {
  try {
    const format = inspectVisionImage(bytes);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const parts: Uint8Array[] = [];
    if (format.mimeType === "image/png") {
      parts.push(bytes.subarray(0, 8));
      let offset = 8;
      while (offset < bytes.length) {
        const end = offset + 12 + view.getUint32(offset), type = ascii(bytes, offset + 4, 4);
        if (!["tEXt", "zTXt", "iTXt", "eXIf"].includes(type)) parts.push(bytes.subarray(offset, end));
        offset = end;
      }
    } else if (format.mimeType === "image/jpeg") {
      parts.push(bytes.subarray(0, 2));
      let offset = 2;
      while (offset < bytes.length) {
        const start = offset;
        offset++; while (bytes[offset] === 0xff) offset++;
        const marker = bytes[offset++]!;
        if (marker === 0xd9) { parts.push(bytes.subarray(start, offset)); break; }
        const length = view.getUint16(offset), end = offset + length;
        offset = end;
        if (marker === 0xda) {
          // SOS entropy may contain stuffed FF bytes and restart markers.
          // Preserve it verbatim until the next complete segment marker.
          while (offset < bytes.length) {
            if (bytes[offset] !== 0xff) { offset++; continue; }
            let next = offset + 1; while (bytes[next] === 0xff) next++;
            if (bytes[next] === 0 || (bytes[next]! >= 0xd0 && bytes[next]! <= 0xd7)) { offset = next + 1; continue; }
            break;
          }
        }
        if (!((marker >= 0xe1 && marker <= 0xed) || marker === 0xef || marker === 0xfe)) parts.push(bytes.subarray(start, offset));
      }
    } else {
      parts.push(bytes.subarray(0, 12));
      let offset = 12;
      while (offset < bytes.length) {
        const length = view.getUint32(offset + 4, true), end = offset + 8 + length + (length & 1), type = ascii(bytes, offset, 4);
        if (!["EXIF", "XMP "].includes(type)) {
          if (type === "VP8X") {
            const copied = Uint8Array.from(bytes.subarray(offset, end));
            copied[8] = copied[8]! & ~0x0c;
            parts.push(copied);
          } else parts.push(bytes.subarray(offset, end));
        }
        offset = end;
      }
    }
    const output = Uint8Array.from(Buffer.concat(parts));
    if (format.mimeType === "image/webp") new DataView(output.buffer).setUint32(4, output.length - 8, true);
    const cleaned = inspectVisionImage(output);
    if (cleaned.mimeType !== format.mimeType || cleaned.width !== format.width || cleaned.height !== format.height) invalid();
    return output;
  } catch { return invalid(); }
}
