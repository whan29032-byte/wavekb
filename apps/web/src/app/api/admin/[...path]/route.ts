import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAllowedAdminPath } from "@/lib/admin/paths";

function json(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

async function proxy(request: NextRequest, segments: string[], method: "GET" | "POST") {
  const path = segments.map((item) => decodeURIComponent(item)).join("/");
  if (!isAllowedAdminPath(path, method)) return json({ error: "admin_path_not_allowed" }, 404);
  const client = await createClient();
  const [userResult, sessionResult] = await Promise.all([client.auth.getUser(), client.auth.getSession()]);
  const accessToken = sessionResult.data.session?.access_token;
  if (!userResult.data.user || !accessToken) return json({ error: "authentication_required" }, 401);
  const origin = (process.env.AUTH_GATEWAY_INTERNAL_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
  let upstream: Response;
  try {
    upstream = await fetch(`${origin}/v1/admin/${path}${method === "GET" ? request.nextUrl.search : ""}`, {
      method,
      headers: { authorization: `Bearer ${accessToken}`, ...(method === "POST" ? { "content-type": "application/json" } : {}) },
      body: method === "POST" ? await request.text() : undefined,
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
