import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { gatewayRequestOrigin } from "@/lib/auth/gateway-origin";
import { requirePublicSupabaseConfig } from "@/lib/env";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_request: "请输入有效的邮箱或 5-6 位 UID。",
  invalid_credentials: "账号或密码不正确。",
  account_banned: "这个账号当前无法登录。",
  rate_limited: "尝试次数过多，请稍后再试。",
  service_unavailable: "登录服务暂时不可用，请稍后再试。",
};

function json(body: object, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { identifier?: string; password?: string } | null;
  const identifier = String(body?.identifier ?? "").trim();
  const password = String(body?.password ?? "");
  const validIdentifier = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier) || /^[1-9]\d{4,5}$/.test(identifier);
  if (!validIdentifier || !password || password.length > 1024) return json({ error: "请填写有效账号和密码。" }, 400);

  const requestOrigin = gatewayRequestOrigin(request.headers, request.nextUrl.origin);
  if (!requestOrigin) return json({ error: "请求来源无效，请刷新页面后重试。" }, 403);

  const gatewayOrigin = (process.env.AUTH_GATEWAY_INTERNAL_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
  let upstream: Response;
  try {
    upstream = await fetch(`${gatewayOrigin}/api/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: requestOrigin,
        "x-forwarded-for": request.headers.get("x-forwarded-for") || "127.0.0.1",
      },
      body: JSON.stringify({ identifier, password }),
      cache: "no-store",
    });
  } catch {
    return json({ error: ERROR_MESSAGES.service_unavailable }, 503);
  }

  const payload = await upstream.json().catch(() => ({})) as {
    error?: string;
    session?: {
      access_token?: string;
      refresh_token?: string;
      user?: { public_uid?: number | null };
    };
  };
  if (!upstream.ok || !payload.session?.access_token || !payload.session.refresh_token) {
    const message = ERROR_MESSAGES[payload.error ?? ""] || ERROR_MESSAGES.service_unavailable;
    return json({ error: message }, upstream.status || 503);
  }

  const response = json({ ok: true, needsUidActivation: payload.session.user?.public_uid == null });
  const { url, key } = requirePublicSupabaseConfig();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const result = await supabase.auth.setSession({
    access_token: payload.session.access_token,
    refresh_token: payload.session.refresh_token,
  });
  if (result.error) return json({ error: ERROR_MESSAGES.service_unavailable }, 503);
  return response;
}
