import type { SupabaseClient } from "@supabase/supabase-js";
import type { BoardSlug, CommunityPost, ExternalKind, ExternalReference, TimelineNodeKind } from "@wavekb/domain";
import type { TradingViewPackage } from "@/lib/workbench/tradingview";
import { mapWithConcurrency } from "../uploads";

type CreatePostInput = {
  userId: string;
  board: BoardSlug;
  title: string;
  body: string;
  externalUrl?: string;
  externalKind?: ExternalKind;
  externalReferences?: ExternalReference[];
  files: File[];
  imageCaptions?: string[];
  privateEntryId?: string;
  chartPackage?: TradingViewPackage | null;
};

type PublishingGateway = {
  makeId(): string;
  insertDraft(value: Record<string, unknown>): Promise<void>;
  linkSource?(value: Record<string, unknown>): Promise<void>;
  uploadImage(path: string, file: File): Promise<void>;
  insertImages(rows: Record<string, unknown>[]): Promise<void>;
  insertReferences?(rows: Record<string, unknown>[]): Promise<void>;
  publish(id: string): Promise<void>;
  removeFiles(paths: string[]): Promise<void>;
  removePost(id: string): Promise<void>;
};

type UpdatePostInput = {
  userId: string;
  title: string;
  body: string;
  externalUrl?: string;
  externalKind?: ExternalKind;
  externalReferences?: ExternalReference[];
  keptImageIds: string[];
  imageCaptionsById?: Record<string, string>;
  files: File[];
  newImageCaptions?: string[];
  chartPackage?: TradingViewPackage | null;
};

function unwrap(result: { error: unknown }) {
  if (result.error) throw result.error;
}

function defaultGateway(client: SupabaseClient): PublishingGateway {
  return {
    makeId: () => crypto.randomUUID(),
    async insertDraft(value) {
      unwrap(await client.from("posts").insert(value));
    },
    async linkSource(value) {
      unwrap(await client.from("post_sources").insert(value));
    },
    async uploadImage(path, file) {
      unwrap(await client.storage.from("post-images").upload(path, file, {
        upsert: false,
        contentType: file.type,
      }));
    },
    async insertImages(rows) {
      if (rows.length) unwrap(await client.from("post_images").insert(rows));
    },
    async insertReferences(rows) {
      if (rows.length) unwrap(await client.from("post_external_references").insert(rows));
    },
    async publish(id) {
      unwrap(await client.from("posts").update({ status: "published" }).eq("id", id));
    },
    async removeFiles(paths) {
      if (paths.length) unwrap(await client.storage.from("post-images").remove(paths));
    },
    async removePost(id) {
      unwrap(await client.from("posts").delete().eq("id", id));
    },
  };
}

function imageExtension(type: string): string | null {
  if (type === "image/jpeg") return "jpg";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return null;
}

export async function createPost(
  client: SupabaseClient,
  input: CreatePostInput,
  injectedGateway?: PublishingGateway,
): Promise<string> {
  const gateway = injectedGateway ?? defaultGateway(client);
  const postId = gateway.makeId();
  const uploadedPaths: string[] = [];
  const references = input.externalReferences ?? (input.externalUrl && input.externalKind
    ? [{ url: input.externalUrl, kind: input.externalKind, sort_order: 0 }]
    : []);
  const firstReference = references[0];

  await gateway.insertDraft({
    id: postId,
    board: input.board,
    title: input.title,
    body: input.body,
    external_url: firstReference?.url ?? null,
    external_kind: firstReference?.kind ?? null,
    chart_package: input.chartPackage ?? null,
    author_id: input.userId,
    status: "draft",
  });

  try {
    if (input.privateEntryId) {
      if (!gateway.linkSource) throw new Error("私人记录发布链路尚未安装。");
      await gateway.linkSource({ post_id: postId, private_entry_id: input.privateEntryId, owner_id: input.userId });
    }
    const imageRows = input.files.map((file, sortOrder) => {
      const extension = imageExtension(file.type);
      if (!extension) throw new Error("不支持的图片格式。");
      const path = `${input.userId}/${postId}/${gateway.makeId()}.${extension}`;
      uploadedPaths.push(path);
      return {
        post_id: postId,
        owner_id: input.userId,
        storage_path: path,
        sort_order: sortOrder,
        caption: String(input.imageCaptions?.[sortOrder] ?? "").trim().slice(0, 240),
        file,
      };
    });
    await mapWithConcurrency(imageRows, 3, (row) => gateway.uploadImage(String(row.storage_path), row.file));
    const persistedImageRows = imageRows.map((row) => ({
      post_id: row.post_id,
      owner_id: row.owner_id,
      storage_path: row.storage_path,
      sort_order: row.sort_order,
      caption: row.caption,
    }));
    await gateway.insertImages(persistedImageRows);
    if (references.length) {
      if (!gateway.insertReferences) throw new Error("媒体引用保存链路尚未安装。");
      await gateway.insertReferences(references.map((reference, sortOrder) => ({
        post_id: postId,
        owner_id: input.userId,
        url: reference.url,
        kind: reference.kind,
        sort_order: sortOrder,
      })));
    }
    await gateway.publish(postId);
    return postId;
  } catch (error) {
    await gateway.removeFiles(uploadedPaths).catch(() => undefined);
    await gateway.removePost(postId).catch(() => undefined);
    throw error;
  }
}

export async function updatePost(client: SupabaseClient, post: CommunityPost, input: UpdatePostInput) {
  if (post.author_id !== input.userId || post.status === "hidden") throw new Error("你不能编辑这篇帖子。");
  const keptIds = new Set(input.keptImageIds);
  const kept = post.post_images.filter((image) => keptIds.has(image.id));
  const removed = post.post_images.filter((image) => !keptIds.has(image.id));
  const uploadedPaths: string[] = [];

  try {
    const uploads = input.files.map((file) => {
      const extension = imageExtension(file.type);
      if (!extension) throw new Error("不支持的图片格式。");
      const path = `${input.userId}/${post.id}/${crypto.randomUUID()}.${extension}`;
      uploadedPaths.push(path);
      return { file, path };
    });
    await mapWithConcurrency(uploads, 3, async ({ file, path }) => {
      const upload = await client.storage.from("post-images").upload(path, file, {
        upsert: false,
        contentType: file.type,
      });
      if (upload.error) throw upload.error;
    });

    let updateError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const references = input.externalReferences ?? (input.externalUrl && input.externalKind
        ? [{ url: input.externalUrl, kind: input.externalKind, sort_order: 0 }]
        : []);
      const result = await client.rpc("update_my_post_v4", {
        p_post_id: post.id,
        p_title: input.title,
        p_body: input.body,
        p_images: [
          ...kept.map((image) => ({ storage_path: image.storage_path, caption: String(input.imageCaptionsById?.[image.id] ?? image.caption ?? "").trim().slice(0, 240) })),
          ...uploadedPaths.map((storagePath, index) => ({ storage_path: storagePath, caption: String(input.newImageCaptions?.[index] ?? "").trim().slice(0, 240) })),
        ],
        p_external_references: references.map(({ url, kind }) => ({ url, kind })),
        p_chart_package: input.chartPackage ?? null,
      });
      updateError = result.error;
      if (!updateError) break;
      if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 300 * (attempt + 1)));
    }
    if (updateError) throw updateError;
  } catch (error) {
    if (uploadedPaths.length) await client.storage.from("post-images").remove(uploadedPaths).catch(() => undefined);
    throw error;
  }

  const removedPaths = removed.map((image) => image.storage_path);
  if (!removedPaths.length) return { cleanupPending: false };
  const cleanup = await client.storage.from("post-images").remove(removedPaths);
  return { cleanupPending: Boolean(cleanup.error) };
}

export async function appendPostTimelineNode(client: SupabaseClient, input: {
  postId: string;
  userId: string;
  kind: TimelineNodeKind;
  body: string;
  files: File[];
  captions?: string[];
}) {
  const nodeId = crypto.randomUUID();
  const uploadedPaths: string[] = [];
  try {
    const uploads = input.files.map((file, index) => {
      const extension = imageExtension(file.type);
      if (!extension) throw new Error("不支持的图片格式。");
      const path = `${input.userId}/${input.postId}/timeline/${nodeId}/${crypto.randomUUID()}.${extension}`;
      uploadedPaths.push(path);
      return { file, path, caption: String(input.captions?.[index] ?? "").trim().slice(0, 240) };
    });
    await mapWithConcurrency(uploads, 3, async ({ file, path }) => {
      unwrap(await client.storage.from("post-images").upload(path, file, {
        upsert: false,
        contentType: file.type,
      }));
    });
    const result = await client.rpc("append_research_timeline_node", {
      p_post_id: input.postId,
      p_node_id: nodeId,
      p_kind: input.kind,
      p_body: input.body.trim(),
      p_images: uploads.map(({ path, caption }) => ({ storage_path: path, caption })),
    });
    unwrap(result);
    return nodeId;
  } catch (error) {
    if (uploadedPaths.length) await client.storage.from("post-images").remove(uploadedPaths).catch(() => undefined);
    throw error;
  }
}

export async function deletePost(client: SupabaseClient, post: CommunityPost, userId: string) {
  if (post.author_id !== userId || post.status === "hidden") throw new Error("你不能删除这篇帖子。");
  type DeletePayload = { deleted?: boolean; storage_paths?: unknown[] };
  const retryableStatuses = new Set([409, 429, 500, 502, 503, 504]);
  let response: Response | null = null;
  let payload: DeletePayload | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      response = await fetch(`/api/community/posts/${encodeURIComponent(post.id)}/delete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(5_000),
      });
      payload = await response.json().catch(() => null) as DeletePayload | null;
      if (response.ok && payload?.deleted === true) break;
      if (!response.ok && !retryableStatuses.has(response.status)) break;
    } catch {
      response = null;
      payload = null;
    }
    if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 250 * (attempt + 1)));
  }
  if (!response?.ok || payload?.deleted !== true) {
    throw new Error(response?.status === 401 ? "登录状态已失效，请重新登录。" : "帖子未被删除，请稍后重试。");
  }
  const paths = (payload.storage_paths ?? [])
    .map((path) => String(path))
    .filter((path) => path.startsWith(`${userId}/${post.id}/`));
  if (!paths.length) return { cleanupPending: false };
  const files = await client.storage.from("post-images").remove(paths);
  return { cleanupPending: Boolean(files.error) };
}

export async function addPostComment(client: SupabaseClient, input: {
  postId: string;
  userId: string;
  body: string;
  parentId?: string | null;
}) {
  const body = input.body.trim();
  if (!body || body.length > 2000) throw new Error("评论需要 1 到 2000 个字符。");
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const result = await client.from("post_comments").insert({
    id,
    post_id: input.postId,
    author_id: input.userId,
    parent_id: input.parentId ?? null,
    body,
    status: "visible",
  });
  if (result.error) throw result.error;
  return {
    id,
    post_id: input.postId,
    author_id: input.userId,
    parent_id: input.parentId ?? null,
    body,
    status: "visible" as const,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

export async function deletePostComment(client: SupabaseClient, commentId: string, userId: string) {
  const result = await client.from("post_comments")
    .update({ status: "deleted_by_author", body: "该评论已由作者删除。" })
    .eq("id", commentId)
    .eq("author_id", userId);
  if (result.error) throw result.error;
}
