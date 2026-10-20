import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BOARD_SLUGS, type BoardSlug, type CommunityPost, type ExternalReference, type PostComment, type ResearchTimelineNode } from "@wavekb/domain";
import { publicSupabaseConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { pageRange, parsePage } from "@/lib/pagination";
import { loadPublicIdentities } from "@/lib/member/public-identities";

const POST_SELECT = [
  "id", "board", "title", "body", "author_id", "status", "created_at", "updated_at",
  "external_url", "external_kind", "chart_package", "post_images(id,storage_path,sort_order,caption)",
  "post_external_references(id,url,kind,sort_order)",
  "research_timeline_nodes(id,subject_type,post_id,private_entry_id,author_id,kind,body,created_at,research_timeline_images(id,storage_path,sort_order,caption))",
  "comments_enabled",
].join(",");

// Cards do not render embedded charts, external media or research timelines.
const POST_LIST_SELECT = "id,board,title,body,author_id,status,created_at,updated_at,comments_enabled,post_images(id,storage_path,sort_order,caption)";
type PageResult<T> = { items: T[]; hasNext: boolean; total: number };
type AuthorPostPage = PageResult<CommunityPost> & { boardCount: number };

async function postsPage(field: "board" | "author_id", value: string, size: number, page: number): Promise<PageResult<CommunityPost>> {
  if (!publicSupabaseConfig().configured) return { items: [], hasNext: false, total: 0 };
  const client = await createClient();
  const { from, to } = pageRange(parsePage(page), size);
  const result = await client.from("posts").select(POST_LIST_SELECT, { count: "exact" })
    .eq(field, value).eq("status", "published")
    .order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to + 1);
  if (result.error) throw result.error;
  const rows = (result.data ?? []) as unknown as PostRow[];
  const items = await attachEngagement(client, await attachProfiles(client, rows.slice(0, size).map((row) => ({ ...row, chart_package: null, external_url: null, external_kind: null }))));
  return { items, hasNext: rows.length > size, total: result.count ?? 0 };
}

function missingEngagementFunction(error: { code?: string; message?: string } | null) {
  return error?.code === "PGRST202" || error?.code === "42883"
    || /could not find the function|function .* does not exist/i.test(String(error?.message ?? ""));
}

async function attachEngagement(client: SupabaseClient, posts: CommunityPost[]): Promise<CommunityPost[]> {
  if (!posts.length) return posts;
  const result = await client.rpc("post_engagement", { p_post_ids: posts.map((post) => post.id) });
  // Older databases can render real rows before the engagement migration is applied.
  if (result.error) {
    if (missingEngagementFunction(result.error)) return posts;
    throw result.error;
  }
  const rows = (result.data ?? []) as Array<{ post_id: string; view_count: number | string; like_count: number | string; liked_by_me: boolean }>;
  const byId = new Map(rows.map((row) => [row.post_id, row]));
  return posts.map((post) => {
    const counts = byId.get(post.id);
    return {
      ...post,
      view_count: Number(counts?.view_count ?? 0),
      like_count: Number(counts?.like_count ?? 0),
      liked_by_me: Boolean(counts?.liked_by_me),
    };
  });
}

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

  const profiles = await loadPublicIdentities(client, authorIds);
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

export function listPosts(board: BoardSlug, limit?: number): Promise<CommunityPost[]>;
export function listPosts(board: BoardSlug, limit: number, page: number): Promise<PageResult<CommunityPost>>;
export async function listPosts(board: BoardSlug, limit = 20, page?: number): Promise<CommunityPost[] | PageResult<CommunityPost>> {
  const result = await postsPage("board", board, Math.min(Math.max(limit, 1), 40), page ?? 1);
  return page === undefined ? result.items : result;
}

export function listPostsByAuthor(authorId: string, limit?: number): Promise<CommunityPost[]>;
export function listPostsByAuthor(authorId: string, limit: number, page: number): Promise<AuthorPostPage>;
export async function listPostsByAuthor(authorId: string, limit = 16, page?: number): Promise<CommunityPost[] | AuthorPostPage> {
  const result = await postsPage("author_id", authorId, Math.min(Math.max(limit, 1), 40), page ?? 1);
  if (page === undefined) return result.items;
  if (!publicSupabaseConfig().configured) return { ...result, boardCount: 0 };
  const client = await createClient();
  const counts = await Promise.all(BOARD_SLUGS.map((board) => client.from("posts").select("id", { count: "exact", head: true }).eq("author_id", authorId).eq("status", "published").eq("board", board)));
  for (const count of counts) if (count.error) throw count.error;
  return { ...result, boardCount: counts.filter((count) => Number(count.count) > 0).length };
}

export async function getPost(id: string): Promise<CommunityPost | null> {
  if (!publicSupabaseConfig().configured) return null;
  const client = await createClient();
  const result = await client.from("posts").select(POST_SELECT).eq("id", id).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) return null;
  const posts = await attachProfiles(client, [result.data as unknown as PostRow]);
  const [post] = await attachEngagement(client, posts);
  return post ?? null;
}

export function listPostComments(postId: string): Promise<PostComment[]>;
export function listPostComments(postId: string, page: number): Promise<PageResult<PostComment>>;
export async function listPostComments(postId: string, page?: number): Promise<PostComment[] | PageResult<PostComment>> {
  if (!publicSupabaseConfig().configured) return page === undefined ? [] : { items: [], hasNext: false, total: 0 };
  const client = await createClient();
  const size = page === undefined ? 200 : 50;
  const { from, to } = pageRange(parsePage(page), size);
  const baseSelect = "id,post_id,author_id,parent_id,body,status,created_at,updated_at";
  const query = (select: string) => client.from("post_comments")
    .select(select, { count: "exact" })
    .eq("post_id", postId)
    .eq("status", "visible")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .range(from, to + 1);
  let result = await query(`${baseSelect},post_comment_images(id,storage_path,sort_order)`);
  // The image relation ships with the engagement migration. Keep comments
  // readable while the backend is still on the previous schema.
  if (result.error && (/PGRST200|42P01/.test(String(result.error.code ?? "")) || /post_comment_images/i.test(String(result.error.message ?? "")))) {
    result = await query(baseSelect);
  }
  if (result.error) throw result.error;
  const fetched = (result.data ?? []) as unknown as Array<Omit<PostComment, "profiles"> & { post_comment_images?: Array<{ id: string; storage_path: string; sort_order: number }> }>;
  const rows = fetched.slice(0, size);
  const pagination = { hasNext: fetched.length > size, total: result.count ?? 0 };
  const authorIds = [...new Set(rows.map((comment) => comment.author_id))];
  if (!authorIds.length) return page === undefined ? [] : { ...pagination, items: [] };
  const profiles = await loadPublicIdentities(client, authorIds);
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const items = rows.map(({ post_comment_images, ...comment }) => ({
    ...comment,
    images: [...(post_comment_images ?? [])].sort((a, b) => a.sort_order - b.sort_order),
    profiles: profileById.get(comment.author_id) ?? null,
  }));
  return page === undefined ? items : { ...pagination, items };
}
