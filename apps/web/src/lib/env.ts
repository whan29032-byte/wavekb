export function publicSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
  return { url, key, configured: Boolean(url && key) };
}

export function requirePublicSupabaseConfig() {
  const config = publicSupabaseConfig();
  if (!config.configured) {
    throw new Error("Supabase 尚未配置，请检查 NEXT_PUBLIC_SUPABASE_URL 和 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY。");
  }
  return { url: config.url, key: config.key };
}

export function legacySiteUrl() {
  return (process.env.NEXT_PUBLIC_LEGACY_SITE_URL || "https://wavekb.com").replace(/\/$/, "");
}

export function publicPostImageUrl(storagePath: string) {
  const { url, configured } = publicSupabaseConfig();
  if (!configured) return "";
  const encoded = storagePath.split("/").map(encodeURIComponent).join("/");
  return `${url}/storage/v1/object/public/post-images/${encoded}`;
}

export function publicChatStickerUrl(storagePath: string) {
  const { url, configured } = publicSupabaseConfig();
  if (!configured) return "";
  const encoded = storagePath.split("/").map(encodeURIComponent).join("/");
  return `${url}/storage/v1/object/public/chat-stickers/${encoded}`;
}
