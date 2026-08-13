import "server-only";
import type { FriendshipConnection, MemberProfile } from "@wavekb/domain";
import { createClient } from "@/lib/supabase/server";

export type MemberSocialState = {
  following: boolean;
  connection: FriendshipConnection | null;
};

export async function getMemberProfileByUid(uid: number): Promise<MemberProfile | null> {
  const client = await createClient();
  const result = await client.rpc("search_profile_by_uid", { p_uid: uid });
  if (result.error) throw result.error;
  const value = Array.isArray(result.data) ? result.data[0] : result.data;
  return (value as MemberProfile | null) ?? null;
}

export async function getMemberSocialState(actorId: string, targetId: string): Promise<MemberSocialState> {
  if (actorId === targetId) return { following: false, connection: null };
  const client = await createClient();
  const [connectionsResult, followingResult] = await Promise.all([
    client.rpc("list_my_friendships"),
    client.from("profile_follows").select("followed_id").eq("follower_id", actorId).eq("followed_id", targetId).limit(1),
  ]);
  if (connectionsResult.error) throw connectionsResult.error;
  if (followingResult.error) throw followingResult.error;
  const connections = (connectionsResult.data ?? []) as FriendshipConnection[];
  return {
    following: (followingResult.data ?? []).length > 0,
    connection: connections.find((item) => item.other_id === targetId) ?? null,
  };
}
