(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.ElliottAvatarEditor = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
  const MAX_BYTES = 5_000_000;

  function validateAvatarMeta(file) {
    if (!TYPES.has(String(file && file.type || ""))) {
      return {ok: false, error: "头像只支持 JPG、PNG 或 WebP。"};
    }
    if (Number(file && file.size || 0) > MAX_BYTES) {
      return {ok: false, error: "头像文件不能超过 5 MB。"};
    }
    return {ok: true, error: ""};
  }

  function avatarStoragePath(userId, timestamp = Date.now()) {
    const safeUserId = String(userId || "").replace(/[^a-zA-Z0-9-]/g, "");
    if (!safeUserId) throw new Error("invalid user id");
    return `${safeUserId}/avatar-${Number(timestamp)}.webp`;
  }

  async function cropAvatarFile(file, size = 512) {
    const validation = validateAvatarMeta(file);
    if (!validation.ok) throw new Error(validation.error);
    if (typeof createImageBitmap !== "function") {
      throw new Error("当前浏览器不支持头像裁切。");
    }
    const bitmap = await createImageBitmap(file);
    const cropSize = Math.min(bitmap.width, bitmap.height);
    const sourceX = Math.floor((bitmap.width - cropSize) / 2);
    const sourceY = Math.floor((bitmap.height - cropSize) / 2);
    const canvas = typeof OffscreenCanvas === "function"
      ? new OffscreenCanvas(size, size)
      : Object.assign(document.createElement("canvas"), {width: size, height: size});
    const context = canvas.getContext("2d");
    context.drawImage(
      bitmap,
      sourceX,
      sourceY,
      cropSize,
      cropSize,
      0,
      0,
      size,
      size
    );
    bitmap.close();
    if (typeof canvas.convertToBlob === "function") {
      return canvas.convertToBlob({type: "image/webp", quality: 0.9});
    }
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error("头像转换失败。")),
        "image/webp",
        0.9
      );
    });
  }

  return {
    MAX_BYTES,
    validateAvatarMeta,
    avatarStoragePath,
    cropAvatarFile
  };
});
