import { NextRequest, NextResponse } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
import { proxy } from "./proxy";

const boundary = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("@/lib/supabase/proxy", () => ({ updateSession: boundary.session }));
beforeEach(() => boundary.session.mockReset().mockResolvedValue(NextResponse.next()));

it("rejects an unknown public board before streaming commits a successful response", async () => {
  const response = await proxy(new NextRequest("https://wavekb.com/community/not-a-board"));
  expect(response.status).toBe(404);
  expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  expect(response.headers.get("content-type")).toContain("text/html");
  expect(await response.text()).toContain("找不到这个社区板块");
  expect(boundary.session).not.toHaveBeenCalled();
});

it.each(["/community/idea_sharing", "/community/idea_sharing/new", "/community/post/abc", "/friends", "/login"])("keeps the existing session boundary for %s", async (pathname) => {
  const request = new NextRequest(`https://wavekb.com${pathname}`);
  await proxy(request);
  expect(boundary.session).toHaveBeenCalledWith(request);
});

it.each(["/admin/users", "/friends", "/messages/abc", "/member/profile", "/tutoring/abc", "/mentor/manage", "/workbench", "/login", "/register", "/recover", "/community/idea_sharing/new", "/community/post/abc/edit"])("marks private route %s noindex at the HTTP boundary", async (pathname) => {
  const response = await proxy(new NextRequest(`https://wavekb.com${pathname}`));

  expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
});

it.each(["/knowledge", "/community/idea_sharing", "/community/post/abc"])("does not mark public route %s noindex", async (pathname) => {
  const response = await proxy(new NextRequest(`https://wavekb.com${pathname}`));

  expect(response.headers.get("x-robots-tag")).toBeNull();
});
