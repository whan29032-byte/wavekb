import "server-only";
import { NextResponse } from "next/server";
import { publicSupabaseConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { sanitizeYoutubeErrorCode } from "./contracts";

export const youtubeStateCookie = "__Secure-wavekb-youtube-state";
export const youtubeCookieOptions = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/api/youtube/callback", maxAge: 600 };

export function youtubeJson(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}
export function sanitizedYoutubeError(error: unknown) {
  return sanitizeYoutubeErrorCode(error);
}
export async function youtubeActor() {
  if (!publicSupabaseConfig().configured) return null;
  try {
    const client = await createClient();
    const [user, session] = await Promise.all([client.auth.getUser(), client.auth.getSession()]);
    const accessToken = session.data.session?.access_token;
    return !user.error && !session.error && user.data.user && accessToken ? { id: user.data.user.id, accessToken } : null;
  } catch { return null; }
}
export async function youtubeGateway(action: "connection" | "authorize" | "callback" | "settings" | "import-history" | "disconnect", actor: { accessToken: string }, body?: object) {
  const rawOrigin = process.env.AUTH_GATEWAY_INTERNAL_URL || "http://127.0.0.1:8787";
  let origin: string;
  try {
    const parsed = new URL(rawOrigin);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") throw new Error();
    origin = parsed.origin;
  } catch { throw new Error("youtube_gateway_unavailable"); }
  try {
    const upstream = await fetch(`${origin}/v1/youtube/${action}`, {
      method: body ? "POST" : "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20_000),
      headers: { authorization: `Bearer ${actor.accessToken}`, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await upstream.text();
    if (text.length > 128_000) throw new Error();
    const payload = JSON.parse(text) as Record<string, unknown>;
    return { ok: upstream.ok, status: upstream.status, payload };
  } catch { throw new Error("youtube_gateway_unavailable"); }
}
