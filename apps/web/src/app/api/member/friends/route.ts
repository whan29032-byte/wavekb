import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { FriendshipRpcError, loadFriendships } from "@/lib/member/friendships";
import { createClient } from "@/lib/supabase/server";

function json(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function diagnostic(error: unknown, rpc?: string) {
  if (error instanceof FriendshipRpcError) {
    return {
      route: "/api/member/friends",
      rpc: error.rpc,
      status: error.status ?? null,
      code: error.code ?? null,
      message: error.message.slice(0, 500),
      details: error.details?.slice(0, 500) ?? null,
      hint: error.hint?.slice(0, 500) ?? null,
    };
  }
  const value = error as { code?: unknown; message?: unknown } | null;
  return {
    route: "/api/member/friends",
    rpc: rpc || "friendship_auth",
    status: typeof value === "object" && value && "status" in value ? Number((value as { status?: unknown }).status) || null : null,
    code: String(value?.code ?? "unknown"),
    message: String(value?.message ?? error ?? "unknown").slice(0, 500),
    details: typeof value === "object" && value && "details" in value ? String((value as { details?: unknown }).details ?? "").slice(0, 500) || null : null,
    hint: typeof value === "object" && value && "hint" in value ? String((value as { hint?: unknown }).hint ?? "").slice(0, 500) || null : null,
  };
}

async function authContext() {
  const client = await createClient();
  const auth = await client.auth.getUser();
  const cookieNames = (await cookies()).getAll().map(({ name }) => name);
  const authCookieCount = cookieNames.filter((name) => /^sb-.*-auth-token(?:\.\d+)?$/.test(name)).length;
  return { client, auth, authCookieCount };
}

function logFailure(operation: string, error: unknown, authCookieCount: number, rpc?: string) {
  console.error(`[friends.${operation}]`, { ...diagnostic(error, rpc), authCookieCount });
}

export async function GET(request: NextRequest) {
  const { client, auth, authCookieCount } = await authContext();
  if (auth.error || !auth.data.user) {
    logFailure("read", auth.error ?? new Error("authenticated user missing"), authCookieCount);
    return json({ error: "authentication_required" }, 401);
  }

  try {
    const connections = await loadFriendships(client);
    if (request.nextUrl.searchParams.get("desktop") !== "1") {
      return json({ actorId: auth.data.user.id, connections, count: connections.length });
    }
    const [profile, conversations] = await Promise.all([
      client.from("profiles").select("id,public_uid,display_name,avatar_url,role,display_title,nameplate_style").eq("id", auth.data.user.id).maybeSingle(),
      client.rpc("list_my_conversations_v2"),
    ]);
    if (profile.error) throw Object.assign(profile.error, { rpc: "profiles" });
    if (!profile.data) throw Object.assign(new Error("member profile missing"), { rpc: "profiles" });
    if (conversations.error) throw Object.assign(conversations.error, { rpc: "list_my_conversations_v2" });
    return json({
      actorId: auth.data.user.id,
      actor: profile.data,
      connections,
      conversations: conversations.data ?? [],
      count: connections.length,
    });
  } catch (error) {
    const rpc = typeof error === "object" && error && "rpc" in error ? String((error as { rpc?: unknown }).rpc ?? "friendship_read") : undefined;
    logFailure("read", error, authCookieCount, rpc);
    return json({ error: "friendships_unavailable" }, 502);
  }
}

export async function POST(request: NextRequest) {
  const { client, auth, authCookieCount } = await authContext();
  if (auth.error || !auth.data.user) {
    logFailure("write", auth.error ?? new Error("authenticated user missing"), authCookieCount);
    return json({ error: "authentication_required" }, 401);
  }

  const body = await request.json().catch(() => null) as {
    action?: unknown;
    uid?: unknown;
    targetId?: unknown;
    friendshipId?: unknown;
    accept?: unknown;
  } | null;
  const action = String(body?.action ?? "");

  try {
    if (action === "search") {
      const uid = Number(body?.uid);
      if (!Number.isInteger(uid) || uid < 10_000 || uid > 999_999) return json({ error: "invalid_uid" }, 400);
      const result = await client.rpc("search_profile_by_uid", { p_uid: uid });
      if (result.error) throw Object.assign(result.error, { rpc: "search_profile_by_uid" });
      const profile = Array.isArray(result.data) ? result.data[0] ?? null : result.data ?? null;
      return json({ profile });
    }

    if (action === "request") {
      const targetId = String(body?.targetId ?? "");
      if (!UUID.test(targetId) || targetId === auth.data.user.id) return json({ error: "invalid_friend_target" }, 400);
      const result = await client.rpc("send_friend_request", { p_target: targetId });
      if (result.error) throw Object.assign(result.error, { rpc: "send_friend_request" });
      const connections = await loadFriendships(client);
      return json({ friendshipId: String(result.data), connections });
    }

    if (action === "respond") {
      const friendshipId = String(body?.friendshipId ?? "");
      if (!UUID.test(friendshipId) || typeof body?.accept !== "boolean") return json({ error: "invalid_friend_response" }, 400);
      const result = await client.rpc("respond_friend_request", { p_friendship: friendshipId, p_accept: body.accept });
      if (result.error) throw Object.assign(result.error, { rpc: "respond_friend_request" });
      const connections = await loadFriendships(client);
      return json({ ok: true, connections });
    }

    if (action === "conversation") {
      const targetId = String(body?.targetId ?? "");
      if (!UUID.test(targetId) || targetId === auth.data.user.id) return json({ error: "invalid_conversation_target" }, 400);
      const result = await client.rpc("open_direct_conversation", { p_target: targetId });
      if (result.error) throw Object.assign(result.error, { rpc: "open_direct_conversation" });
      return json({ conversationId: String(result.data) });
    }

    return json({ error: "invalid_action" }, 400);
  } catch (error) {
    const rpc = typeof error === "object" && error && "rpc" in error ? String((error as { rpc?: unknown }).rpc ?? "friendship_write") : "friendship_write";
    logFailure(action || "write", error, authCookieCount, rpc);
    return json({ error: "friendship_action_failed" }, 502);
  }
}
