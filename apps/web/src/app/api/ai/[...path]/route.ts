import { NextResponse, type NextRequest } from "next/server";
import { isAllowedAiBodyLength, isAllowedAiPath } from "@/lib/ai/paths";
import { gatewayRequestOrigin } from "@/lib/auth/gateway-origin";
import { publicSupabaseConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

function json(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

async function proxy(request: NextRequest, segments: string[], method: "GET" | "POST") {
  let path = "";
  try { path = segments.map((item) => decodeURIComponent(item)).join("/"); } catch { return json({ error: "not_found" }, 404); }
  if (!isAllowedAiPath(path, method)) return json({ error: "not_found" }, 404);
  if (!publicSupabaseConfig().configured) return json({ error: "authentication_required" }, 401);
  if (method === "POST" && !gatewayRequestOrigin(request.headers, request.nextUrl.origin)) return json({ error: "request_origin_invalid" }, 403);

  const client = await createClient();
  const [userResult, sessionResult] = await Promise.all([client.auth.getUser(), client.auth.getSession()]);
  const accessToken = sessionResult.data.session?.access_token;
  if (!userResult.data.user || !accessToken) return json({ error: "authentication_required" }, 401);

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (method === "POST" && !isAllowedAiBodyLength(declaredLength)) return json({ error: "payload_too_large" }, 413);
  const body = method === "POST" ? await request.text() : undefined;
  if (body && !isAllowedAiBodyLength(new TextEncoder().encode(body).byteLength)) return json({ error: "payload_too_large" }, 413);

  const origin = (process.env.AUTH_GATEWAY_INTERNAL_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
  let upstream: Response;
  try {
    upstream = await fetch(`${origin}/v1/${path}`, {
      method,
      headers: { authorization: `Bearer ${accessToken}`, ...(method === "POST" ? { "content-type": "application/json" } : {}) },
      body,
      cache: "no-store",
    });
  } catch {
    return json({ error: "ai_gateway_unavailable" }, 503);
  }
  const payload = await upstream.json().catch(() => ({ error: "request_failed" })) as object;
  return json(payload, upstream.status);
}

type PathContext = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, context: PathContext) {
  return proxy(request, (await context.params).path || [], "GET");
}

export async function POST(request: NextRequest, context: PathContext) {
  return proxy(request, (await context.params).path || [], "POST");
}
