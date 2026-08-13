import { PROFILE_IMAGE_MAX_BYTES, validateProfileImage } from "@wavekb/domain";

export async function cropAvatarFile(file: File, size = 512): Promise<File> {
  const validation = validateProfileImage(file, "头像");
  if (validation) throw new Error(validation);
  if (typeof createImageBitmap !== "function") throw new Error("当前浏览器不支持头像裁切。");
  const bitmap = await createImageBitmap(file);
  try {
    const sourceSize = Math.min(bitmap.width, bitmap.height);
    const sourceX = Math.floor((bitmap.width - sourceSize) / 2);
    const sourceY = Math.floor((bitmap.height - sourceSize) / 2);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("头像裁切失败。");
    context.drawImage(bitmap, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("头像转换失败。")), "image/webp", 0.9));
    if (blob.size > PROFILE_IMAGE_MAX_BYTES) throw new Error("处理后的头像超过 5 MiB。");
    return new File([blob], "avatar.webp", { type: "image/webp" });
  } finally {
    bitmap.close();
  }
}

export function profileImagePathFromPublicUrl(rawUrl: string | null, supabaseUrl: string, userId: string): string | null {
  if (!rawUrl) return null;
  try {
    const target = new URL(rawUrl);
    const root = new URL("/storage/v1/object/public/profile-avatars/", supabaseUrl);
    if (target.origin !== root.origin || !target.pathname.startsWith(root.pathname)) return null;
    const encodedPath = target.pathname.slice(root.pathname.length);
    const path = encodedPath.split("/").map(decodeURIComponent).join("/");
    const parts = path.split("/");
    if (parts.length !== 2 || parts[0] !== userId || !/^[a-z0-9][a-z0-9._-]*$/i.test(parts[1]) || parts[1] === "." || parts[1] === "..") return null;
    return path;
  } catch {
    return null;
  }
}
