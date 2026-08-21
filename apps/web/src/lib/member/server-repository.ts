import "server-only";
import type { ChatSticker, DirectConversation, DirectMessage, EditableMemberProfile, FriendshipConnection, MemberProfile } from "@wavekb/domain";
import { createClient } from "@/lib/supabase/server";
import { loadFriendships } from "@/lib/member/friendships";

export type MemberSocialState = {
  following: boolean;
  connection: FriendshipConnection | null;
};

export type NameplateEntitlement = {
  id: string;
  product_id: string;
  product_name: string;
  style: MemberProfile["nameplate_style"];
  starts_at: string;
  expires_at: string;
  equipped: boolean;
  source: "redeemed" | "admin_grant";
};

export async function getMemberProfileByUid(uid: number): Promise<MemberProfile | null> {
  const client = await createClient();
  const full = await client.rpc("search_profile_by_uid", { p_uid: uid });
  if (!full.error) {
    const value = Array.isArray(full.data) ? full.data[0] : full.data;
    return (value as MemberProfile | null) ?? null;
  }

  const basic = await client.rpc("get_public_profiles", { p_ids: null })
    .eq("public_uid", uid)
    .maybeSingle();
  if (basic.error) throw basic.error;
  if (!basic.data) return null;
  const publicProfile = basic.data as Pick<MemberProfile, "id" | "public_uid" | "display_name" | "avatar_url" | "bio" | "markets" | "timeframes" | "created_at">;
  const identity = await client.rpc("get_public_post_profiles", { p_ids: [publicProfile.id] }).maybeSingle();
  if (identity.error) throw identity.error;
  const publicIdentity = identity.data as Pick<MemberProfile, "role" | "display_title" | "nameplate_style"> | null;
  return {
    ...publicProfile,
    role: publicIdentity?.role ?? "member",
    display_title: publicIdentity?.display_title ?? "",
    nameplate_style: publicIdentity?.nameplate_style ?? "classic",
    cover_url: null,
    cover_style: "chart-dark",
  } as MemberProfile;
}

export async function getMyProfile(userId: string): Promise<EditableMemberProfile | null> {
  const client = await createClient();
  const result = await client.from("profiles").select("id,public_uid,display_name,avatar_url,bio,markets,timeframes,role,display_title,nameplate_style,cover_url,cover_style,created_at").eq("id", userId).maybeSingle();
  if (result.error) throw result.error;
  return (result.data as EditableMemberProfile | null) ?? null;
}

export async function getMyNameplates(): Promise<NameplateEntitlement[]> {
  const client = await createClient();
  const result = await client.rpc("get_my_reward_center");
  if (result.error) throw result.error;
  const center = result.data as { nameplates?: NameplateEntitlement[] } | null;
  return Array.isArray(center?.nameplates) ? center.nameplates : [];
}

export async function getMemberSocialState(actorId: string, targetId: string): Promise<MemberSocialState> {
  if (actorId === targetId) return { following: false, connection: null };
  const client = await createClient();
  const [connectionsResult, followingResult] = await Promise.all([
    loadFriendships(client),
    client.from("profile_follows").select("followed_id").eq("follower_id", actorId).eq("followed_id", targetId).limit(1),
  ]);
  if (followingResult.error) throw followingResult.error;
  return {
    following: (followingResult.data ?? []).length > 0,
    connection: connectionsResult.find((item) => item.other_id === targetId) ?? null,
  };
}

export type PersonalSpaceSummary = { points: number; reviews: number; journals: number; drafts: number; analyses: number };

export async function getMyPersonalSpaceSummary(userId: string): Promise<PersonalSpaceSummary> {
  const client = await createClient();
  const [entries, analyses, rewards] = await Promise.all([
    client.from("private_entries").select("kind").eq("owner_id", userId).is("deleted_at", null),
    client.from("workbench_analyses").select("id", { count: "exact", head: true }).eq("owner_id", userId),
    client.rpc("get_my_reward_center"),
  ]);
  if (entries.error) throw entries.error;
  if (analyses.error) throw analyses.error;
  if (rewards.error) throw rewards.error;
  const rows = (entries.data ?? []) as Array<{ kind: string }>;
  const center = (rewards.data ?? {}) as { wallet?: { balance?: number } };
  return {
    points: Number(center.wallet?.balance || 0),
    reviews: rows.filter((item) => item.kind === "review").length,
    journals: rows.filter((item) => item.kind === "journal").length,
    drafts: rows.filter((item) => item.kind === "draft").length,
    analyses: Number(analyses.count || 0),
  };
}

export async function listFriendships(): Promise<FriendshipConnection[]> {
  const client = await createClient();
  return loadFriendships(client);
}

function missingRpc(error: unknown) {
  const message = error instanceof Error ? error.message : JSON.stringify(error ?? "");
  return /does not exist|schema cache|could not find the function|PGRST202|42883/i.test(message);
}

export async function listConversations(): Promise<DirectConversation[]> {
  const client = await createClient();
  const modern = await client.rpc("list_my_conversations_v2");
  const result = modern.error && missingRpc(modern.error) ? await client.rpc("list_my_conversations") : modern;
  if (result.error) throw result.error;
  return (result.data ?? []).map((item: Record<string, unknown>) => ({ ...item, unread_count: Number(item.unread_count ?? 0) })) as DirectConversation[];
}

export async function listDirectMessages(conversationId: string): Promise<DirectMessage[]> {
  const client = await createClient();
  const result = await client.rpc("list_conversation_messages", { p_conversation: conversationId });
  if (result.error) throw result.error;
  return (result.data ?? []) as DirectMessage[];
}

export async function listChatStickers(userId: string): Promise<ChatSticker[]> {
  const client = await createClient();
  const result = await client.from("chat_stickers")
    .select("id,owner_id,storage_path,label,mime_type,created_at")
    .eq("owner_id", userId)
    .order("created_at", { ascending: false });
  if (result.error) throw result.error;
  return (result.data ?? []) as ChatSticker[];
}
