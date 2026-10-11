import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ANALYSIS_IMAGE_BUCKET, analysisImageError, loadAnalysisImagePreviews, uploadAnalysisImage, validateAnalysisImage } from "./analysis-images";
vi.mock("@/lib/env", () => ({ publicSupabaseConfig: () => ({ url: "https://project.supabase.co" }) }));
const owner = "11111111-1111-4111-8111-111111111111";
const analysis = "22222222-2222-4222-8222-222222222222";
const imageId = "33333333-3333-4333-8333-333333333333";
const context = { ownerId: owner, analysisId: analysis, step: 4, instrument: "BTCUSDT", timeframe: "4小时" };
const metadata = { id: imageId, owner_id: owner, analysis_id: analysis, step: 4, instrument: "BTCUSDT", timeframe: "4小时", storage_path: `${owner}/${analysis}/${imageId}.png`, mime_type: "image/png", byte_size: 3 };

function fixture(rows: unknown[] = [metadata]) {
  const order: string[] = [];
  const getUser = vi.fn().mockResolvedValue({ data: { user: { id: owner } }, error: null });
  const insert = vi.fn().mockImplementation(async () => { order.push("metadata"); return { error: null }; });
  const query = { eq: vi.fn(), in: vi.fn(), then: (resolve: (value: unknown) => void) => resolve({ data: rows, error: null }) };
  query.eq.mockReturnValue(query); query.in.mockReturnValue(query);
  const select = vi.fn().mockReturnValue(query);
  const from = vi.fn().mockReturnValue({ insert, select });
  const upload = vi.fn().mockImplementation(async () => { order.push("object"); return { error: null }; });
  const createSignedUrl = vi.fn().mockImplementation(async (path: string) => ({ data: { signedUrl: `https://project.supabase.co/storage/v1/object/sign/${ANALYSIS_IMAGE_BUCKET}/${path}?token=synthetic` }, error: null }));
  const storageFrom = vi.fn().mockReturnValue({ upload, createSignedUrl });
  const client = { auth: { getUser }, from, storage: { from: storageFrom } } as unknown as SupabaseClient;
  return { client, from, insert, query, getUser, upload, createSignedUrl, storageFrom, order };
}

beforeEach(() => vi.restoreAllMocks());
describe("private analysis screenshot repository", () => {
  it("writes context-bound metadata first, then owner/private bytes without upsert; returns only a temporary preview", async () => {
    const f = fixture(); vi.spyOn(crypto, "randomUUID").mockReturnValue(imageId);
    const file = new File(["png"], "secret-filename.png", { type: "image/png" });
    const result = await uploadAnalysisImage(f.client, context, file);
    expect(f.order).toEqual(["metadata", "object"]);
    expect(f.insert).toHaveBeenCalledWith(metadata);
    expect(f.storageFrom).toHaveBeenCalledWith(ANALYSIS_IMAGE_BUCKET);
    expect(f.upload).toHaveBeenCalledWith(metadata.storage_path, file, { upsert: false, contentType: "image/png", cacheControl: "300" });
    expect(f.createSignedUrl).toHaveBeenCalledWith(metadata.storage_path, 300);
    expect(Object.keys(result)).toEqual(["id", "signedUrl", "mimeType", "byteSize"]);
    expect(JSON.stringify(f.insert.mock.calls)).not.toContain("secret-filename");
  });
  it.each(["image/jpeg", "image/png", "image/webp"])("accepts %s within the strict 2 MiB limit", (type) => {
    expect(() => validateAnalysisImage(new File([new Uint8Array(2 * 1024 * 1024)], "screenshot", { type }))).not.toThrow();
  });
  it.each([new File([], "empty.png", { type: "image/png" }), new File(["x"], "svg.svg", { type: "image/svg+xml" }), new File([new Uint8Array(2 * 1024 * 1024 + 1)], "too-big.png", { type: "image/png" })])("rejects empty, executable or oversized input before any write", async (file) => {
    const f = fixture(); await expect(uploadAnalysisImage(f.client, context, file)).rejects.toThrow("invalid_image_file"); expect(f.from).not.toHaveBeenCalled(); expect(f.upload).not.toHaveBeenCalled();
  });
  it("rejects a changed owner before any write", async () => {
    const f = fixture(); f.getUser.mockResolvedValue({ data: { user: { id: "other" } }, error: null });
    await expect(uploadAnalysisImage(f.client, context, new File(["png"], "image.png", { type: "image/png" }))).rejects.toThrow("image_owner_changed"); expect(f.from).not.toHaveBeenCalled();
  });
  it("stops after metadata if the owner or active context changes; never deletes in-flight evidence", async () => {
    const f = fixture(); f.getUser.mockResolvedValueOnce({ data: { user: { id: owner } }, error: null }).mockResolvedValueOnce({ data: { user: { id: "other" } }, error: null });
    await expect(uploadAnalysisImage(f.client, context, new File(["png"], "image.png", { type: "image/png" }))).rejects.toThrow("image_owner_changed"); expect(f.order).toEqual(["metadata"]);
    const second = fixture(); let active = true; second.insert.mockImplementation(async () => { active = false; return { error: null }; });
    await expect(uploadAnalysisImage(second.client, context, new File(["png"], "image.png", { type: "image/png" }), () => active)).rejects.toThrow("image_context_changed"); expect(second.upload).not.toHaveBeenCalled();
  });
  it("fails metadata/object/signing safely and translates quota without exposing raw server text", async () => {
    const file = new File(["png"], "image.png", { type: "image/png" });
    const metadataFailed = fixture(); metadataFailed.insert.mockResolvedValue({ error: { message: "private/internal" } });
    await expect(uploadAnalysisImage(metadataFailed.client, context, file)).rejects.toThrow("image_metadata_failed"); expect(metadataFailed.upload).not.toHaveBeenCalled();
    const quota = fixture(); quota.insert.mockResolvedValue({ error: { message: "wave_analysis_image_quota_exceeded" } });
    await expect(uploadAnalysisImage(quota.client, context, file)).rejects.toThrow("image_history_limit");
    const objectFailed = fixture(); objectFailed.upload.mockResolvedValue({ error: {} }); await expect(uploadAnalysisImage(objectFailed.client, context, file)).rejects.toThrow("image_upload_failed");
    const signing = fixture(); signing.createSignedUrl.mockResolvedValue({ error: {}, data: null }); await expect(uploadAnalysisImage(signing.client, context, file)).rejects.toThrow("image_preview_failed");
    expect(analysisImageError(new Error("raw provider secret/path"))).not.toContain("raw provider");
  });
  it("loads in selected order only after explicit owner/analysis/step/context filters", async () => {
    const f = fixture(); const images = await loadAnalysisImagePreviews(f.client, context, [imageId]);
    expect(images).toHaveLength(1); expect(f.query.eq.mock.calls).toEqual([["owner_id", owner], ["analysis_id", analysis], ["step", 4], ["instrument", "BTCUSDT"], ["timeframe", "4小时"]]);
    expect(f.query.in).toHaveBeenCalledWith("id", [imageId]); expect(f.getUser).toHaveBeenCalledTimes(2);
  });
  it.each([{ owner_id: "other" }, { analysis_id: owner }, { step: 5 }, { instrument: "ETHUSDT" }, { timeframe: "1小时" }, { storage_path: `other/private.png` }, { mime_type: "image/svg+xml" }, { byte_size: 3 * 1024 * 1024 }])("never signs mismatched metadata %o", async (change) => {
    const f = fixture([{ ...metadata, ...change }]); await expect(loadAnalysisImagePreviews(f.client, context, [imageId])).rejects.toThrow("image_unavailable"); expect(f.createSignedUrl).not.toHaveBeenCalled();
  });
  it("rejects missing rows, arbitrary URLs, duplicates and future steps without signing", async () => {
    const f = fixture([]); await expect(loadAnalysisImagePreviews(f.client, context, [imageId])).rejects.toThrow("image_unavailable");
    for (const ids of [["https://external/image"], [imageId, imageId]]) await expect(loadAnalysisImagePreviews(f.client, context, ids)).rejects.toThrow("invalid_image_input");
    await expect(loadAnalysisImagePreviews(f.client, { ...context, step: 8 }, [imageId])).rejects.toThrow("invalid_image_input"); expect(f.createSignedUrl).not.toHaveBeenCalled();
  });
  it("does not render external or forged preview destinations", async () => {
    for (const url of ["https://evil.example/image.png", "javascript:alert(1)", `https://project.supabase.co/storage/v1/object/public/${ANALYSIS_IMAGE_BUCKET}/${metadata.storage_path}`, `https://project.supabase.co/storage/v1/object/sign/${ANALYSIS_IMAGE_BUCKET}/other/path.png?token=x`]) {
      const f = fixture(); f.createSignedUrl.mockResolvedValue({ data: { signedUrl: url }, error: null });
      await expect(loadAnalysisImagePreviews(f.client, context, [imageId])).rejects.toThrow("image_preview_failed");
    }
  });
  it("does not query or sign an empty selection", async () => {
    const f = fixture(); expect(await loadAnalysisImagePreviews(f.client, context, [])).toEqual([]); expect(f.from).not.toHaveBeenCalled(); expect(f.getUser).not.toHaveBeenCalled();
  });
});
