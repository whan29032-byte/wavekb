import { NextResponse } from "next/server";
import { FriendshipRpcError, loadFriendships } from "@/lib/member/friendships";
import { createClient } from "@/lib/supabase/server";

function json(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

function diagnostic(error: unknown) {
  if (error instanceof FriendshipRpcError) {
    return {
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
    rpc: "friendship_auth",
    status: null,
    code: String(value?.code ?? "unknown"),
    message: String(value?.message ?? error ?? "unknown").slice(0, 500),
  };
}

export async function GET() {
  const client = await createClient();
  const auth = await client.auth.getUser();
  if (auth.error || !auth.data.user) {
    console.error("[friends.read]", diagnostic(auth.error ?? new Error("authenticated user missing")));
    return json({ error: "authentication_required" }, 401);
  }

  try {
    const connections = await loadFriendships(client);
    return json({ actorId: auth.data.user.id, connections, count: connections.length });
  } catch (error) {
    console.error("[friends.read]", diagnostic(error));
    return json({ error: "friendships_unavailable" }, 502);
  }
}
