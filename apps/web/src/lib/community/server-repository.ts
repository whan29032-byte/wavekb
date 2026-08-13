import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BoardSlug, CommunityPost, PostComment, PublicProfile } from "@wavekb/domain";
import { publicSupabaseConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

const POST_SELECT = [
  "id", "board", "title", "body", "author_id", "status", "created_at", "updated_at",
  "external_url", "external_kind", "chart_package", "post_images(id,storage_path,sort_order)",
  "comments_enabled",
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

export async function listPostsByAuthor(authorId: string, limit = 16): Promise<CommunityPost[]> {
  if (!publicSupabaseConfig().configured) return [];
  const client = await createClient();
  const result = await client
    .from("posts")
    .select(POST_SELECT)
    .eq("author_id", authorId)
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 40));
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

export async function listPostComments(postId: string): Promise<PostComment[]> {
  if (!publicSupabaseConfig().configured) return [];
  const client = await createClient();
  const result = await client.from("post_comments")
    .select("id,post_id,author_id,parent_id,body,status,created_at,updated_at")
    .eq("post_id", postId)
    .eq("status", "visible")
    .order("created_at", { ascending: true });
  if (result.error) throw result.error;
  const rows = (result.data ?? []) as Omit<PostComment, "profiles">[];
  const authorIds = [...new Set(rows.map((comment) => comment.author_id))];
  if (!authorIds.length) return [];
  const primary = await client.rpc("get_public_post_profiles", { p_ids: authorIds });
  const profilesResult = primary.error ? await client.rpc("get_public_profiles", { p_ids: authorIds }) : primary;
  if (profilesResult.error) throw profilesResult.error;
  const profileById = new Map(((profilesResult.data ?? []) as PublicProfile[]).map((profile) => [profile.id, profile]));
  return rows.map((comment) => ({ ...comment, profiles: profileById.get(comment.author_id) ?? null }));
}

export function postImageUrl(client: SupabaseClient, storagePath: string): string {
  return client.storage.from("post-images").getPublicUrl(storagePath).data.publicUrl;
}
