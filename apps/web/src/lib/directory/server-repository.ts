import "server-only";

export type DirectoryResource = {
  id: string;
  platform: "x" | "discord";
  name: string;
  description: string;
  url: string;
  avatar_url: string | null;
  sort_order: number;
};

export async function listPublicDirectory(): Promise<DirectoryResource[]> {
  const origin = (process.env.AUTH_GATEWAY_INTERNAL_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
  try {
    const response = await fetch(`${origin}/api/directory`, { cache: "no-store" });
    if (!response.ok) return [];
    const payload = await response.json() as { resources?: DirectoryResource[] };
    return (Array.isArray(payload.resources) ? payload.resources : [])
      .filter((item) => item?.platform === "x" || item?.platform === "discord")
      .sort((left, right) => Number(left.sort_order || 0) - Number(right.sort_order || 0));
  } catch {
    return [];
  }
}
