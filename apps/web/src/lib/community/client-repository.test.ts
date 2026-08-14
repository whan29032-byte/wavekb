import { describe, expect, it, vi } from "vitest";
import { addPostComment, createPost, updatePost } from "./client-repository";

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

describe("comment publishing", () => {
  it("returns the persisted comment so the UI can update without a reload race", async () => {
    const row = {
      id: "33333333-3333-4333-8333-333333333333",
      post_id: "11111111-1111-4111-8111-111111111111",
      author_id: "22222222-2222-4222-8222-222222222222",
      parent_id: null,
      body: "评论已经写入数据库。",
      status: "visible",
      created_at: "2026-08-14T00:00:00.000Z",
      updated_at: "2026-08-14T00:00:00.000Z",
    };
    const single = vi.fn(async () => ({ data: row, error: null }));
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    const client = { from: vi.fn(() => ({ insert })) } as never;

    const result = await addPostComment(client, {
      postId: row.post_id,
      userId: row.author_id,
      body: `  ${row.body}  `,
    });

    expect(result).toEqual(row);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ body: row.body, status: "visible" }));
    expect(select).toHaveBeenCalledWith("id,post_id,author_id,parent_id,body,status,created_at,updated_at");
  });
});
