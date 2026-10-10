import type { SupabaseClient } from "@supabase/supabase-js";
import type { BoardSlug, CommunityPost, ExternalKind, ExternalReference, TimelineNodeKind } from "@wavekb/domain";
import type { TradingViewPackage } from "@/lib/workbench/tradingview";
import { mapWithConcurrency } from "../uploads";
import { isDefiniteDatabaseRejection, sameJsonValue, UncertainMutationError } from "../mutation-recovery";

export type PostPublishingProgress = {
  phase: "preparing" | "uploading" | "publishing";
  /** Successfully uploaded files; this is not byte progress. */
  completed: number;
  total: number;
};

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
  onProgress?: (progress: PostPublishingProgress) => void;
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
  readPost?(id: string, userId: string): Promise<PublishedPostSnapshot | null>;
};

type PublishedPostSnapshot = {
  id: string; author_id: string; board: string; status: string; title: string; body: string; chart_package: unknown;
  post_images: Array<{ storage_path: string; caption: string | null; sort_order: number }>;
  post_external_references: Array<{ url: string; kind: string; sort_order: number }>;
  post_sources: Array<{ private_entry_id: string }>;
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
  onProgress?: (progress: PostPublishingProgress) => void;
};

function reportProgress(
  onProgress: CreatePostInput["onProgress"],
  phase: PostPublishingProgress["phase"],
  completed: number,
  total: number,
) {
  if (!onProgress) return;
  try {
    // Progress observers must not interrupt persistence, including async observers.
    void Promise.resolve(onProgress({ phase, completed, total })).catch(() => undefined);
  } catch {
    // A broken UI observer does not change the result of publishing.
  }
}

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
    async readPost(id, userId) {
      const actor = await client.auth.getUser();
      if (actor.error || actor.data.user?.id !== userId) throw new Error("authentication changed before recovery read");
      const result = await client.from("posts").select("id,author_id,board,status,title,body,chart_package,post_images(storage_path,caption,sort_order),post_external_references(url,kind,sort_order),post_sources(private_entry_id)")
        .eq("id", id).eq("author_id", userId).maybeSingle();
      unwrap(result);
      return result.data as PublishedPostSnapshot | null;
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
  reportProgress(input.onProgress, "preparing", 0, input.files.length);
  const gateway = injectedGateway ?? defaultGateway(client);
  const postId = gateway.makeId();
  const uploadedPaths: string[] = [];
  const references = input.externalReferences ?? (input.externalUrl && input.externalKind
    ? [{ url: input.externalUrl, kind: input.externalKind, sort_order: 0 }]
    : []);
  const firstReference = references[0];
  let databaseWriteStarted = false;
  let publishStarted = false;
  let imageRows: Array<{ storage_path: string; sort_order: number; caption: string }> = [];

  try {
    databaseWriteStarted = true;
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
    if (input.privateEntryId) {
      if (!gateway.linkSource) throw new Error("私人记录发布链路尚未安装。");
      await gateway.linkSource({ post_id: postId, private_entry_id: input.privateEntryId, owner_id: input.userId });
    }
    databaseWriteStarted = false;
    const uploads = input.files.map((file, sortOrder) => {
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
    imageRows = uploads.map(({ storage_path, sort_order, caption }) => ({ storage_path, sort_order, caption }));
    let completed = 0;
    if (uploads.length) reportProgress(input.onProgress, "uploading", completed, uploads.length);
    await mapWithConcurrency(uploads, 3, async (row) => {
      await gateway.uploadImage(String(row.storage_path), row.file);
      reportProgress(input.onProgress, "uploading", ++completed, uploads.length);
    });
    reportProgress(input.onProgress, "publishing", completed, uploads.length);
    const persistedImageRows = uploads.map((row) => ({
      post_id: row.post_id,
      owner_id: row.owner_id,
      storage_path: row.storage_path,
      sort_order: row.sort_order,
      caption: row.caption,
    }));
    databaseWriteStarted = true;
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
    publishStarted = true;
    await gateway.publish(postId);
    return postId;
  } catch (error) {
    if (databaseWriteStarted) {
      let snapshot: PublishedPostSnapshot | null = null;
      let readKnown = false;
      try {
        if (gateway.readPost) { snapshot = await gateway.readPost(postId, input.userId); readKnown = true; }
      } catch { /* Neither transport errors nor an unavailable read prove rollback. */ }
      const imagesKnown = Array.isArray(snapshot?.post_images) && snapshot.post_images.every((image) => image && typeof image.storage_path === "string" && typeof image.sort_order === "number");
      const savedImages = imagesKnown ? snapshot!.post_images.slice().sort((a, b) => a.sort_order - b.sort_order).map(({ storage_path, caption, sort_order }) => ({ storage_path, caption: caption ?? "", sort_order })) : undefined;
      const savedReferences = Array.isArray(snapshot?.post_external_references) && snapshot.post_external_references.every((reference) => reference && typeof reference.sort_order === "number")
        ? snapshot.post_external_references.slice().sort((a, b) => a.sort_order - b.sort_order).map(({ url, kind }) => ({ url, kind })) : undefined;
      const confirmed = publishStarted && snapshot?.id === postId && snapshot.author_id === input.userId && snapshot.board === input.board
        && snapshot.status === "published" && snapshot.title === input.title && snapshot.body === input.body
        && sameJsonValue(snapshot.chart_package, input.chartPackage ?? null) && sameJsonValue(savedImages, imageRows)
        && sameJsonValue(savedReferences, references.map(({ url, kind }) => ({ url, kind })))
        && (!input.privateEntryId || (Array.isArray(snapshot.post_sources) && snapshot.post_sources.some((source) => source?.private_entry_id === input.privateEntryId)));
      if (confirmed) return postId;
      const unreferenced = readKnown && (snapshot === null || (snapshot.id === postId && snapshot.author_id === input.userId && snapshot.status === "draft"
        && imagesKnown && !snapshot.post_images.some((image) => uploadedPaths.includes(image.storage_path))));
      if (!isDefiniteDatabaseRejection(error) || !unreferenced) {
        throw new UncertainMutationError("发布结果尚未确认，未清理本次上传的图片或服务器记录，当前草稿仍保留。请先打开帖子核对是否已发布，再继续编辑；不要直接重复提交。", `/community/post/${encodeURIComponent(postId)}`);
      }
    }
    await gateway.removeFiles(uploadedPaths).catch(() => undefined);
    await gateway.removePost(postId).catch(() => undefined);
    throw error;
  }
}

export async function updatePost(client: SupabaseClient, post: CommunityPost, input: UpdatePostInput) {
  if (post.author_id !== input.userId || post.status === "hidden") throw new Error("你不能编辑这篇帖子。");
  reportProgress(input.onProgress, "preparing", 0, input.files.length);
  const keptIds = new Set(input.keptImageIds);
  const kept = post.post_images.filter((image) => keptIds.has(image.id));
  const removed = post.post_images.filter((image) => !keptIds.has(image.id));
  const uploadedPaths: string[] = [];
  const references = input.externalReferences ?? (input.externalUrl && input.externalKind
    ? [{ url: input.externalUrl, kind: input.externalKind, sort_order: 0 }]
    : []);
  let mutationStarted = false;
  let allRejectionsDefinite = true;

  const desiredImages = () => [
    ...kept.map((image) => ({ storage_path: image.storage_path, caption: String(input.imageCaptionsById?.[image.id] ?? image.caption ?? "").trim().slice(0, 240) })),
    ...uploadedPaths.map((storagePath, index) => ({ storage_path: storagePath, caption: String(input.newImageCaptions?.[index] ?? "").trim().slice(0, 240) })),
  ];

  try {
    const uploads = input.files.map((file) => {
      const extension = imageExtension(file.type);
      if (!extension) throw new Error("不支持的图片格式。");
      const path = `${input.userId}/${post.id}/${crypto.randomUUID()}.${extension}`;
      uploadedPaths.push(path);
      return { file, path };
    });
    let completed = 0;
    if (uploads.length) reportProgress(input.onProgress, "uploading", completed, uploads.length);
    await mapWithConcurrency(uploads, 3, async ({ file, path }) => {
      const upload = await client.storage.from("post-images").upload(path, file, {
        upsert: false,
        contentType: file.type,
      });
      if (upload.error) throw upload.error;
      reportProgress(input.onProgress, "uploading", ++completed, uploads.length);
    });

    reportProgress(input.onProgress, "publishing", completed, uploads.length);
    let updateError: unknown;
    mutationStarted = true;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await client.rpc("update_my_post_v4", {
        p_post_id: post.id,
        p_title: input.title,
        p_body: input.body,
        p_images: desiredImages(),
        p_external_references: references.map(({ url, kind }) => ({ url, kind })),
        p_chart_package: input.chartPackage ?? null,
      });
      updateError = result.error;
      if (!updateError) break;
      if (!isDefiniteDatabaseRejection(updateError)) allRejectionsDefinite = false;
      if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 300 * (attempt + 1)));
    }
    if (updateError) throw updateError;
  } catch (error) {
    if (!mutationStarted) {
      if (uploadedPaths.length) await client.storage.from("post-images").remove(uploadedPaths).catch(() => undefined);
      throw error;
    }
    if (!isDefiniteDatabaseRejection(error)) allRejectionsDefinite = false;
    // A lost acknowledgement can hide a committed update. Read the authorized
    // target before any cleanup; an unavailable/mismatched read is not rollback.
    type Snapshot = { id: string; title: string; body: string; chart_package: unknown; post_images: Array<{ storage_path: string; caption: string | null; sort_order: number }>; post_external_references: Array<{ url: string; kind: string; sort_order: number }> };
    let snapshot: Snapshot | null = null;
    try {
      const read = await client.from("posts").select("id,title,body,chart_package,post_images(storage_path,caption,sort_order),post_external_references(url,kind,sort_order)")
        .eq("id", post.id).eq("author_id", input.userId).maybeSingle();
      if (!read.error && read.data?.id === post.id) snapshot = read.data as Snapshot;
    } catch { /* Preserve uploads while the saved state cannot be verified. */ }
    const referencesKnown = Array.isArray(snapshot?.post_images) && snapshot.post_images.every((image) => image && typeof image.storage_path === "string" && typeof image.sort_order === "number");
    const savedImages = referencesKnown ? snapshot!.post_images.slice().sort((a, b) => a.sort_order - b.sort_order).map(({ storage_path, caption }) => ({ storage_path, caption: caption ?? "" })) : undefined;
    const savedReferences = Array.isArray(snapshot?.post_external_references) && snapshot.post_external_references.every((reference) => reference && typeof reference.url === "string" && typeof reference.kind === "string" && typeof reference.sort_order === "number")
      ? snapshot.post_external_references.slice().sort((a, b) => a.sort_order - b.sort_order).map(({ url, kind }) => ({ url, kind })) : undefined;
    const confirmed = snapshot && snapshot.title === input.title.trim() && snapshot.body === input.body.trim()
      && sameJsonValue(snapshot.chart_package, input.chartPackage ?? null)
      && sameJsonValue(savedImages, desiredImages())
      && sameJsonValue(savedReferences, references.map(({ url, kind }) => ({ url, kind })));
    if (!confirmed) {
      const referenced = referencesKnown && snapshot!.post_images.some((image) => uploadedPaths.includes(image.storage_path));
      if (allRejectionsDefinite && referencesKnown && !referenced) {
        if (uploadedPaths.length) await client.storage.from("post-images").remove(uploadedPaths).catch(() => undefined);
        throw error;
      }
      throw new UncertainMutationError("帖子保存结果尚未确认，已保留本次上传的图片和当前草稿。请先刷新帖子核对内容，再继续编辑；不要直接重复提交。");
    }
    // Matching content and references establish success even when every write
    // response was lost. Old-image cleanup below is now safe to attempt.
  }

  const removedPaths = removed.map((image) => image.storage_path);
  if (!removedPaths.length) return { cleanupPending: false };
  try {
    const cleanup = await client.storage.from("post-images").remove(removedPaths);
    return { cleanupPending: Boolean(cleanup.error) };
  } catch {
    // The atomic update already committed; storage cleanup cannot undo that success.
    return { cleanupPending: true };
  }
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
  let mutationStarted = false;
  let desiredImages: Array<{ storage_path: string; caption: string }> = [];
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
    desiredImages = uploads.map(({ path, caption }) => ({ storage_path: path, caption }));
    mutationStarted = true;
    const result = await client.rpc("append_research_timeline_node", {
      p_post_id: input.postId,
      p_node_id: nodeId,
      p_kind: input.kind,
      p_body: input.body.trim(),
      p_images: desiredImages,
    });
    unwrap(result);
    return nodeId;
  } catch (error) {
    if (mutationStarted) {
      type Snapshot = { id: string; author_id: string; post_id: string; kind: string; body: string; research_timeline_images: Array<{ storage_path: string; caption: string | null; sort_order: number }> };
      let snapshot: Snapshot | null = null;
      let readKnown = false;
      try {
        const actor = await client.auth.getUser();
        if (actor.error || actor.data.user?.id !== input.userId) throw new Error("authentication changed before recovery read");
        const read = await client.from("research_timeline_nodes").select("id,author_id,post_id,kind,body,research_timeline_images(storage_path,caption,sort_order)")
          .eq("id", nodeId).eq("post_id", input.postId).eq("author_id", input.userId).maybeSingle();
        if (!read.error) { snapshot = read.data as Snapshot | null; readKnown = true; }
      } catch { /* Preserve objects until the node's saved state is known. */ }
      const savedImages = Array.isArray(snapshot?.research_timeline_images) && snapshot.research_timeline_images.every((image) => image && typeof image.storage_path === "string" && typeof image.sort_order === "number")
        ? snapshot.research_timeline_images.slice().sort((a, b) => a.sort_order - b.sort_order).map(({ storage_path, caption }) => ({ storage_path, caption: caption ?? "" })) : undefined;
      if (snapshot?.id === nodeId && snapshot.author_id === input.userId && snapshot.post_id === input.postId
        && snapshot.kind === input.kind && snapshot.body === input.body.trim() && sameJsonValue(savedImages, desiredImages)) return nodeId;
      if (!isDefiniteDatabaseRejection(error) || !readKnown || snapshot !== null) {
        throw new UncertainMutationError("观点更新保存结果尚未确认，已保留本次上传的图片和当前输入。请先核对帖子时间线，再继续编辑；不要直接重复提交。", `/community/post/${encodeURIComponent(input.postId)}`);
      }
    }
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
