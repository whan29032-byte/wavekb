import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { savePrivateEntry } from "./client-repository";

function input() {
  return {
    ownerId: "79facf84-b98c-44f6-a223-b9ee4bc31f08",
    kind: "review" as const,
    title: "BTC 复盘",
    body: "保留可以复查的判断。",
    instrument: "BTCUSDT",
    market: "加密",
    timeframe: "4小时",
    tags: ["纪律"],
    knowledgeIds: [],
    reviewData: { editor_mode: "simple" as const },
    keptImageIds: [],
    files: [new File(["image"], "chart.png", { type: "image/png" })],
  };
}

describe("private workbench persistence", () => {
  it("uploads into an owner and entry scoped private path", async () => {
    const upload = vi.fn(async () => undefined);
    const upsertEntry = vi.fn(async () => undefined);
    const insertImages = vi.fn(async () => undefined);
    const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
    const result = await savePrivateEntry({} as SupabaseClient, input(), undefined, {
      makeId: () => ids.shift() || "",
      upload,
      upsertEntry,
      insertImages,
      deleteImageRows: vi.fn(async () => undefined),
      removeFiles: vi.fn(async () => undefined),
      removeEntry: vi.fn(async () => undefined),
    });
    expect(result.id).toBe("11111111-1111-4111-8111-111111111111");
    expect(upload).toHaveBeenCalledWith(
      "79facf84-b98c-44f6-a223-b9ee4bc31f08/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.png",
      expect.any(File),
    );
    expect(insertImages).toHaveBeenCalledOnce();
  });

  it("cleans uploaded files and the new row when metadata insertion fails", async () => {
    const removeFiles = vi.fn(async () => undefined);
    const removeEntry = vi.fn(async () => undefined);
    const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
    await expect(savePrivateEntry({} as SupabaseClient, input(), undefined, {
      makeId: () => ids.shift() || "",
      upload: vi.fn(async () => undefined),
      upsertEntry: vi.fn(async () => undefined),
      insertImages: vi.fn(async () => { throw new Error("metadata failed"); }),
      deleteImageRows: vi.fn(async () => undefined),
      removeFiles,
      removeEntry,
    })).rejects.toThrow("metadata failed");
    expect(removeFiles).toHaveBeenCalledOnce();
    expect(removeEntry).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
  });
});
