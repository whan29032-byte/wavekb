import { isGoogleYoutubeAuthorization, parseYoutubeConnection, parseYoutubeStatus } from "./contracts";
import type { YoutubeConnection, YoutubeConnectionStatus } from "./contracts";

async function request(action: string, body?: object): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`/api/youtube/${action}`, {
      method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
      ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(25_000),
    });
  } catch { throw new Error("youtube_gateway_unavailable"); }
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw new Error(typeof payload?.error === "string" && /^[a-z0-9_]{1,100}$/.test(payload.error) ? payload.error : "youtube_request_failed");
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("youtube_response_invalid");
  return payload;
}

export async function readYoutubeConnection(): Promise<YoutubeConnectionStatus> {
  return parseYoutubeStatus(await request("connection"));
}
export async function authorizeYoutube(options: { importHistory: boolean; autoSync: boolean }): Promise<string> {
  const payload = await request("authorize", options);
  if (!isGoogleYoutubeAuthorization(payload.authorizationUrl)) throw new Error("youtube_response_invalid");
  return payload.authorizationUrl;
}
export async function setYoutubeSync(syncEnabled: boolean): Promise<YoutubeConnection> {
  return parseYoutubeConnection((await request("settings", { syncEnabled })).connection);
}
export async function importYoutubeHistory(): Promise<YoutubeConnection> {
  return parseYoutubeConnection((await request("import-history", {})).connection);
}
export async function disconnectYoutube(): Promise<{ removedPosts: number; remoteRevocationPending: boolean }> {
  const payload = await request("disconnect", { confirmRemoveSyncedPosts: true });
  if (payload.disconnected !== true || !Number.isSafeInteger(payload.removedPosts) || Number(payload.removedPosts) < 0
    || !(payload.remoteRevocationPending === undefined || typeof payload.remoteRevocationPending === "boolean")) throw new Error("youtube_response_invalid");
  return { removedPosts: Number(payload.removedPosts), remoteRevocationPending: payload.remoteRevocationPending === true };
}
