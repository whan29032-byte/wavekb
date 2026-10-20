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
});
