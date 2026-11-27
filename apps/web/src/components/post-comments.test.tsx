import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PostComment } from "@wavekb/domain";
import { PostComments } from "./post-comments";

const props = {
  postId: "11111111-1111-4111-8111-111111111111",
  comments: [],
  actorId: "22222222-2222-4222-8222-222222222222",
  actorProfile: null,
  commentsEnabled: true,
  activeMember: true,
};

describe("PostComments hydration guard", () => {
  it("keeps native submission disabled until the client owns the form", () => {
    const html = renderToString(<PostComments {...props} />);

    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>发表评论<\/button>/);
  });

  it("enables comment submission after hydration", async () => {
    render(<PostComments {...props} />);

    expect((await screen.findByRole("button", { name: "发表评论" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the commenter avatar and accepts comment images", async () => {
    const comment: PostComment = {
      id: "33333333-3333-4333-8333-333333333333",
      post_id: props.postId,
      author_id: "44444444-4444-4444-8444-444444444444",
      parent_id: null,
      marker_key: null,
      body: "带图的评论",
      status: "visible",
      created_at: "2026-10-19T00:00:00.000Z",
      updated_at: "2026-10-19T00:00:00.000Z",
      profiles: {
        id: "44444444-4444-4444-8444-444444444444",
        public_uid: 12345,
        display_name: "作者",
        avatar_url: "https://example.test/avatar.webp",
        role: "user",
        nameplate_style: "classic",
      },
    };
    render(<PostComments {...props} comments={[comment]} />);

    expect((await screen.findByAltText("作者的头像")) as HTMLImageElement).toBeDefined();
    expect(screen.getByLabelText("图片（可选，最多 4 张）")).toBeDefined();
  });

  it("links a marker comment to its fill and provides a return to the full discussion", () => {
    const markerKey = "ab".repeat(16);
    const comment: PostComment = {
      id: "33333333-3333-4333-8333-333333333333", post_id: props.postId, author_id: props.actorId,
      parent_id: null, marker_key: markerKey, body: "检查这个成交点。", status: "visible",
      created_at: "2026-11-26T00:00:00.000Z", updated_at: "2026-11-26T00:00:00.000Z", profiles: null,
    };
    const view = render(<PostComments {...props} comments={[comment]} />);
    expect(screen.getByRole("link", { name: "查看对应成交" }).getAttribute("href")).toContain(`?marker=${markerKey}#comments-title`);
    view.rerender(<PostComments {...props} comments={[comment]} markerKey={markerKey} />);
    expect(screen.getByRole("heading", { name: "这笔成交的讨论" })).toBeDefined();
    expect(screen.getByRole("link", { name: "查看全部评论" }).getAttribute("href")).toBe(`/community/post/${props.postId}#comments-title`);
  });
});
