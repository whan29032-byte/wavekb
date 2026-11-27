import { afterEach, describe, expect, it, vi } from "vitest";

const supabase = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/client", () => supabase);
import { createFillAnnotationWrite, loadFillAnnotation, validateFillAnnotationFiles } from "./fill-annotation-repository";

const context = { cycleId: "10000000-0000-4000-8000-000000000000", cycleRevision: 3, fillId: "9007199254740993" };
const ownerId = "20000000-0000-4000-8000-000000000000";
const noteId = "30000000-0000-4000-8000-000000000000";
const imageId = "40000000-0000-4000-8000-000000000000";
const existingImage = { id: imageId, storage_path: `${ownerId}/${noteId}/${imageId}.png`, mime_type: "image/png" as const, byte_size: 64 };
const existing = { id: noteId, body: "开仓", tags: ["long"], version: 2, remap_status: "current" as const, image_count: 1 };
const saved = { ...existing, body: "遇到阻力", tags: ["resistance"], version: 3 };
const draft = { body: saved.body, tags: saved.tags };
const snapshot = { ownerId, annotation: existing, revision: 3, deleted: false, images: [existingImage] };
const row = (annotation = existing) => ({
  ...annotation, cycle_revision: 3, deleted_at: null,
  trading_fill_annotation_images: [{ ...existingImage, sort_order: 0, deleted_at: null }],
});

function fixture() {
  const seen: string[] = [];
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => ({ data: row(), error: null })),
  };
  const upload = vi.fn(async () => ({ data: null, error: { message: "storage internal error" } }));
  const remove = vi.fn(async () => ({ error: null }));
  supabase.createClient.mockReturnValue({
    auth: { getUser: async () => ({ data: { user: { id: ownerId } }, error: null }) },
    from: () => query,
    storage: { from: () => ({ upload, remove }) },
  });
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ annotation: saved }));
  vi.stubGlobal("fetch", fetcher);
  return { fetcher, seen, query, upload, remove };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("private fill annotation repository", () => {
  it("loads one owner-bound view with explicit image paths and the exact bigint filter", async () => {
    const { query } = fixture();
    expect(await loadFillAnnotation(context)).toEqual(snapshot);
    expect(query.eq).toHaveBeenCalledWith("fill_id", "9007199254740993");
    expect(query.eq).toHaveBeenCalledWith("owner_id", ownerId);
    expect(query.eq).toHaveBeenCalledWith("cycle_id", context.cycleId);
  });

  it("checks an uncertain save against the latest version and preserves images on text edits", async () => {
    const { fetcher, query } = fixture();
    fetcher.mockRejectedValueOnce(new TypeError("disconnected"));
    const write = createFillAnnotationWrite(context, snapshot, draft);
    await expect(write()).rejects.toThrow("uncertain");
    query.maybeSingle.mockResolvedValueOnce({ data: row(saved), error: null });
    await expect(write()).resolves.toMatchObject({ snapshot: { annotation: saved, images: [existingImage] } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      body: JSON.stringify({
        annotation_id: noteId, cycle_revision: 3, body: draft.body, tags: draft.tags,
        images: [existingImage], expected_version: 2, deleted: false,
      }),
    }));
  });

  it("does not retry over a conflicting note returned on reconciliation", async () => {
    const { fetcher, query } = fixture();
    fetcher.mockRejectedValueOnce(new TypeError("disconnected"));
    const write = createFillAnnotationWrite(context, snapshot, draft);
    await expect(write()).rejects.toThrow("uncertain");
    query.maybeSingle.mockResolvedValueOnce({ data: row({ ...saved, body: "另一设备内容" }), error: null });
    await expect(write()).rejects.toThrow("stale");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("soft-deletes an empty memo once its last attachment is removed", async () => {
    const { fetcher } = fixture();
    fetcher.mockResolvedValueOnce(Response.json({ annotation: { ...saved, body: "", tags: [], image_count: 0 } }));
    const write = createFillAnnotationWrite(context, snapshot, { body: "", tags: [] }, { removeId: existingImage.id });
    await expect(write()).resolves.toMatchObject({ snapshot: { deleted: true, images: [] } });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      annotation_id: noteId, expected_version: 2, deleted: true, images: [],
    });
  });

  it("reserves owner-bound metadata before upload and rolls it back on failure", async () => {
    const { fetcher, upload, seen } = fixture();
    const file = new File(["test"], "preview.png", { type: "image/png" });
    fetcher.mockImplementation(async (_path, options) => {
      const payload = JSON.parse(String(options?.body));
      seen.push(payload.images.length === 2 ? "reserved" : "rolled back");
      return Response.json({ annotation: { ...saved, version: payload.expected_version + 1, image_count: payload.images.length } });
    });
    upload.mockImplementation(async () => {
      seen.push("upload");
      return { data: null, error: { message: "storage internal error" } };
    });
    const write = createFillAnnotationWrite(context, snapshot, draft, { files: [file] });
    await expect(write()).resolves.toEqual({
      snapshot: { ...snapshot, annotation: { ...saved, version: 4 } },
      uploadRolledBack: true,
    });
    expect(seen).toEqual(["reserved", "upload", "rolled back"]);
    expect(upload).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^${ownerId}/${noteId}/[0-9a-f-]{36}\\.png$`)),
      file,
      expect.objectContaining({ contentType: "image/png", upsert: false }),
    );
  });

  it("rejects invalid attachment counts, MIME types and byte sizes before network activity", () => {
    const { fetcher } = fixture();
    const validFile = new File(["valid"], "screen.png", { type: "image/png" });
    expect(validateFillAnnotationFiles([validFile], 4)).toBeNull();
    expect(validateFillAnnotationFiles([validFile], 5)).toBe("image_count");
    expect(validateFillAnnotationFiles([new File(["html"], "screen.png", { type: "text/html" })], 0)).toBe("image_format");
    expect(validateFillAnnotationFiles([new File([], "screen.jpg", { type: "image/jpeg" })], 0)).toBe("image_format");
    expect(validateFillAnnotationFiles([new File([new Uint8Array(2_097_153)], "screen.png", { type: "image/png" })], 0)).toBe("image_format");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
