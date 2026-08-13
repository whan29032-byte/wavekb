import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatSticker } from "@wavekb/domain";

const MIME_EXTENSIONS = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
} as const;

export function resolvedStickerMime(file: Pick<File, "type" | "name">): keyof typeof MIME_EXTENSIONS | null {
  const declared = file.type.toLowerCase() as keyof typeof MIME_EXTENSIONS;
  if (declared in MIME_EXTENSIONS) return declared;
  const extension = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" } as const)[extension as "png"] ?? null;
}

export function validateStickerFile(file: File) {
  if (!resolvedStickerMime(file)) return "请选择 PNG、JPEG、GIF 或 WebP 图片。";
  if (!Number.isFinite(file.size) || file.size < 1 || file.size > 12 * 1024 * 1024) return "表情图片不能超过 12 MB。";
  return "";
}

export function customStickerToken(sticker: Pick<ChatSticker, "storage_path" | "label">) {
  return `[[custom-sticker:${encodeURIComponent(sticker.storage_path)}|${encodeURIComponent(sticker.label.slice(0, 40))}]]`;
}

export async function uploadChatSticker(client: SupabaseClient, userId: string, file: File): Promise<ChatSticker> {
  const validation = validateStickerFile(file);
  if (validation) throw new Error(validation);
  const mimeType = resolvedStickerMime(file)!;
  const id = crypto.randomUUID();
  const storagePath = `${userId}/${id}.${MIME_EXTENSIONS[mimeType]}`;
  const upload = await client.storage.from("chat-stickers").upload(storagePath, file, {
    upsert: false,
    contentType: mimeType,
    cacheControl: "31536000",
  });
  if (upload.error) throw upload.error;
  const insert = await client.from("chat_stickers").insert({
    id,
    owner_id: userId,
    storage_path: storagePath,
    label: file.name.replace(/\.[^.]+$/, "").slice(0, 40) || "自定义表情",
    mime_type: mimeType,
  }).select("id,owner_id,storage_path,label,mime_type,created_at").single();
  if (insert.error) {
    await client.storage.from("chat-stickers").remove([storagePath]).catch(() => undefined);
    throw insert.error;
  }
  return insert.data as ChatSticker;
}

export async function deleteChatSticker(client: SupabaseClient, sticker: ChatSticker) {
  const row = await client.from("chat_stickers").delete().eq("id", sticker.id).eq("owner_id", sticker.owner_id);
  if (row.error) throw row.error;
  // Message bodies reference this immutable object path. Removing the library row
  // must not turn already-sent messages into broken images.
}
