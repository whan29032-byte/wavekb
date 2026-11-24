import { NextResponse, type NextRequest } from "next/server";
import { gatewayRequestOrigin } from "@/lib/auth/gateway-origin";
import { publicSupabaseConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

function json(body: object, status = 200) { return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } }); }

type Method = "GET" | "POST" | "PUT";

function destination(segments: string[], method: Method) {
  if (method === "GET" && segments.length === 1 && segments[0] === "workbench") return "/v1/user/trading-workbench";
  if (method === "GET" && segments.length === 2 && segments[0] === "trades" && segments[1]) return `/v1/user/trading-trades/${encodeURIComponent(segments[1])}`;
  if (method === "PUT" && segments.length === 3 && segments[0] === "trades" && segments[1] && segments[2] === "review") return `/v1/user/trading-trades/${encodeURIComponent(segments[1])}/review`;
  if (method === "POST" && segments.length === 3 && segments[0] === "trades" && segments[1] && segments[2] === "ai-review") return `/v1/user/trading-trades/${encodeURIComponent(segments[1])}/ai-review`;
  return null;
}

async function proxy(request: NextRequest, segments: string[], method: Method) {
  let decoded: string[];
  try { decoded = segments.map((item) => decodeURIComponent(item)); } catch { return json({ error: "not_found" }, 404); }
  const target = destination(decoded, method); if (!target) return json({ error: "not_found" }, 404);
  if (!publicSupabaseConfig().configured) return json({ error: "authentication_required" }, 401);
  if (method !== "GET" && !gatewayRequestOrigin(request.headers, request.nextUrl.origin)) return json({ error: "request_origin_invalid" }, 403);
  const client = await createClient();
  const [userResult, sessionResult] = await Promise.all([client.auth.getUser(), client.auth.getSession()]);
  const token = sessionResult.data.session?.access_token;
  if (!userResult.data.user || !token) return json({ error: "authentication_required" }, 401);
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (method !== "GET" && (!Number.isFinite(declaredLength) || declaredLength > 32 * 1024)) return json({ error: "payload_too_large" }, 413);
  const body = method !== "GET" ? await request.text() : undefined;
  if (body && new TextEncoder().encode(body).byteLength > 32 * 1024) return json({ error: "payload_too_large" }, 413);
  const origin = (process.env.AUTH_GATEWAY_INTERNAL_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
  try {
    const upstream = await fetch(`${origin}${target}${method === "GET" ? request.nextUrl.search : ""}`, {
      method, cache: "no-store", headers: { authorization: `Bearer ${token}`, ...(method !== "GET" ? { "content-type": "application/json" } : {}) }, body,
    });
    const payload = await upstream.json().catch(() => ({ error: "request_failed" })) as object;
    return json(payload, upstream.status);
  } catch { return json({ error: "trading_gateway_unavailable" }, 503); }
}

type Context = { params: Promise<{ path: string[] }> };
export async function GET(request: NextRequest, context: Context) { return proxy(request, (await context.params).path || [], "GET"); }
export async function POST(request: NextRequest, context: Context) { return proxy(request, (await context.params).path || [], "POST"); }
export async function PUT(request: NextRequest, context: Context) { return proxy(request, (await context.params).path || [], "PUT"); }
