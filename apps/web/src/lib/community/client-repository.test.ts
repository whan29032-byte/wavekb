import { describe, expect, it, vi } from "vitest";
import { createPost } from "./client-repository";

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
});
