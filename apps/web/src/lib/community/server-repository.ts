import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BoardSlug, CommunityPost, PublicProfile } from "@wavekb/domain";
import { publicSupabaseConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

const POST_SELECT = [
  "id", "board", "title", "body", "author_id", "status", "created_at", "updated_at",
  "external_url", "external_kind", "chart_package", "post_images(id,storage_path,sort_order)",
].join(",");

type PostRow = Omit<CommunityPost, "profiles">;

async function attachProfiles(client: SupabaseClient, rows: PostRow[]): Promise<CommunityPost[]> {
  const authorIds = [...new Set(rows.map((post) => post.author_id).filter(Boolean))];
  if (!authorIds.length) return rows.map((post) => ({ ...post, profiles: null }));

  const primary = await client.rpc("get_public_post_profiles", { p_ids: authorIds });
  const fallback = primary.error
    ? await client.rpc("get_public_profiles", { p_ids: authorIds })
    : primary;
  if (fallback.error) throw fallback.error;

  const profiles = (fallback.data ?? []) as PublicProfile[];
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  return rows.map((post) => ({ ...post, profiles: profileById.get(post.author_id) ?? null }));
}

export async function listPosts(board: BoardSlug, limit = 20): Promise<CommunityPost[]> {
  if (!publicSupabaseConfig().configured) return [];
  const client = await createClient();
  const result = await client
    .from("posts")
    .select(POST_SELECT)
    .eq("board", board)
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (result.error) throw result.error;
  return attachProfiles(client, (result.data ?? []) as unknown as PostRow[]);
}

export async function getPost(id: string): Promise<CommunityPost | null> {
  if (!publicSupabaseConfig().configured) return null;
  const client = await createClient();
  const result = await client.from("posts").select(POST_SELECT).eq("id", id).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) return null;
  const [post] = await attachProfiles(client, [result.data as unknown as PostRow]);
  return post ?? null;
}

export function postImageUrl(client: SupabaseClient, storagePath: string): string {
  return client.storage.from("post-images").getPublicUrl(storagePath).data.publicUrl;
}
