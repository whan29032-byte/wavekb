import { afterEach, describe, expect, it, vi } from "vitest";
import { addPostComment, appendPostTimelineNode, createPost, deletePost, updatePost } from "./client-repository";
import type { PostPublishingProgress } from "./client-repository";
import { UncertainMutationError } from "../mutation-recovery";

afterEach(() => vi.unstubAllGlobals());

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function imageFiles(count: number) {
  return Array.from({ length: count }, (_, index) => new File([`image-${index}`], `wave-${index}.png`, { type: "image/png" }));
}

function publishingGateway(overrides: Partial<NonNullable<Parameters<typeof createPost>[2]>> = {}) {
  let nextImageId = 0;
  return {
    makeId: vi.fn().mockReturnValueOnce("post-id").mockImplementation(() => `image-${nextImageId++}`),
    insertDraft: vi.fn(async () => undefined),
    uploadImage: vi.fn<(path: string, file: File) => Promise<void>>(async () => undefined),
    insertImages: vi.fn<(rows: Record<string, unknown>[]) => Promise<void>>(async () => undefined),
    publish: vi.fn<(id: string) => Promise<void>>(async () => undefined),
    removeFiles: vi.fn<(paths: string[]) => Promise<void>>(async () => undefined),
    removePost: vi.fn<(id: string) => Promise<void>>(async () => undefined),
    ...overrides,
  };
}

function createInput(files: File[], onProgress?: (progress: PostPublishingProgress) => void): Parameters<typeof createPost>[1] {
  return {
    userId: "user-id",
    board: "idea_sharing",
    title: "上传流程回归测试",
    body: "所有图片上传完成以后才能保存图片顺序并公开帖子。",
    files,
    onProgress,
  };
}

function editingPost(postImages: { id: string; storage_path: string; caption?: string }[] = []): Parameters<typeof updatePost>[1] {
  return { id: "post-id", author_id: "user-id", status: "published", post_images: postImages } as never;
}

function updateInput(files: File[], onProgress?: (progress: PostPublishingProgress) => void): Parameters<typeof updatePost>[2] {
  return { userId: "user-id", title: "编辑上传回归测试", body: "原子保存更新以后再清理已移除的旧图片。", keptImageIds: [], files, onProgress };
}

describe("edit commit acknowledgement recovery", () => {
  function fixture(writeError: unknown) {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const remove = vi.fn().mockResolvedValue({ error: null });
    const rpc = vi.fn().mockResolvedValue({ error: writeError });
    const read = vi.fn();
    const query = { eq: vi.fn().mockReturnThis(), maybeSingle: read };
    const client = { rpc, from: vi.fn(() => ({ select: vi.fn(() => query) })), storage: { from: () => ({ upload, remove }) } };
    const input = updateInput(imageFiles(1));
    const snapshot = () => ({ id: "post-id", title: input.title, body: input.body, chart_package: null,
      post_images: [{ storage_path: upload.mock.calls[0][0], caption: "", sort_order: 0 }], post_external_references: [] });
    return { client, input, upload, remove, rpc, read, query, snapshot };
  }

  it("never deletes uploads while the authoritative reference read is pending, and recovers confirmed success", async () => {
    const f = fixture(new Error("fetch response lost"));
    const read = deferred<unknown>();
    f.read.mockReturnValue(read.promise);
    const save = updatePost(f.client as never, editingPost(), f.input);
    await vi.waitFor(() => expect(f.read).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.query.eq).toHaveBeenCalledWith("author_id", "user-id");
    read.resolve({ data: f.snapshot(), error: null });
    await expect(save).resolves.toEqual({ cleanupPending: false });
    expect(f.remove).not.toHaveBeenCalled();
  });

  it.each(["unavailable", "absent", "different content", "malformed collections"])("retains uploads when a transport failure leaves an %s readback", async (state) => {
    const f = fixture(new Error("network timeout"));
    f.read.mockImplementation(async () => state === "unavailable" ? { data: null, error: new Error("offline") }
      : { data: { ...f.snapshot(), title: "old title", ...(state === "absent" ? { post_images: [] } : state === "malformed collections" ? { post_images: {} } : {}) }, error: null });
    await expect(updatePost(f.client as never, editingPost(), f.input)).rejects.toBeInstanceOf(UncertainMutationError);
    expect(f.remove).not.toHaveBeenCalled();
  });

  it("cleans new uploads only for explicit database rejection plus verified absence of references", async () => {
    const rejected = { code: "P0001", message: "rejected" };
    const f = fixture(rejected);
    f.read.mockImplementation(async () => ({ data: { ...f.snapshot(), title: "old title", post_images: [] }, error: null }));
    await expect(updatePost(f.client as never, editingPost(), f.input)).rejects.toEqual(rejected);
    expect(f.read).toHaveBeenCalledTimes(1);
    expect(f.remove).toHaveBeenCalledWith([f.upload.mock.calls[0][0]]);
  });

  it("does not infer rollback from a later explicit rejection after an earlier lost acknowledgement", async () => {
    const f = fixture({ code: "P0001", message: "rejected" });
    f.rpc.mockResolvedValueOnce({ error: new Error("lost acknowledgement") });
    f.read.mockImplementation(async () => ({ data: { ...f.snapshot(), title: "old title", post_images: [] }, error: null }));
    await expect(updatePost(f.client as never, editingPost(), f.input)).rejects.toBeInstanceOf(UncertainMutationError);
    expect(f.remove).not.toHaveBeenCalled();
  });
});

describe("posting transaction", () => {
  function committedPublishingGateway() {
    const input = createInput(imageFiles(1));
    let snapshot: Record<string, unknown> | null = null;
    const gateway = publishingGateway({
      insertDraft: vi.fn(async (value: Record<string, unknown>) => { snapshot = { ...value, post_images: [], post_external_references: [], post_sources: [] }; }),
      insertImages: vi.fn(async (rows: Record<string, unknown>[]) => { snapshot!.post_images = rows; }),
      insertReferences: vi.fn(async (rows: Record<string, unknown>[]) => { snapshot!.post_external_references = rows; }),
      publish: vi.fn(async () => { snapshot!.status = "published"; throw new Error("publish acknowledgement lost after commit"); }),
      readPost: vi.fn(async () => snapshot as never),
    });
    return { gateway, input, snapshot: () => snapshot };
  }

  it("recovers an actually published post whose acknowledgement was lost without deleting its objects or row", async () => {
    const f = committedPublishingGateway();
    const read = deferred<never>();
    vi.mocked(f.gateway.readPost!).mockReturnValue(read.promise);
    const save = createPost({} as never, f.input, f.gateway);
    await vi.waitFor(() => expect(f.gateway.readPost).toHaveBeenCalledTimes(1));
    expect(f.snapshot()!.status).toBe("published");
    expect(f.gateway.removeFiles).not.toHaveBeenCalled();
    expect(f.gateway.removePost).not.toHaveBeenCalled();
    read.resolve(f.snapshot() as never);
    await expect(save).resolves.toBe("post-id");
    expect(f.gateway.removeFiles).not.toHaveBeenCalled();
    expect(f.gateway.removePost).not.toHaveBeenCalled();
  });

  it.each(["read unavailable", "published mismatch", "still draft"])("retains the post and uploads when lost publish acknowledgement leaves %s", async (state) => {
    const f = committedPublishingGateway();
    vi.mocked(f.gateway.readPost!).mockImplementation(async () => {
      if (state === "read unavailable") throw new Error("offline");
      return { ...f.snapshot(), ...(state === "still draft" ? { status: "draft" } : { title: "a different title" }) } as never;
    });
    await expect(createPost({} as never, f.input, f.gateway)).rejects.toMatchObject({ name: "UncertainMutationError", recoveryPath: "/community/post/post-id" });
    expect(f.gateway.removeFiles).not.toHaveBeenCalled();
    expect(f.gateway.removePost).not.toHaveBeenCalled();
  });

  it("does not delete draft image references when their insert committed but its acknowledgement was lost", async () => {
    const f = committedPublishingGateway();
    vi.mocked(f.gateway.insertImages).mockImplementation(async (rows) => { f.snapshot()!.post_images = rows; throw new Error("image insert acknowledgement lost"); });
    await expect(createPost({} as never, f.input, f.gateway)).rejects.toBeInstanceOf(UncertainMutationError);
    expect(f.gateway.publish).not.toHaveBeenCalled();
    expect(f.gateway.removeFiles).not.toHaveBeenCalled();
    expect(f.gateway.removePost).not.toHaveBeenCalled();
  });

  it("does not falsely call an unconfirmed draft insertion a successful publish", async () => {
    const gateway = publishingGateway({ insertDraft: vi.fn(async () => { throw new Error("draft response lost"); }), readPost: vi.fn(async () => null) });
    await expect(createPost({} as never, createInput([]), gateway)).rejects.toBeInstanceOf(UncertainMutationError);
    expect(gateway.publish).not.toHaveBeenCalled();
    expect(gateway.removePost).not.toHaveBeenCalled();
  });
  it("publishes only after every image row is saved", async () => {
    const calls: string[] = [];
    const gateway = {
      makeId: vi.fn().mockReturnValueOnce("post-id").mockReturnValue("image-id"),
      insertDraft: vi.fn(async () => { calls.push("draft"); }),
      uploadImage: vi.fn(async () => { calls.push("upload"); }),
      insertImages: vi.fn(async () => { calls.push("images"); }),
      publish: vi.fn(async () => { calls.push("publish"); }),
      removeFiles: vi.fn(async () => undefined),
      removePost: vi.fn(async () => undefined),
    };
    const file = new File(["image"], "wave.png", { type: "image/png" });
    const id = await createPost({} as never, {
      userId: "user-id",
      board: "idea_sharing",
      title: "一个完整的标题",
      body: "这里是完整的正文内容，长度已经足够发布。",
      externalUrl: "",
      externalKind: null,
      files: [file],
    }, gateway);
    expect(id).toBe("post-id");
    expect(calls).toEqual(["draft", "upload", "images", "publish"]);
  });

  it("removes files and the hidden draft when upload fails", async () => {
    const gateway = {
      makeId: vi.fn().mockReturnValueOnce("post-id").mockReturnValue("image-id"),
      insertDraft: vi.fn(async () => undefined),
      uploadImage: vi.fn(async () => { throw new Error("upload failed"); }),
      insertImages: vi.fn(async () => undefined),
      publish: vi.fn(async () => undefined),
      removeFiles: vi.fn(async () => undefined),
      removePost: vi.fn(async () => undefined),
    };
    const file = new File(["image"], "wave.png", { type: "image/png" });
    await expect(createPost({} as never, {
      userId: "user-id",
      board: "case_submission",
      title: "一个完整的标题",
      body: "这里是完整的正文内容，长度已经足够发布。",
      externalUrl: "",
      externalKind: null,
      files: [file],
    }, gateway)).rejects.toThrow("upload failed");
    expect(gateway.removeFiles).toHaveBeenCalledWith(["user-id/post-id/image-id.png"]);
    expect(gateway.removePost).toHaveBeenCalledWith("post-id");
    expect(gateway.publish).not.toHaveBeenCalled();
  });

  it("links a private source before publishing its public snapshot", async () => {
    const calls: string[] = [];
    const gateway = {
      makeId: vi.fn().mockReturnValue("post-id"),
      insertDraft: vi.fn(async () => { calls.push("draft"); }),
      linkSource: vi.fn(async () => { calls.push("source"); }),
      uploadImage: vi.fn(async () => undefined),
      insertImages: vi.fn(async () => { calls.push("images"); }),
      publish: vi.fn(async () => { calls.push("publish"); }),
      removeFiles: vi.fn(async () => undefined),
      removePost: vi.fn(async () => undefined),
    };
    await createPost({} as never, {
      userId: "user-id",
      board: "public_viewpoint",
      title: "私人复盘的公开副本",
      body: "只复制允许公开的标题和正文，不包含私人核验数据。",
      externalUrl: "",
      externalKind: null,
      files: [],
      privateEntryId: "private-entry-id",
    }, gateway);
    expect(calls).toEqual(["draft", "source", "images", "publish"]);
    expect(gateway.linkSource).toHaveBeenCalledWith({ post_id: "post-id", private_entry_id: "private-entry-id", owner_id: "user-id" });
  });

  it("persists every validated media reference before publishing", async () => {
    const calls: string[] = [];
    const gateway = {
      makeId: vi.fn().mockReturnValue("post-id"),
      insertDraft: vi.fn(async () => { calls.push("draft"); }),
      uploadImage: vi.fn(async () => undefined),
      insertImages: vi.fn(async () => { calls.push("images"); }),
      insertReferences: vi.fn(async () => { calls.push("references"); }),
      publish: vi.fn(async () => { calls.push("publish"); }),
      removeFiles: vi.fn(async () => undefined),
      removePost: vi.fn(async () => undefined),
    };
    await createPost({} as never, {
      userId: "user-id",
      board: "idea_sharing",
      title: "多媒体引用保存测试",
      body: "YouTube 与 X 引用必须在帖子公开以前全部成功保存。",
      externalReferences: [
        { url: "https://youtu.be/abcdefgh", kind: "youtube", sort_order: 0 },
        { url: "https://x.com/wavekb/status/123", kind: "x", sort_order: 1 },
      ],
      files: [],
    }, gateway);
    expect(calls).toEqual(["draft", "images", "references", "publish"]);
    expect(gateway.insertReferences).toHaveBeenCalledWith([
      expect.objectContaining({ post_id: "post-id", kind: "youtube", sort_order: 0 }),
      expect.objectContaining({ post_id: "post-id", kind: "x", sort_order: 1 }),
    ]);
  });

  it("limits uploads to three, preserves image order and reports completed file counts", async () => {
    const files = imageFiles(5);
    const uploads = files.map(() => deferred<void>());
    const progress: PostPublishingProgress[] = [];
    let active = 0;
    let maximum = 0;
    const uploadImage = vi.fn(async (_path: string, file: File) => {
      active += 1;
      maximum = Math.max(maximum, active);
      try { await uploads[files.indexOf(file)]!.promise; }
      finally { active -= 1; }
    });
    const gateway = publishingGateway({ uploadImage });
    const pending = createPost({} as never, createInput(files, (event) => { progress.push(event); }), gateway);

    await vi.waitFor(() => expect(uploadImage).toHaveBeenCalledTimes(3));
    expect(progress).toEqual([
      { phase: "preparing", completed: 0, total: 5 },
      { phase: "uploading", completed: 0, total: 5 },
    ]);
    uploads[2]!.resolve(undefined);
    await vi.waitFor(() => expect(uploadImage).toHaveBeenCalledTimes(4));
    uploads[3]!.resolve(undefined);
    await vi.waitFor(() => expect(uploadImage).toHaveBeenCalledTimes(5));
    uploads[4]!.resolve(undefined);
    uploads[0]!.resolve(undefined);
    expect(gateway.publish).not.toHaveBeenCalled();
    uploads[1]!.resolve(undefined);

    await expect(pending).resolves.toBe("post-id");
    expect(maximum).toBe(3);
    expect(gateway.insertImages).toHaveBeenCalledWith(files.map((_, index) => expect.objectContaining({
      storage_path: `user-id/post-id/image-${index}.png`,
      sort_order: index,
    })));
    expect(progress).toEqual([
      { phase: "preparing", completed: 0, total: 5 },
      ...Array.from({ length: 6 }, (_, completed) => ({ phase: "uploading", completed, total: 5 })),
      { phase: "publishing", completed: 5, total: 5 },
    ]);
  });

  it("waits for every in-flight upload before removing failed-post files and draft", async () => {
    const files = imageFiles(3);
    const uploads = files.map(() => deferred<void>());
    const events: string[] = [];
    const progress: PostPublishingProgress[] = [];
    const uploadImage = vi.fn(async (_path: string, file: File) => {
      const index = files.indexOf(file);
      try { await uploads[index]!.promise; }
      finally { events.push(`settled-${index}`); }
    });
    const removeFiles = vi.fn<(paths: string[]) => Promise<void>>(async () => { events.push("remove-files"); });
    const removePost = vi.fn<(id: string) => Promise<void>>(async () => { events.push("remove-draft"); });
    const gateway = publishingGateway({ uploadImage, removeFiles, removePost });
    const pending = createPost({} as never, createInput(files, (event) => { progress.push(event); }), gateway);
    const rejected = expect(pending).rejects.toThrow("first upload failed");
    await vi.waitFor(() => expect(uploadImage).toHaveBeenCalledTimes(3));

    uploads[0]!.reject(new Error("first upload failed"));
    await vi.waitFor(() => expect(events).toContain("settled-0"));
    expect(removeFiles).not.toHaveBeenCalled();
    expect(removePost).not.toHaveBeenCalled();
    uploads[1]!.resolve(undefined);
    await vi.waitFor(() => expect(events).toContain("settled-1"));
    expect(removeFiles).not.toHaveBeenCalled();
    uploads[2]!.reject(new Error("another upload failed"));

    await rejected;
    expect(events).toEqual(["settled-0", "settled-1", "settled-2", "remove-files", "remove-draft"]);
    expect(removeFiles).toHaveBeenCalledWith(files.map((_, index) => `user-id/post-id/image-${index}.png`));
    expect(gateway.insertImages).not.toHaveBeenCalled();
    expect(gateway.publish).not.toHaveBeenCalled();
    expect(progress.some((event) => event.phase === "publishing")).toBe(false);
  });

  it.each(["throw", "reject"])("publishes without images even when the progress observer can %s", async (failure) => {
    const progress: PostPublishingProgress[] = [];
    const gateway = publishingGateway();
    const onProgress = (event: PostPublishingProgress) => {
      progress.push(event);
      if (failure === "throw") throw new Error("observer failed");
      return Promise.reject(new Error("async observer failed"));
    };

    await expect(createPost({} as never, createInput([], onProgress), gateway)).resolves.toBe("post-id");
    expect(progress).toEqual([
      { phase: "preparing", completed: 0, total: 0 },
      { phase: "publishing", completed: 0, total: 0 },
    ]);
    expect(gateway.publish).toHaveBeenCalledWith("post-id");
    expect(gateway.removePost).not.toHaveBeenCalled();
  });
});

describe("post editing transaction", () => {
  it("sends content, images and chart package through the atomic RPC", async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    const client = { rpc, storage: { from: vi.fn() } } as never;
    await updatePost(client, {
      id: "11111111-1111-4111-8111-111111111111",
      author_id: "22222222-2222-4222-8222-222222222222",
      status: "published",
      post_images: [],
    } as never, {
      userId: "22222222-2222-4222-8222-222222222222",
      title: "原子更新测试",
      body: "正文、图片、外链和图表必须在同一个事务内更新。",
      externalUrl: "",
      externalKind: null,
      keptImageIds: [],
      files: [],
      chartPackage: { symbol: "BINANCE:BTCUSDT" } as never,
    });
    expect(rpc).toHaveBeenCalledWith("update_my_post_v4", expect.objectContaining({
      p_chart_package: expect.objectContaining({ symbol: "BINANCE:BTCUSDT" }),
      p_images: [],
      p_external_references: [],
    }));
  });

  it("bounds new-image uploads, keeps RPC image order and reports phases before the atomic update", async () => {
    const files = imageFiles(4);
    const uploads = files.map(() => deferred<{ error: null }>());
    const progress: PostPublishingProgress[] = [];
    let active = 0;
    let maximum = 0;
    const upload = vi.fn(async (_path: string, file: File) => {
      active += 1;
      maximum = Math.max(maximum, active);
      try { return await uploads[files.indexOf(file)]!.promise; }
      finally { active -= 1; }
    });
    const rpc = vi.fn(async () => ({ error: null }));
    const remove = vi.fn(async () => ({ error: null }));
    const client = { rpc, storage: { from: vi.fn(() => ({ upload, remove })) } } as never;
    const post = editingPost([{ id: "kept", storage_path: "user-id/post-id/kept.png", caption: "原始图" }]);
    const input = { ...updateInput(files, (event) => { progress.push(event); }), keptImageIds: ["kept"], newImageCaptions: ["零", "一", "二", "三"] };
    const pending = updatePost(client, post, input);

    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(3));
    uploads[2]!.resolve({ error: null });
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(4));
    uploads[3]!.resolve({ error: null });
    uploads[0]!.resolve({ error: null });
    expect(rpc).not.toHaveBeenCalled();
    uploads[1]!.resolve({ error: null });

    await expect(pending).resolves.toEqual({ cleanupPending: false });
    expect(maximum).toBe(3);
    expect(rpc).toHaveBeenCalledWith("update_my_post_v4", expect.objectContaining({
      p_images: [
        { storage_path: "user-id/post-id/kept.png", caption: "原始图" },
        ...upload.mock.calls.map(([storagePath], index) => ({ storage_path: storagePath, caption: input.newImageCaptions[index] })),
      ],
    }));
    expect(progress).toEqual([
      { phase: "preparing", completed: 0, total: 4 },
      ...Array.from({ length: 5 }, (_, completed) => ({ phase: "uploading", completed, total: 4 })),
      { phase: "publishing", completed: 4, total: 4 },
    ]);
    expect(remove).not.toHaveBeenCalled();
  });

  it("waits for in-flight edit uploads before cleanup and never calls the RPC after an upload failure", async () => {
    const files = imageFiles(3);
    const uploads = files.map(() => deferred<{ error: null }>());
    const events: string[] = [];
    const upload = vi.fn(async (_path: string, file: File) => {
      const index = files.indexOf(file);
      try { return await uploads[index]!.promise; }
      finally { events.push(`settled-${index}`); }
    });
    const remove = vi.fn<(paths: string[]) => Promise<{ error: null }>>(async () => { events.push("cleanup"); return { error: null }; });
    const rpc = vi.fn(async () => ({ error: null }));
    const client = { rpc, storage: { from: vi.fn(() => ({ upload, remove })) } } as never;
    const pending = updatePost(client, editingPost(), updateInput(files));
    const rejected = expect(pending).rejects.toThrow("edit upload failed");
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(3));

    uploads[0]!.reject(new Error("edit upload failed"));
    await vi.waitFor(() => expect(events).toContain("settled-0"));
    expect(remove).not.toHaveBeenCalled();
    uploads[1]!.resolve({ error: null });
    await vi.waitFor(() => expect(events).toContain("settled-1"));
    expect(remove).not.toHaveBeenCalled();
    uploads[2]!.resolve({ error: null });

    await rejected;
    expect(events).toEqual(["settled-0", "settled-1", "settled-2", "cleanup"]);
    expect(remove).toHaveBeenCalledWith(upload.mock.calls.map(([path]) => path));
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(["returned", "thrown"])("keeps the committed update successful when old-image cleanup errors are %s", async (failure) => {
    const events: string[] = [];
    const progress: PostPublishingProgress[] = [];
    const rpc = vi.fn(async () => { events.push("commit"); return { error: null }; });
    const remove = vi.fn<(paths: string[]) => Promise<{ error: { message: string } }>>(async () => {
      events.push("cleanup");
      if (failure === "thrown") throw new Error("storage request failed");
      return { error: { message: "storage cleanup failed" } };
    });
    const client = { rpc, storage: { from: vi.fn(() => ({ remove })) } } as never;
    const onProgress = (event: PostPublishingProgress) => { progress.push(event); throw new Error("observer failed"); };

    await expect(updatePost(client, editingPost([{ id: "removed", storage_path: "user-id/post-id/old.png" }]), updateInput([], onProgress)))
      .resolves.toEqual({ cleanupPending: true });
    expect(events).toEqual(["commit", "cleanup"]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(["user-id/post-id/old.png"]);
    expect(progress).toEqual([
      { phase: "preparing", completed: 0, total: 0 },
      { phase: "publishing", completed: 0, total: 0 },
    ]);
  });
});

describe("research timeline transaction", () => {
  function lostTimeline(error: unknown = new Error("timeline acknowledgement lost after commit")) {
    const input = { postId: "post-id", userId: "user-id", kind: "confirmed" as const, body: " 已确认的新节点。 ", files: imageFiles(1), captions: ["新快照"] };
    let committed: Record<string, unknown> | null = null;
    const upload = vi.fn().mockResolvedValue({ error: null });
    const remove = vi.fn().mockResolvedValue({ error: null });
    const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => {
      committed = { id: args.p_node_id, post_id: args.p_post_id, author_id: input.userId, kind: args.p_kind, body: args.p_body,
        research_timeline_images: (args.p_images as Record<string, unknown>[]).map((image, sort_order) => ({ ...image, sort_order })) };
      return { error };
    });
    const read = vi.fn(async () => ({ data: committed, error: null }));
    const getUser = vi.fn().mockResolvedValue({ data: { user: { id: input.userId } }, error: null });
    const query = { eq: vi.fn().mockReturnThis(), maybeSingle: read };
    const client = { auth: { getUser }, rpc, from: vi.fn(() => ({ select: vi.fn(() => query) })), storage: { from: () => ({ upload, remove }) } };
    return { input, client, upload, remove, rpc, read, getUser, committed: () => committed };
  }

  it("recovers a committed immutable node only after the readback matches its identity, content and image references", async () => {
    const f = lostTimeline();
    const pendingRead = deferred<never>();
    f.read.mockReturnValue(pendingRead.promise);
    const save = appendPostTimelineNode(f.client as never, f.input);
    await vi.waitFor(() => expect(f.read).toHaveBeenCalledTimes(1));
    expect(f.committed()!.id).toBe(f.rpc.mock.calls[0][1].p_node_id);
    expect(f.remove).not.toHaveBeenCalled();
    pendingRead.resolve({ data: f.committed(), error: null } as never);
    await expect(save).resolves.toBe(f.committed()!.id);
    expect(f.remove).not.toHaveBeenCalled();
  });

  it.each(["unavailable", "absent", "content mismatch"])("preserves node images if a lost acknowledgement leaves %s readback", async (state) => {
    const f = lostTimeline();
    f.read.mockImplementation(async () => state === "unavailable" ? { data: null, error: new Error("offline") } as never
      : { data: state === "absent" ? null : { ...f.committed(), body: "different" }, error: null });
    await expect(appendPostTimelineNode(f.client as never, f.input)).rejects.toBeInstanceOf(UncertainMutationError);
    expect(f.remove).not.toHaveBeenCalled();
  });

  it("cleans only after explicit node rejection and an authorized read confirming that the node is absent", async () => {
    const error = { code: "P0001", message: "rejected" };
    const f = lostTimeline(error);
    f.read.mockResolvedValue({ data: null, error: null });
    await expect(appendPostTimelineNode(f.client as never, f.input)).rejects.toEqual(error);
    expect(f.remove).toHaveBeenCalledWith([f.upload.mock.calls[0][0]]);
  });

  it("does not mistake a different account's unreadable node for an absent node", async () => {
    const f = lostTimeline({ code: "P0001", message: "rejected" });
    f.getUser.mockResolvedValue({ data: { user: { id: "other" } }, error: null });
    await expect(appendPostTimelineNode(f.client as never, f.input)).rejects.toBeInstanceOf(UncertainMutationError);
    expect(f.read).not.toHaveBeenCalled();
    expect(f.remove).not.toHaveBeenCalled();
  });
  it("stores a new immutable snapshot under the post timeline path", async () => {
    const upload = vi.fn(async () => ({ error: null }));
    const remove = vi.fn(async () => ({ error: null }));
    const rpc = vi.fn(async () => ({ error: null }));
    const client = { rpc, storage: { from: vi.fn(() => ({ upload, remove })) } } as never;
    const file = new File(["snapshot"], "update.webp", { type: "image/webp" });
    const nodeId = await appendPostTimelineNode(client, {
      postId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      kind: "confirmed",
      body: " 第一目标已经到达。 ",
      files: [file],
      captions: ["确认后的行情快照"],
    });
    expect(nodeId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(upload).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`/timeline/${nodeId}/.+\\.webp$`)), file, expect.objectContaining({ upsert: false }));
    expect(rpc).toHaveBeenCalledWith("append_research_timeline_node", expect.objectContaining({
      p_node_id: nodeId,
      p_kind: "confirmed",
      p_body: "第一目标已经到达。",
      p_images: [expect.objectContaining({ caption: "确认后的行情快照" })],
    }));
  });
});

describe("post deletion transaction", () => {
  it("uses the owner-scoped gateway before best-effort image cleanup", async () => {
    const postId = "11111111-1111-4111-8111-111111111111";
    const userId = "22222222-2222-4222-8222-222222222222";
    const request = vi.fn(async () => new Response(JSON.stringify({
      deleted: true,
      storage_paths: [`${userId}/${postId}/image.png`, "another-user/unsafe.png"],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", request);
    const remove = vi.fn(async () => ({ error: { message: "temporary storage failure" } }));
    const client = {
      storage: { from: vi.fn(() => ({ remove })) },
    } as never;

    const result = await deletePost(client, {
      id: postId,
      author_id: userId,
      status: "published",
      post_images: [{ storage_path: `${userId}/${postId}/image.png` }],
    } as never, userId);

    expect(result).toEqual({ cleanupPending: true });
    expect(request).toHaveBeenCalledWith(`/api/community/posts/${postId}/delete`, expect.objectContaining({ method: "POST" }));
    expect(remove).toHaveBeenCalledWith([`${userId}/${postId}/image.png`]);
  });

  it("retries a transient gateway failure without duplicating destructive work", async () => {
    const postId = "11111111-1111-4111-8111-111111111111";
    const userId = "22222222-2222-4222-8222-222222222222";
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "post_delete_failed" }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ deleted: true, storage_paths: [] }), { status: 200 }));
    vi.stubGlobal("fetch", request);

    await expect(deletePost({ storage: { from: vi.fn() } } as never, {
      id: postId,
      author_id: userId,
      status: "published",
      post_images: [],
    } as never, userId)).resolves.toEqual({ cleanupPending: false });
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe("comment publishing", () => {
  it("uses one real UUID for persistence and immediate reply/delete actions", async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const client = { from: vi.fn(() => ({ insert })) } as never;

    const comment = await addPostComment(client, {
      postId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      body: "  评论已经写入数据库。  ",
    });

    expect(comment.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ id: comment.id, body: "评论已经写入数据库。", status: "visible" }));
  });
});
