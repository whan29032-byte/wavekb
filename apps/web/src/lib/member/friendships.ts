import type { FriendshipConnection } from "@wavekb/domain";
import type { SupabaseClient } from "@supabase/supabase-js";

export function isMissingFriendshipsV2(error: unknown) {
  const value = error as { code?: unknown; message?: unknown } | null;
  const message = `${String(value?.code ?? "")} ${String(value?.message ?? error ?? "")}`;
  return /does not exist|schema cache|could not find the function|PGRST202|42883/i.test(message);
}

export async function loadFriendships(client: SupabaseClient): Promise<FriendshipConnection[]> {
  const modern = await client.rpc("list_my_friendships_v2");
  const result = modern.error && isMissingFriendshipsV2(modern.error)
    ? await client.rpc("list_my_friendships")
    : modern;

  if (result.error) throw result.error;
  return (Array.isArray(result.data) ? result.data : []) as FriendshipConnection[];
}
