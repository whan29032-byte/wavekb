import type { SupabaseClient } from "@supabase/supabase-js";
import { publicSupabaseConfig } from "@/lib/env";
import { normalizeVisionImageIds, VISION_MAX_BYTES } from "../../../../../ai-gateway/src/research/vision-input.ts";

export const ANALYSIS_IMAGE_BUCKET = "wave-analysis-images";
export type AnalysisImageContext = { ownerId: string; analysisId: string; step: number; instrument: string; timeframe: string };
export type AnalysisImagePreview = { id: string; signedUrl: string; mimeType: string; byteSize: number };
export type AnalysisImageServices = {
  verifyOwner(ownerId: string): Promise<void>;
  load(context: AnalysisImageContext, ids: string[]): Promise<AnalysisImagePreview[]>;
  upload(context: AnalysisImageContext, file: File, isCurrent: () => boolean): Promise<AnalysisImagePreview>;
  watchOwner?(ownerId: string, invalidated: () => void): () => void;
};
const extensions: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

function fail(code: string): never { throw new Error(code); }
function validateContext(context: AnalysisImageContext) {
  normalizeVisionImageIds([context.ownerId]); normalizeVisionImageIds([context.analysisId]);
  if (!Number.isInteger(context.step) || context.step < 2 || context.step > 7
    || !context.instrument.trim() || context.instrument.length > 80 || !context.timeframe.trim() || context.timeframe.length > 80) fail("invalid_image_input");
}

export function validateAnalysisImage(file: File) {
  if (!extensions[file.type] || !Number.isInteger(file.size) || file.size < 1 || file.size > VISION_MAX_BYTES) fail("invalid_image_file");
}

export async function verifyAnalysisImageOwner(client: SupabaseClient, ownerId: string) {
  const { data, error } = await client.auth.getUser();
  if (error || data.user?.id !== ownerId) fail("image_owner_changed");
}

function validRow(value: unknown, context: AnalysisImageContext, expectedIds: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("image_unavailable");
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !expectedIds.includes(row.id) || row.owner_id !== context.ownerId || row.analysis_id !== context.analysisId
    || row.step !== context.step || row.instrument !== context.instrument || row.timeframe !== context.timeframe
    || typeof row.mime_type !== "string" || !extensions[row.mime_type]
    || typeof row.byte_size !== "number" || !Number.isInteger(row.byte_size) || row.byte_size < 1 || row.byte_size > VISION_MAX_BYTES
    || row.storage_path !== `${context.ownerId}/${context.analysisId}/${row.id}.${extensions[row.mime_type]}`) fail("image_unavailable");
  return { id: row.id, storagePath: row.storage_path as string, mimeType: row.mime_type, byteSize: row.byte_size };
}

async function preview(client: SupabaseClient, row: ReturnType<typeof validRow>) {
  const result = await client.storage.from(ANALYSIS_IMAGE_BUCKET).createSignedUrl(row.storagePath, 300);
  if (result.error || !result.data?.signedUrl) fail("image_preview_failed");
  // Preview URLs come only from the configured private Storage service, never
  // from stored analysis fields or arbitrary metadata supplied by the browser.
  let signed: URL;
  try { signed = new URL(result.data.signedUrl); } catch { return fail("image_preview_failed"); }
  const expected = new URL(publicSupabaseConfig().url);
  const expectedPath = `/storage/v1/object/sign/${ANALYSIS_IMAGE_BUCKET}/${row.storagePath}`;
  if (signed.origin !== expected.origin || signed.username || signed.password || signed.pathname !== expectedPath
    || !signed.searchParams.get("token") || !["https:", "http:"].includes(signed.protocol)) fail("image_preview_failed");
  return { id: row.id, signedUrl: signed.href, mimeType: row.mimeType, byteSize: row.byteSize };
}

export async function loadAnalysisImagePreviews(client: SupabaseClient, context: AnalysisImageContext, value: unknown): Promise<AnalysisImagePreview[]> {
  const ids = normalizeVisionImageIds(value);
  if (!ids.length) return [];
  validateContext(context); await verifyAnalysisImageOwner(client, context.ownerId);
  const result = await client.from("wave_analysis_images").select("id,owner_id,analysis_id,step,instrument,timeframe,storage_path,mime_type,byte_size")
    .eq("owner_id", context.ownerId).eq("analysis_id", context.analysisId).eq("step", context.step)
    .eq("instrument", context.instrument).eq("timeframe", context.timeframe).in("id", ids);
  if (result.error || !Array.isArray(result.data) || result.data.length !== ids.length) fail("image_unavailable");
  const rows = result.data.map((row: unknown) => validRow(row, context, ids));
  if (new Set(rows.map((row) => row.id)).size !== ids.length) fail("image_unavailable");
  const images = await Promise.all(ids.map((id) => preview(client, rows.find((row) => row.id === id)!)));
  await verifyAnalysisImageOwner(client, context.ownerId);
  return images;
}

export async function uploadAnalysisImage(client: SupabaseClient, context: AnalysisImageContext, file: File, isCurrent: () => boolean = () => true): Promise<AnalysisImagePreview> {
  validateContext(context); validateAnalysisImage(file);
  const verify = async () => { await verifyAnalysisImageOwner(client, context.ownerId); if (!isCurrent()) fail("image_context_changed"); };
  await verify();
  const id = crypto.randomUUID();
  const metadata = { id, owner_id: context.ownerId, analysis_id: context.analysisId, step: context.step, instrument: context.instrument, timeframe: context.timeframe,
    storage_path: `${context.ownerId}/${context.analysisId}/${id}.${extensions[file.type]}`, mime_type: file.type, byte_size: file.size };
  // The private bucket policy requires this owner/context-bound metadata before
  // object creation. Failed attempts are never selected or sent to a model.
  const inserted = await client.from("wave_analysis_images").insert(metadata);
  if (inserted.error) {
    if (inserted.error.message?.includes("wave_analysis_image_quota_exceeded")) fail("image_history_limit");
    fail("image_metadata_failed");
  }
  await verify();
  const uploaded = await client.storage.from(ANALYSIS_IMAGE_BUCKET).upload(metadata.storage_path, file, { upsert: false, contentType: file.type, cacheControl: "300" });
  if (uploaded.error) fail("image_upload_failed");
  await verify();
  const image = await preview(client, validRow(metadata, context, [id]));
  await verify();
  return image;
}

export function browserAnalysisImageServices(client: SupabaseClient): AnalysisImageServices {
  return {
    verifyOwner: (ownerId) => verifyAnalysisImageOwner(client, ownerId),
    load: (context, ids) => loadAnalysisImagePreviews(client, context, ids),
    upload: (context, file, isCurrent) => uploadAnalysisImage(client, context, file, isCurrent),
    watchOwner: (ownerId, invalidated) => {
      const { data } = client.auth.onAuthStateChange((_event, session) => { if (session?.user?.id !== ownerId) invalidated(); });
      return () => data.subscription.unsubscribe();
    },
  };
}

export function analysisImageError(cause: unknown) {
  const code = cause instanceof Error ? cause.message : "";
  return ({ invalid_image_file: "只支持 JPEG、PNG、WebP 图片，每张不超过 2 MiB，不能是空文件。",
    invalid_image_input: "截图引用无效，请清除本步骤截图后重新选择。",
    image_owner_changed: "登录账号已变化或退出，截图已停用。请返回当前账号的分析页后重试。",
    image_context_changed: "分析品种、周期或步骤已改变，刚才的截图未加入本步骤。",
    image_history_limit: "本分析的历史截图上传额度已满。已移除或失败的历史资料不会自动删除，请新建分析后继续。",
    image_unavailable: "已有截图无法核实所属账号、分析步骤或品种／周期，已停用。请清除后重新上传。",
    image_preview_failed: "截图预览暂时不可用，未加入本次分析。请刷新预览或稍后重试。",
    image_metadata_failed: "截图记录保存失败，未加入本次分析。请稍后重试。",
    image_upload_failed: "截图上传失败，未加入本次分析。请检查网络后重试。",
  } as Record<string, string>)[code] ?? "截图暂时不可用，未加入本次分析。请稍后重试。";
}
