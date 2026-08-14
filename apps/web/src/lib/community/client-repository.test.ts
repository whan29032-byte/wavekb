import { describe, expect, it, vi } from "vitest";
import { addPostComment, createPost, deletePost, updatePost } from "./client-repository";

describe("posting transaction", () => {
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
    expect(rpc).toHaveBeenCalledWith("update_my_post_v3", expect.objectContaining({
      p_chart_package: expect.objectContaining({ symbol: "BINANCE:BTCUSDT" }),
      p_images: [],
    }));
  });
});

describe("post deletion transaction", () => {
  it("deletes the database row before best-effort image cleanup", async () => {
    const maybeSingle = vi.fn(async () => ({ data: { id: "post-id" }, error: null }));
    const select = vi.fn(() => ({ maybeSingle }));
    const secondEq = vi.fn(() => ({ select }));
    const firstEq = vi.fn(() => ({ eq: secondEq }));
    const remove = vi.fn(async () => ({ error: { message: "temporary storage failure" } }));
    const client = {
      from: vi.fn(() => ({ delete: vi.fn(() => ({ eq: firstEq })) })),
      storage: { from: vi.fn(() => ({ remove })) },
    } as never;

    const result = await deletePost(client, {
      id: "post-id",
      author_id: "user-id",
      status: "published",
      post_images: [{ storage_path: "user-id/post-id/image.png" }],
    } as never, "user-id");

    expect(result).toEqual({ cleanupPending: true });
    expect(firstEq).toHaveBeenCalledWith("id", "post-id");
    expect(secondEq).toHaveBeenCalledWith("author_id", "user-id");
    expect(remove).toHaveBeenCalledWith(["user-id/post-id/image.png"]);
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
