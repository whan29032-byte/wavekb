import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installBrowserStorage } from "@/test/browser-storage";
import BoardPage from "./[board]/page";
import PostPage from "./post/[id]/page";
import MemberPage from "../member/[uid]/page";

const data = vi.hoisted(() => ({ post: { id: "post", board: "idea_sharing", title: "分页文章", body: "正文", author_id: "author", status: "published", created_at: "2026-09-01", updated_at: "2026-09-01", post_images: [], external_references: [], timeline_nodes: [], chart_package: null, profiles: null, comments_enabled: true } }));
vi.mock("@/lib/env", () => ({ publicSupabaseConfig: () => ({ configured: true }) }));
vi.mock("@/lib/auth/dal", () => ({ getCurrentUser: async () => null, getOptionalActiveMember: async () => null }));
vi.mock("@/lib/community/server-repository", () => ({
  listPosts: async (_board: string, _size?: number, page?: number) => page ? { items: [{ ...data.post, title: `板块第 ${page} 页` }], hasNext: true, total: 100 } : [data.post],
  listPostsByAuthor: async (_author: string, _size?: number, page?: number) => page ? { items: [{ ...data.post, title: `作者第 ${page} 页` }], hasNext: true, total: 1205, boardCount: 4 } : [data.post],
  listPostComments: async (_post: string, page?: number) => page ? { items: [{ id: "comment", post_id: "post", author_id: "author", body: `评论第 ${page} 页`, created_at: "2026-09-01", profiles: null }], hasNext: true, total: 251 } : [],
  getPost: async () => data.post,
}));
vi.mock("@/lib/member/server-repository", () => ({ getMemberProfileByUid: async () => ({ id: "author", public_uid: 12345, display_name: "作者", avatar_url: null, nameplate_style: "classic", bio: "", cover_style: "chart-dark" }), getMemberSocialState: async () => ({ following: false, connection: null }) }));
beforeEach(installBrowserStorage);
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("navigates board results with the requested server page", async () => {
  render(await BoardPage({ params: Promise.resolve({ board: "idea_sharing" }), searchParams: Promise.resolve({ page: "2" }) }));
  expect(screen.getByRole("link", { name: "板块第 2 页" })).toBeDefined();
  expect(screen.getByRole("link", { name: "下一页" }).getAttribute("href")).toBe("/community/idea_sharing?page=3");
});

it("uses exact public totals and keeps the member's later pages reachable", async () => {
  render(await MemberPage({ params: Promise.resolve({ uid: "12345" }), searchParams: Promise.resolve({ page: "3" }) }));
  expect(screen.getByRole("link", { name: "作者第 3 页" })).toBeDefined();
  const summary = screen.getByRole("region", { name: "公开资料摘要" });
  expect(within(summary).getByText("1205")).toBeDefined(); expect(within(summary).getByText("4")).toBeDefined();
  expect(screen.getByRole("link", { name: "下一页" }).getAttribute("href")).toBe("/member/12345?page=4");
});

it("pages comments while leaving the full post detail readable", async () => {
  render(await PostPage({ params: Promise.resolve({ id: "post" }), searchParams: Promise.resolve({ page: "5" }) }));
  expect(screen.getByText("正文")).toBeDefined(); expect(screen.getByText("评论第 5 页")).toBeDefined();
  expect(screen.getByRole("link", { name: "下一页" }).getAttribute("href")).toBe("/community/post/post?page=6");
});
