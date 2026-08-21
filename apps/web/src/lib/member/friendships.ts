import type { FriendshipConnection } from "@wavekb/domain";
import type { SupabaseClient } from "@supabase/supabase-js";

type RpcFailure = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
  status?: number;
};

export class FriendshipRpcError extends Error {
  readonly rpc: "list_my_friendships_v2" | "list_my_friendships";
  readonly code?: string;
  readonly details?: string;
  readonly hint?: string;
  readonly status?: number;

  constructor(rpc: FriendshipRpcError["rpc"], failure: RpcFailure) {
    super(failure.message || "Friendship RPC failed", { cause: failure });
    this.name = "FriendshipRpcError";
    this.rpc = rpc;
    this.code = failure.code;
    this.details = failure.details;
    this.hint = failure.hint;
    this.status = failure.status;
  }
}

export function isMissingFriendshipsV2(error: unknown) {
  const value = error as { code?: unknown; message?: unknown } | null;
  const message = `${String(value?.code ?? "")} ${String(value?.message ?? error ?? "")}`;
  return /does not exist|schema cache|could not find the function|PGRST202|42883/i.test(message);
}

export async function loadFriendships(client: SupabaseClient): Promise<FriendshipConnection[]> {
  const modern = await client.rpc("list_my_friendships_v2");
  if (!modern.error) return (Array.isArray(modern.data) ? modern.data : []) as FriendshipConnection[];
  if (!isMissingFriendshipsV2(modern.error)) {
    throw new FriendshipRpcError("list_my_friendships_v2", modern.error);
  }

  const legacy = await client.rpc("list_my_friendships");
  if (legacy.error) throw new FriendshipRpcError("list_my_friendships", legacy.error);
  return (Array.isArray(legacy.data) ? legacy.data : []) as FriendshipConnection[];
}
