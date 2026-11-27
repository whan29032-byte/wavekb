import type { FillMarkerAnnotationV1 } from "@wavekb/domain/trading-review";
import { createClient } from "@/lib/supabase/client";
import { saveTradeFillAnnotation, TradingRepositoryError, type SaveTradeFillAnnotationImageInput } from "./workbench-repository";

const bucket = "trade-chart-annotation-images";
const extensions = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const imageLimit = 5;
const imageBytes = 2_097_152;
const remapStatuses = new Set(["current", "remapped", "needs_confirmation"]);

export const fillAnnotationFileTypes = Object.keys(extensions).join(",");
export const fillAnnotationBodyLimit = 5_000;

export type FillAnnotationContext = { cycleId: string; cycleRevision: number; fillId: string };
export type FillAnnotationImage = SaveTradeFillAnnotationImageInput;
export type FillAnnotationSnapshot = {
  ownerId: string;
  annotation: FillMarkerAnnotationV1 | null;
  revision: number | null;
  deleted: boolean;
  images: FillAnnotationImage[];
};
type Draft = { body: string; tags: string[] };
type ImageChanges = { files?: File[]; removeId?: string };
type ImageValidationError = "image_count" | "image_format";
type AnnotationValidationError = "body_length" | "body_format" | "tag_count" | "tag_length";
type Failure = "stale" | "uncertain" | "read" | "write" | ImageValidationError | AnnotationValidationError;
export class FillAnnotationError extends Error {
  constructor(readonly code: Failure) {
    super(code);
  }
}

function isMime(value: unknown): value is FillAnnotationImage["mime_type"] {
  return typeof value === "string" && Object.hasOwn(extensions, value);
}

export function validateFillAnnotationFiles(files: readonly File[], previousCount: number): ImageValidationError | null {
  if (previousCount + files.length > imageLimit) return "image_count";
  return files.some((file) => !isMime(file.type) || !Number.isInteger(file.size) || file.size < 1 || file.size > imageBytes)
    ? "image_format"
    : null;
}

export function validateFillAnnotationDraft({ body, tags }: Draft): AnnotationValidationError | null {
  if (body.length > fillAnnotationBodyLimit) return "body_length";
  // Match the Gateway's plain note boundary so an invalid draft never enters autosave.
  if (/[<>]/.test(body) || /javascript:|data:text\/html|expression\(|url\(/.test(body.toLowerCase().replaceAll(" ", ""))) return "body_format";
  if (tags.length > 10) return "tag_count";
  if (tags.some((tag) => tag.length < 1 || tag.length > 40 || tag !== tag.trim().toLowerCase())) return "tag_length";
  return null;
}

async function verifiedOwner(expected?: string) {
  const client = createClient();
  const { data, error } = await client.auth.getUser();
  const ownerId = data.user?.id;
  if (error || typeof ownerId !== "string" || !uuid.test(ownerId)) throw new FillAnnotationError("read");
  if (expected !== undefined && ownerId !== expected) throw new FillAnnotationError("stale");
  return { client, ownerId };
}

function imageMetadata(row: Record<string, unknown>, ownerId: string, noteId: string): FillAnnotationImage {
  const { id, storage_path, mime_type, byte_size } = row;
  if (typeof id !== "string" || !uuid.test(id) || !isMime(mime_type)
    || storage_path !== `${ownerId}/${noteId}/${id}.${extensions[mime_type]}`
    || typeof byte_size !== "number" || !Number.isInteger(byte_size) || byte_size < 1 || byte_size > imageBytes) {
    throw new FillAnnotationError("read");
  }
  return { id, storage_path, mime_type, byte_size };
}

export async function loadFillAnnotation(context: FillAnnotationContext, expectedOwner?: string): Promise<FillAnnotationSnapshot> {
  const { client, ownerId } = await verifiedOwner(expectedOwner);
  // Select the note and attachments in one PostgREST statement. Keep the bigint
  // identity in the filter only so the browser never rounds a response ID.
  const result = await client.from("trading_fill_annotations").select(
    "id,cycle_revision,body,tags,version,remap_status,deleted_at,trading_fill_annotation_images(id,storage_path,mime_type,byte_size,sort_order,deleted_at)",
  ).eq("owner_id", ownerId).eq("cycle_id", context.cycleId).eq("fill_id", context.fillId).maybeSingle();
  if (result.error) throw new FillAnnotationError("read");
  if (!result.data) return { ownerId, annotation: null, revision: null, deleted: false, images: [] };
  const row = result.data;
  if (typeof row.id !== "string" || !uuid.test(row.id)
    || !Number.isSafeInteger(row.cycle_revision) || !Number.isSafeInteger(row.version)
    || row.cycle_revision < 1 || row.version < 1 || typeof row.body !== "string"
    || !Array.isArray(row.tags) || !row.tags.every((tag: unknown) => typeof tag === "string")
    || !remapStatuses.has(row.remap_status) || !Array.isArray(row.trading_fill_annotation_images)) {
    throw new FillAnnotationError("read");
  }
  const deleted = row.deleted_at !== null;
  const images = deleted ? [] : row.trading_fill_annotation_images
    .filter((image) => image.deleted_at === null)
    .sort((left, right) => left.sort_order - right.sort_order)
    .map((image) => imageMetadata(image, ownerId, row.id));
  if (images.length > imageLimit) throw new FillAnnotationError("read");
  return {
    ownerId,
    revision: row.cycle_revision,
    deleted,
    images,
    annotation: {
      id: row.id, body: row.body, tags: row.tags, version: row.version, image_count: images.length,
      remap_status: row.remap_status as FillMarkerAnnotationV1["remap_status"],
    },
  };
}

function matchesImages(left: readonly FillAnnotationImage[], right: readonly FillAnnotationImage[]) {
  return left.length === right.length && left.every((image, index) => image.id === right[index]?.id);
}

function createVersionedWrite(
  context: FillAnnotationContext,
  before: FillAnnotationSnapshot,
  annotationId: string,
  draft: Draft,
  images: FillAnnotationImage[],
) {
  let sent = false;
  const expectedVersion = before.annotation?.version ?? 0;
  const deleted = draft.body.trim() === "" && draft.tags.length === 0 && images.length === 0;
  return async (): Promise<FillAnnotationSnapshot> => {
    await verifiedOwner(before.ownerId).catch((error: unknown) => {
      if (error instanceof FillAnnotationError && error.code === "stale") throw error;
      throw new FillAnnotationError("uncertain");
    });
    if (sent) {
      const latest = await loadFillAnnotation(context, before.ownerId).catch((error: unknown) => {
        if (error instanceof FillAnnotationError && error.code === "stale") throw error;
        throw new FillAnnotationError("uncertain");
      });
      const current = latest.annotation;
      if (latest.deleted === deleted && latest.revision === context.cycleRevision && current?.id === annotationId
        && current.version === expectedVersion + 1 && current.body === draft.body
        && JSON.stringify(current.tags) === JSON.stringify(draft.tags) && matchesImages(latest.images, images)) return latest;
      if (current?.id !== before.annotation?.id || (current?.version ?? 0) !== expectedVersion
        || latest.revision !== before.revision || latest.deleted !== before.deleted
        || !matchesImages(latest.images, before.images)) throw new FillAnnotationError("stale");
    }
    sent = true;
    try {
      const annotation = await saveTradeFillAnnotation(context.cycleId, context.fillId, {
        annotation_id: annotationId,
        cycle_revision: context.cycleRevision,
        body: draft.body,
        tags: draft.tags,
        images,
        expected_version: expectedVersion,
        deleted,
      });
      return { ownerId: before.ownerId, revision: context.cycleRevision, deleted, annotation, images };
    } catch (error) {
      if (error instanceof TradingRepositoryError) {
        if (error.status === 404 || error.status === 409) throw new FillAnnotationError("stale");
        if (error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status)) throw new FillAnnotationError("write");
      }
      throw new FillAnnotationError("uncertain");
    }
  };
}

export type FillAnnotationWrite = () => Promise<{ snapshot: FillAnnotationSnapshot; uploadRolledBack: boolean }>;

export function createFillAnnotationWrite(
  context: FillAnnotationContext,
  before: FillAnnotationSnapshot,
  draft: Draft,
  changes: ImageChanges = {},
): FillAnnotationWrite {
  const retained = before.images.filter((image) => image.id !== changes.removeId);
  const files = changes.files ?? [];
  const invalid = validateFillAnnotationDraft(draft) ?? validateFillAnnotationFiles(files, retained.length);
  if (invalid) throw new FillAnnotationError(invalid);
  if (!before.deleted && before.annotation
    && (before.revision !== context.cycleRevision || before.annotation.remap_status === "needs_confirmation")) {
    throw new FillAnnotationError("stale");
  }

  const annotationId = before.annotation?.id ?? crypto.randomUUID();
  const additions = files.map((file) => {
    const id = crypto.randomUUID();
    const mime = file.type as FillAnnotationImage["mime_type"];
    return { id, storage_path: `${before.ownerId}/${annotationId}/${id}.${extensions[mime]}`, mime_type: mime, byte_size: file.size };
  });
  const reserve = createVersionedWrite(context, before, annotationId, draft, [...retained, ...additions]);
  let rollback: ReturnType<typeof createVersionedWrite> | undefined;
  return async () => {
    if (!rollback) {
      const snapshot = await reserve();
      try {
        if (additions.length > 0) {
          const { client } = await verifiedOwner(before.ownerId);
          const storage = client.storage.from(bucket);
          for (const [index, file] of files.entries()) {
            const addition = additions[index]!;
            const response = await storage.upload(addition.storage_path, file, {
              contentType: addition.mime_type, upsert: false, cacheControl: "0",
            });
            if (response.error) throw new FillAnnotationError("write");
          }
        }
      } catch {
        // Roll back metadata using the precise reservation version. If another
        // writer has modified the note, the optimistic guard preserves it.
        rollback = createVersionedWrite(context, snapshot, annotationId, draft, retained);
      }
      if (!rollback) {
        const removed = before.images.filter((image) => image.id === changes.removeId);
        void cleanupImages(before.ownerId, removed);
        return { snapshot, uploadRolledBack: false };
      }
    }
    const snapshot = await rollback();
    void cleanupImages(before.ownerId, additions);
    return { snapshot, uploadRolledBack: true };
  };
}

async function cleanupImages(ownerId: string, images: FillAnnotationImage[]) {
  if (images.length === 0) return;
  try {
    const { client } = await verifiedOwner(ownerId);
    // Metadata is already soft-deleted. File cleanup is best effort and may
    // be deferred by storage RLS; hidden objects stay inaccessible to users.
    await client.storage.from(bucket).remove(images.map((image) => image.storage_path));
  } catch {}
}

export async function downloadFillAnnotationImage(snapshot: FillAnnotationSnapshot, image: FillAnnotationImage): Promise<Blob> {
  if (!snapshot.annotation || !snapshot.images.some(({ id }) => id === image.id)) throw new FillAnnotationError("read");
  const safe = imageMetadata(image, snapshot.ownerId, snapshot.annotation.id);
  const { client } = await verifiedOwner(snapshot.ownerId);
  const result = await client.storage.from(bucket).download(safe.storage_path);
  if (result.error || !result.data || result.data.size !== safe.byte_size || result.data.type !== safe.mime_type) {
    throw new FillAnnotationError("read");
  }
  return result.data;
}
