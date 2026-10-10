import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Page from "./page";
import { membershipPreviewCatalog } from "@/components/membership-commerce.fixtures";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), user: vi.fn(), profile: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/auth/dal", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/member/server-repository", () => ({ getMyProfile: mocks.profile }));
beforeEach(() => { vi.resetAllMocks(); mocks.user.mockResolvedValue(null); }); afterEach(cleanup);
it("loads only the public catalog for guests and keeps opening VIP inside the existing personal center", async () => {
  mocks.rpc.mockResolvedValue({ data: membershipPreviewCatalog(), error: null }); render(await Page());
  expect(mocks.rpc).toHaveBeenCalledWith("list_membership_catalog"); expect(mocks.rpc).toHaveBeenCalledOnce(); expect(mocks.profile).not.toHaveBeenCalled();
  expect(screen.queryByRole("link", { name: "注册免费账户" })).toBeNull();
  expect(screen.getByRole("link", { name: "登录后前往个人中心" }).getAttribute("href")).toBe("/login?next=%2Fmember%2Fprofile");
});
it("fails closed on a missing commerce schema without invented VIP prices", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: new Error("PGRST202 schema cache") }); render(await Page()); expect(screen.getByRole("alert").textContent).toContain("尚未部署"); expect(screen.queryByText(/US\$52/)).toBeNull();
});
it("returns signed-in visitors to their own verified personal center", async () => {
  mocks.user.mockResolvedValue({id:"owner"}); mocks.profile.mockResolvedValue({id:"owner",public_uid:12345});
  mocks.rpc.mockResolvedValue({ data: membershipPreviewCatalog(), error: null }); render(await Page());
  expect(mocks.profile).toHaveBeenCalledWith("owner"); expect(screen.getByRole("link",{name:"前往个人中心"}).getAttribute("href")).toBe("/member/12345");
});
it("falls back to private account settings when identity lookup fails", async () => {
  mocks.user.mockResolvedValue({id:"owner"}); mocks.profile.mockRejectedValue(new Error("offline"));
  mocks.rpc.mockResolvedValue({ data: membershipPreviewCatalog(), error: null }); render(await Page());
  expect(screen.getByRole("link",{name:"前往个人中心"}).getAttribute("href")).toBe("/member/profile");
});
