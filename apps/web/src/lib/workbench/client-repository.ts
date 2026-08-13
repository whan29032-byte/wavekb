import type { SupabaseClient } from "@supabase/supabase-js";
import type { PrivateEntry, PrivateEntryKind, PrivateEntryReviewData } from "@wavekb/domain";
import { mapWithConcurrency } from "../uploads";

type SavePrivateEntryInput = {
  id?: string;
  ownerId: string;
  kind: PrivateEntryKind;
  title: string;
  body: string;
  instrument: string;
  market: string;
  timeframe: string;
  tags: string[];
  knowledgeIds: string[];
  reviewData: PrivateEntryReviewData;
  keptImageIds: string[];
  files: File[];
};

export type PrivateEntrySaveResult = { id: string; cleanupPending: boolean };

type WorkbenchGateway = {
  makeId(): string;
  upload(path: string, file: File): Promise<void>;
  upsertEntry(value: Record<string, unknown>): Promise<void>;
  insertImages(rows: Record<string, unknown>[]): Promise<void>;
  deleteImageRows(ids: string[]): Promise<void>;
  removeFiles(paths: string[]): Promise<void>;
  removeEntry(id: string): Promise<void>;
  saveAtomically?(value: Record<string, unknown>, images: Record<string, unknown>[]): Promise<void>;
};

function unwrap(result: { error: unknown }) {
  if (result.error) throw result.error;
}

function defaultGateway(client: SupabaseClient): WorkbenchGateway {
  return {
    makeId: () => crypto.randomUUID(),
    async upload(path, file) {
      unwrap(await client.storage.from("private-entry-images").upload(path, file, { upsert: false, contentType: file.type, cacheControl: "3600" }));
    },
    async upsertEntry(value) {
      unwrap(await client.from("private_entries").upsert(value));
    },
    async insertImages(rows) {
      if (rows.length) unwrap(await client.from("private_entry_images").insert(rows));
    },
    async deleteImageRows(ids) {
      if (ids.length) unwrap(await client.from("private_entry_images").delete().in("id", ids));
    },
    async removeFiles(paths) {
      if (paths.length) unwrap(await client.storage.from("private-entry-images").remove(paths));
    },
    async removeEntry(id) {
      unwrap(await client.from("private_entries").delete().eq("id", id));
    },
    async saveAtomically(value, images) {
      unwrap(await client.rpc("save_private_entry_v2", {
        p_entry_id: value.id,
        p_kind: value.kind,
        p_title: value.title,
        p_body: value.body,
        p_instrument: value.instrument,
        p_market: value.market,
        p_timeframe: value.timeframe,
        p_tags: value.tags,
        p_knowledge_ids: value.knowledge_ids,
        p_review_data: value.review_data,
        p_images: images,
      }));
    },
  };
}

function imageExtension(type: string): string | null {
  if (type === "image/jpeg") return "jpg";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return null;
}

export async function savePrivateEntry(
  client: SupabaseClient,
  input: SavePrivateEntryInput,
  existing?: PrivateEntry,
  injectedGateway?: WorkbenchGateway,
): Promise<PrivateEntrySaveResult> {
  if (existing && (existing.id !== input.id || existing.owner_id !== input.ownerId)) throw new Error("你不能编辑这条记录。");
  const gateway = injectedGateway ?? defaultGateway(client);
  const entryId = input.id || gateway.makeId();
  const uploadedPaths: string[] = [];
  const imageRows: Record<string, unknown>[] = [];
  const keptIds = new Set(input.keptImageIds);
  const kept = existing?.private_entry_images.filter((image) => keptIds.has(image.id)) ?? [];
  const removed = existing?.private_entry_images.filter((image) => !keptIds.has(image.id)) ?? [];

  try {
    const uploads = input.files.map((file, index) => {
      const extension = imageExtension(file.type);
      if (!extension) throw new Error("图片只支持 JPG、PNG 或 WebP。");
      const path = `${input.ownerId}/${entryId}/${gateway.makeId()}.${extension}`;
      uploadedPaths.push(path);
      imageRows.push({
        entry_id: entryId,
        owner_id: input.ownerId,
        storage_path: path,
        sort_order: kept.length + index,
      });
      return { path, file };
    });
    await mapWithConcurrency(uploads, 3, ({ path, file }) => gateway.upload(path, file));
    const entryValue = {
      id: entryId,
      owner_id: input.ownerId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      instrument: input.instrument,
      market: input.market,
      timeframe: input.timeframe,
      tags: input.tags,
      knowledge_ids: input.knowledgeIds,
      review_data: input.reviewData,
    };
    const allImages = [
      ...kept.map((image, sortOrder) => ({ storage_path: image.storage_path, sort_order: sortOrder })),
      ...imageRows,
    ];
    if (gateway.saveAtomically) await gateway.saveAtomically(entryValue, allImages);
    else {
      await gateway.upsertEntry(entryValue);
      await gateway.deleteImageRows(removed.map((image) => image.id));
      await gateway.insertImages(imageRows);
    }
  } catch (error) {
    await gateway.removeFiles(uploadedPaths).catch(() => undefined);
    if (!existing) await gateway.removeEntry(entryId).catch(() => undefined);
    throw error;
  }

  let cleanupPending = false;
  if (removed.length) {
    try {
      await gateway.removeFiles(removed.map((image) => image.storage_path));
    } catch {
      cleanupPending = true;
    }
  }
  return { id: entryId, cleanupPending };
}

export async function softDeletePrivateEntry(client: SupabaseClient, entry: PrivateEntry, ownerId: string) {
  if (entry.owner_id !== ownerId) throw new Error("你不能删除这条记录。");
  const result = await client.from("private_entries").update({ deleted_at: new Date().toISOString() }).eq("id", entry.id).eq("owner_id", ownerId);
  if (result.error) throw result.error;
}
