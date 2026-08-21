import { NextResponse, type NextRequest } from "next/server";
import { gatewayRequestOrigin } from "@/lib/auth/gateway-origin";
import { publicSupabaseConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!gatewayRequestOrigin(request.headers, request.nextUrl.origin)) return json({ error: "request_origin_invalid" }, 403);
  const postId = (await context.params).id;
  if (!UUID_PATTERN.test(postId)) return json({ error: "invalid_post_id" }, 400);
  if (!publicSupabaseConfig().configured) return json({ error: "authentication_required" }, 401);

  const client = await createClient();
  const [userResult, sessionResult] = await Promise.all([client.auth.getUser(), client.auth.getSession()]);
  const accessToken = sessionResult.data.session?.access_token;
  if (!userResult.data.user || !accessToken) return json({ error: "authentication_required" }, 401);

  const origin = (process.env.AUTH_GATEWAY_INTERNAL_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
  let upstream: Response;
  try {
    upstream = await fetch(`${origin}/v1/community/posts/${encodeURIComponent(postId)}/delete`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: "{}",
      cache: "no-store",
    });
  } catch {
    return json({ error: "post_delete_unavailable" }, 503);
  }
  const payload = await upstream.json().catch(() => ({ error: "post_delete_failed" })) as object;
  return json(payload, upstream.status);
}
