import { type NextRequest } from "next/server";
import { gatewayRequestOrigin } from "@/lib/auth/gateway-origin";
import { isGoogleYoutubeAuthorization, parseYoutubeConnection, parseYoutubeStatus, youtubeStatePattern } from "@/lib/youtube/contracts";
import { sanitizedYoutubeError, youtubeActor, youtubeCookieOptions, youtubeGateway, youtubeJson, youtubeStateCookie } from "@/lib/youtube/server";

type Context = { params: Promise<{ action: string }> };
const operations = new Set(["authorize", "settings", "import-history", "disconnect"]);

export async function GET(_request: NextRequest, context: Context) {
  if ((await context.params).action !== "connection") return youtubeJson({ error: "not_found" }, 404);
  const actor = await youtubeActor();
  if (!actor) return youtubeJson({ error: "authentication_required" }, 401);
  try {
    const result = await youtubeGateway("connection", actor);
    if (!result.ok) return youtubeJson({ error: sanitizedYoutubeError(result.payload?.error) }, result.status);
    return youtubeJson(parseYoutubeStatus(result.payload));
  } catch { return youtubeJson({ error: "youtube_gateway_unavailable" }, 503); }
}

export async function POST(request: NextRequest, context: Context) {
  const action = (await context.params).action;
  if (!operations.has(action)) return youtubeJson({ error: "not_found" }, 404);
  const requestOrigin = request.headers.get("origin") && gatewayRequestOrigin(request.headers, request.nextUrl.origin);
  if (!requestOrigin) return youtubeJson({ error: "request_origin_invalid" }, 403);
  const actor = await youtubeActor();
  if (!actor) return youtubeJson({ error: "authentication_required" }, 401);
  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > 4096) return youtubeJson({ error: "payload_too_large" }, 413);
    body = JSON.parse(text) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
  } catch { return youtubeJson({ error: "invalid_request" }, 400); }
  let safeBody: object;
  if (action === "authorize" && typeof body.importHistory === "boolean" && typeof body.autoSync === "boolean") safeBody = { importHistory: body.importHistory, autoSync: body.autoSync };
  else if (action === "settings" && typeof body.syncEnabled === "boolean") safeBody = { syncEnabled: body.syncEnabled };
  else if (action === "import-history") safeBody = {};
  else if (action === "disconnect" && body.confirmRemoveSyncedPosts === true) safeBody = { confirmRemoveSyncedPosts: true };
  else return youtubeJson({ error: "invalid_request" }, 400);
  try {
    const result = await youtubeGateway(action as "authorize" | "settings" | "import-history" | "disconnect", actor, safeBody);
    if (!result.ok) return youtubeJson({ error: sanitizedYoutubeError(result.payload?.error) }, result.status);
    if (action === "authorize") {
      const { state, authorizationUrl } = result.payload;
      if (typeof state !== "string" || !youtubeStatePattern.test(state) || !isGoogleYoutubeAuthorization(authorizationUrl, state, requestOrigin)) throw new Error();
      const response = youtubeJson({ authorizationUrl });
      response.cookies.set(youtubeStateCookie, `${actor.id}.${state}`, youtubeCookieOptions);
      return response;
    }
    if (action === "disconnect") {
      if (result.payload.disconnected !== true || !Number.isSafeInteger(result.payload.removedPosts) || Number(result.payload.removedPosts) < 0
        || !(result.payload.remoteRevocationPending === undefined || typeof result.payload.remoteRevocationPending === "boolean")) throw new Error();
      return youtubeJson({ disconnected: true, removedPosts: Number(result.payload.removedPosts), remoteRevocationPending: result.payload.remoteRevocationPending === true });
    }
    return youtubeJson({ connection: parseYoutubeConnection(result.payload.connection) });
  } catch { return youtubeJson({ error: "youtube_gateway_unavailable" }, 503); }
}
