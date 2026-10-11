export const VISION_MAX_IMAGES = 3;
export const VISION_MAX_BYTES = 2 * 1024 * 1024;

function invalid(): never {
  throw Object.assign(new Error("invalid_image_input"), { code: "invalid_image_input" });
}

/** Shared browser-safe IDs only; this contract never accepts paths, URLs or bytes. */
export function normalizeVisionImageIds(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > VISION_MAX_IMAGES
    || Reflect.ownKeys(value).length !== value.length + 1
    || Reflect.ownKeys(value).some((key) => key !== "length" && (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/u.test(key)
      || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, "value")))
    || value.some((id) => typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id))) invalid();
  const ids = value.map((id: string) => id.toLowerCase());
  if (new Set(ids).size !== ids.length) invalid();
  return ids;
}
