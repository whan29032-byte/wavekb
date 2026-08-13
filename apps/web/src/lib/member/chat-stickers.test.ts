import { describe, expect, it } from "vitest";
import { customStickerToken, resolvedStickerMime, validateStickerFile } from "./chat-stickers";

describe("chat stickers", () => {
  it("recognizes supported declared and inferred image types", () => {
    expect(resolvedStickerMime({ name: "wave.bin", type: "image/webp" })).toBe("image/webp");
    expect(resolvedStickerMime({ name: "wave.GIF", type: "" })).toBe("image/gif");
    expect(resolvedStickerMime({ name: "wave.svg", type: "image/svg+xml" })).toBeNull();
  });

  it("limits sticker size and safely encodes message tokens", () => {
    const large = new File([new Uint8Array(12 * 1024 * 1024 + 1)], "large.png", { type: "image/png" });
    expect(validateStickerFile(large)).toContain("12 MB");
    expect(customStickerToken({ storage_path: "user/sticker.png", label: "浪|图" } as never)).toBe("[[custom-sticker:user%2Fsticker.png|%E6%B5%AA%7C%E5%9B%BE]]");
  });
});
