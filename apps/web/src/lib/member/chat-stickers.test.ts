import { describe, expect, it, vi } from "vitest";
import { customStickerToken, deleteChatSticker, resolvedStickerMime, validateStickerFile } from "./chat-stickers";

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

it("removing a saved sticker keeps the immutable object used by message history", async () => {
  const finalEq = vi.fn(async () => ({ error: null }));
  const firstEq = vi.fn(() => ({ eq: finalEq }));
  const remove = vi.fn();
  const client = {
    from: vi.fn(() => ({ delete: vi.fn(() => ({ eq: firstEq })) })),
    storage: { from: vi.fn(() => ({ remove })) },
  } as never;
  await deleteChatSticker(client, {
    id: "22222222-2222-4222-8222-222222222222",
    owner_id: "11111111-1111-4111-8111-111111111111",
    storage_path: "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.png",
    label: "波浪",
    mime_type: "image/png",
    created_at: new Date(0).toISOString(),
  });
  expect(remove).not.toHaveBeenCalled();
  expect(finalEq).toHaveBeenCalledWith("owner_id", "11111111-1111-4111-8111-111111111111");
});
