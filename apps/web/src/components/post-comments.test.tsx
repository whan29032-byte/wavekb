import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
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
});
