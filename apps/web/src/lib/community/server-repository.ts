import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BoardSlug, CommunityPost, ExternalReference, PostComment, PublicProfile, ResearchTimelineNode } from "@wavekb/domain";
import { publicSupabaseConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

const POST_SELECT = [
  "id", "board", "title", "body", "author_id", "status", "created_at", "updated_at",
  "external_url", "external_kind", "chart_package", "post_images(id,storage_path,sort_order,caption)",
  "post_external_references(id,url,kind,sort_order)",
  "research_timeline_nodes(id,subject_type,post_id,private_entry_id,author_id,kind,body,created_at,research_timeline_images(id,storage_path,sort_order,caption))",
  "comments_enabled",
].join(",");

type TimelineRow = Omit<ResearchTimelineNode, "profiles">;
type PostRow = Omit<CommunityPost, "profiles" | "external_references" | "timeline_nodes"> & {
  post_external_references?: ExternalReference[];
  research_timeline_nodes?: TimelineRow[];
};

async function attachProfiles(client: SupabaseClient, rows: PostRow[]): Promise<CommunityPost[]> {
  const authorIds = [...new Set(rows.flatMap((post) => [
    post.author_id,
    ...(post.research_timeline_nodes ?? []).map((node) => node.author_id),
  ]).filter(Boolean))];
  if (!authorIds.length) return [];

  const primary = await client.rpc("get_public_post_profiles", { p_ids: authorIds });
  const fallback = primary.error
    ? await client.rpc("get_public_profiles", { p_ids: authorIds })
    : primary;
  if (fallback.error) throw fallback.error;

  const profiles = (fallback.data ?? []) as PublicProfile[];
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  return rows.map((row) => {
    const { post_external_references, research_timeline_nodes, ...post } = row;
    const externalReferences = [...(post_external_references ?? [])].sort((a, b) => a.sort_order - b.sort_order);
    if (!externalReferences.length && post.external_url && post.external_kind) {
      externalReferences.push({ url: post.external_url, kind: post.external_kind, sort_order: 0 });
    }
    return {
      ...post,
      external_references: externalReferences,
      timeline_nodes: [...(research_timeline_nodes ?? [])]
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .map((node) => ({
          ...node,
          research_timeline_images: [...(node.research_timeline_images ?? [])].sort((a, b) => a.sort_order - b.sort_order),
          profiles: profileById.get(node.author_id) ?? null,
        })),
      profiles: profileById.get(post.author_id) ?? null,
    };
  });
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
    .order("created_at", { ascending: true })
    .limit(200);
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
