import { NextResponse, type NextRequest } from "next/server";
import { gatewayRequestOrigin } from "@/lib/auth/gateway-origin";
import { isUidAction, isValidUid } from "@/lib/auth/uid-selection";
import { createClient } from "@/lib/supabase/server";

const ERROR_MESSAGES: Record<string, string> = {
  authentication_required: "登录状态已失效，请重新登录。",
  email_confirmation_required: "请先完成邮箱验证。",
  uid_selection_invalid: "UID 选择状态无效，请重新开始。",
  uid_selection_expired: "本轮 UID 选择已过期，请重新开始。",
  uid_refresh_exhausted: "可刷新次数已经用完，请从现有 UID 中选择。",
  uid_unavailable: "这个 UID 刚被占用，请换一个候选号码。",
  uid_already_assigned: "账号已经拥有 UID。",
  rate_limited: "操作过于频繁，请稍后再试。",
  service_unavailable: "账号服务暂时不可用，请稍后重试。",
};

function json(body: object, status = 200, retryAfter?: string | null) {
  return NextResponse.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      ...(retryAfter ? { "retry-after": retryAfter } : {}),
    },
  });
}

async function proxy(request: NextRequest, actionValue: string) {
  if (!isUidAction(actionValue)) return json({ error: "请求无效。" }, 404);
  if ((request.method === "GET") !== (actionValue === "status")) return json({ error: "请求无效。" }, 405);

  const requestOrigin = gatewayRequestOrigin(request.headers, request.nextUrl.origin);
  if (!requestOrigin) return json({ error: "请求来源无效，请刷新页面后重试。" }, 403);

  const supabase = await createClient();
  const [{ data: userData }, { data: sessionData }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.auth.getSession(),
  ]);
  const accessToken = sessionData.session?.access_token;
  if (!userData.user || !accessToken) return json({ error: ERROR_MESSAGES.authentication_required }, 401);

  let body: { uid?: unknown } = {};
  if (request.method === "POST") {
    const raw = await request.text();
    if (raw.length > 2048) return json({ error: "请求内容过大。" }, 413);
    try {
      body = raw ? JSON.parse(raw) as { uid?: unknown } : {};
    } catch {
      return json({ error: "请求内容格式无效。" }, 400);
    }
    if (actionValue === "select" && !isValidUid(body.uid)) return json({ error: "请选择有效 UID。" }, 400);
  }

  const gatewayOrigin = (process.env.AUTH_GATEWAY_INTERNAL_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
  let upstream: Response;
  try {
    upstream = await fetch(`${gatewayOrigin}/api/auth/uid-selection/${actionValue}`, {
      method: request.method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        origin: requestOrigin,
        "x-forwarded-for": request.headers.get("x-forwarded-for") || "127.0.0.1",
      },
      body: request.method === "POST" ? JSON.stringify(actionValue === "select" ? { uid: Number(body.uid) } : {}) : undefined,
      cache: "no-store",
    });
  } catch {
    return json({ error: ERROR_MESSAGES.service_unavailable }, 503);
  }
  const payload = await upstream.json().catch(() => ({})) as { error?: string; selection?: object };
  if (!upstream.ok) {
    return json({ error: ERROR_MESSAGES[payload.error ?? ""] || ERROR_MESSAGES.service_unavailable }, upstream.status || 503, upstream.headers.get("retry-after"));
  }
  return json({ selection: payload.selection });
}

type ActionContext = { params: Promise<{ action: string }> };

export async function GET(request: NextRequest, context: ActionContext) {
  const { action } = await context.params;
  return proxy(request, action);
}

export async function POST(request: NextRequest, context: ActionContext) {
  const { action } = await context.params;
  return proxy(request, action);
}
