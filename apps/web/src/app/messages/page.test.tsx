import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import MessagesPage from "./page";

vi.mock("@/lib/auth/dal", () => ({ requireActiveMember: async () => ({ id: "actor" }) }));
vi.mock("@/lib/member/server-repository", () => ({ listConversations: async () => [{ conversation_id: "chat", display_name: "好友", avatar_url: "https://example.test/avatar.png", public_uid: 12346, nameplate_style: "rainbow", last_message: "[[sticker:diamond]]", unread_count: 2 }] }));
afterEach(cleanup);

it("renders the member's real avatar and styled identity in the full-page conversation list", async () => {
  render(await MessagesPage());
  expect(screen.getByRole("img", { name: "好友的头像" }).getAttribute("src")).toBe("https://example.test/avatar.png");
  expect(screen.getByText("好友", { selector: "strong" }).getAttribute("data-nameplate")).toBe("rainbow");
  expect(screen.getByLabelText("UID 12346")).toBeDefined();
  expect(screen.getByText("💎 高质量")).toBeDefined();
});
