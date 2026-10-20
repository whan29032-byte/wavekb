import type { SupabaseClient } from "@supabase/supabase-js";

const extensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function uploadRewardImage(
  client: SupabaseClient,
  file: File,
  prefix: "products" | "lottery",
): Promise<string> {
  const extension = extensions[file.type];
  if (!extension) throw new Error("只支持 JPG、PNG 或 WebP 图片。");
  if (file.size > 5 * 1024 * 1024) throw new Error("图片不能超过 5MB。");
  const path = `${prefix}/${crypto.randomUUID()}.${extension}`;
  const upload = await client.storage.from("reward-images").upload(path, file, {
    upsert: false,
    contentType: file.type,
    cacheControl: "31536000",
  });
  if (upload.error) throw upload.error;
  const publicUrl = client.storage.from("reward-images").getPublicUrl(path).data.publicUrl;
  if (!publicUrl?.startsWith("https://")) throw new Error("图片上传后没有生成公开地址。");
  return publicUrl;
}
