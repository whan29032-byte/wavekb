import { NextResponse, type NextRequest } from "next/server";
import { parseYoutubeConnection, sanitizeYoutubeErrorCode, youtubeStatePattern } from "@/lib/youtube/contracts";
import { youtubeActor, youtubeCookieOptions, youtubeGateway, youtubeStateCookie } from "@/lib/youtube/server";

function redirect(result: "connected" | "error" | "cancelled", error?: unknown) {
  const query = new URLSearchParams({ youtube: result });
  if (result === "error") query.set("youtube_error", sanitizeYoutubeErrorCode(error));
  const response = new NextResponse(null, { status: 303, headers: { location: `/member/profile?${query}`, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  response.cookies.set(youtubeStateCookie, "", { ...youtubeCookieOptions, maxAge: 0 });
  return response;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const state = params.get("state");
  const code = params.get("code");
  if (request.url.length > 8192 || params.getAll("state").length !== 1 || !state || !youtubeStatePattern.test(state)
    || params.getAll("code").length > 1 || params.getAll("error").length > 1) return redirect("error", "youtube_state_invalid");
  const actor = await youtubeActor();
  if (!actor || request.cookies.get(youtubeStateCookie)?.value !== `${actor.id}.${state}`) return redirect("error", actor ? "youtube_state_invalid" : "authentication_required");
  if (params.get("error")) return redirect(params.get("error") === "access_denied" ? "cancelled" : "error", "youtube_oauth_failed");
  if (!code || code.length > 2048 || !/^[A-Za-z0-9._~+/-]+$/.test(code)) return redirect("error", "youtube_state_invalid");
  try {
    const result = await youtubeGateway("callback", actor, { code, state });
    if (!result.ok) return redirect("error", result.payload?.error);
    if (parseYoutubeConnection(result.payload.connection).status !== "connected") return redirect("error", "youtube_reconnect_required");
    return redirect("connected");
  } catch { return redirect("error", "youtube_unavailable"); }
}
