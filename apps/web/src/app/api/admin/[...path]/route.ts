import { NextResponse, type NextRequest } from "next/server";
import { publicSupabaseConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { isAllowedAdminBodyLength, isAllowedAdminPath } from "@/lib/admin/paths";

function json(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

async function proxy(request: NextRequest, segments: string[], method: "GET" | "POST") {
  let path = "";
  try { path = segments.map((item) => decodeURIComponent(item)).join("/"); } catch { return json({ error: "admin_path_not_allowed" }, 404); }
  if (!isAllowedAdminPath(path, method)) return json({ error: "admin_path_not_allowed" }, 404);
  if (!publicSupabaseConfig().configured) return json({ error: "authentication_required" }, 401);
  const client = await createClient();
  const [userResult, sessionResult] = await Promise.all([client.auth.getUser(), client.auth.getSession()]);
  const accessToken = sessionResult.data.session?.access_token;
  if (!userResult.data.user || !accessToken) return json({ error: "authentication_required" }, 401);
  const origin = (process.env.AUTH_GATEWAY_INTERNAL_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (method === "POST" && !isAllowedAdminBodyLength(declaredLength)) return json({ error: "admin_payload_too_large" }, 413);
  const body = method === "POST" ? await request.text() : undefined;
  if (body && !isAllowedAdminBodyLength(new TextEncoder().encode(body).byteLength)) return json({ error: "admin_payload_too_large" }, 413);
  let upstream: Response;
  try {
    upstream = await fetch(`${origin}/v1/admin/${path}${method === "GET" ? request.nextUrl.search : ""}`, {
      method,
      headers: { authorization: `Bearer ${accessToken}`, ...(method === "POST" ? { "content-type": "application/json" } : {}) },
      body,
      cache: "no-store",
    });
  } catch {
    return json({ error: "administration_unavailable" }, 503);
  }
  const payload = await upstream.json().catch(() => ({ error: "administration_failed" }));
  return json(payload, upstream.status);
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxy(request, (await context.params).path || [], "GET");
}

export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxy(request, (await context.params).path || [], "POST");
}
