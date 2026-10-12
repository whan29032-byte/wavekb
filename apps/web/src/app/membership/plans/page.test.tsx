import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Page from "./page";
import { membershipPreviewCatalog } from "@/components/membership-commerce.fixtures";
import { walletPreviewMine } from "@/components/membership-wallet.fixtures";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), user: vi.fn(), profile: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/auth/dal", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/member/server-repository", () => ({ getMyProfile: mocks.profile }));
beforeEach(() => {
  vi.resetAllMocks(); mocks.user.mockResolvedValue(null);
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "list_membership_catalog" ? membershipPreviewCatalog() : walletPreviewMine().catalog, error: null }));
}); afterEach(cleanup);
it("loads only the two public catalogs for guests and keeps opening VIP inside the existing personal center", async () => {
  render(await Page());
  expect(mocks.rpc.mock.calls).toEqual([["list_membership_catalog"], ["list_membership_wallet_routes"]]); expect(mocks.profile).not.toHaveBeenCalled();
  expect(screen.queryByRole("link", { name: "注册免费账户" })).toBeNull();
  expect(screen.getByRole("link", { name: "登录后前往个人中心" }).getAttribute("href")).toBe("/login?next=%2Fmember%2Fprofile");
});
it("fails closed on a missing commerce schema without invented VIP prices", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: new Error("PGRST202 schema cache") }); render(await Page()); expect(screen.getByRole("alert").textContent).toContain("尚未部署"); expect(screen.queryByText(/US\$52/)).toBeNull();
});
it("returns signed-in visitors to their own verified personal center", async () => {
  mocks.user.mockResolvedValue({id:"owner"}); mocks.profile.mockResolvedValue({id:"owner",public_uid:12345});
  render(await Page());
  expect(mocks.profile).toHaveBeenCalledWith("owner"); expect(screen.getByRole("link",{name:"前往个人中心"}).getAttribute("href")).toBe("/member/12345");
});
it("falls back to private account settings when identity lookup fails", async () => {
  mocks.user.mockResolvedValue({id:"owner"}); mocks.profile.mockRejectedValue(new Error("offline"));
  render(await Page());
  expect(screen.getByRole("link",{name:"前往个人中心"}).getAttribute("href")).toBe("/member/profile");
});
it("shows verified wallet availability even while card checkout is closed", async () => {
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "list_membership_catalog" ? membershipPreviewCatalog() : walletPreviewMine(true).catalog, error: null }));
  render(await Page());
  expect(screen.getByRole("status").textContent).toContain("钱包付款已开放");
  expect(screen.getByRole("status").textContent).toContain("完整金额");
  expect(screen.queryByText(/银行卡付款/)).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("提交交易哈希");
  expect(screen.getAllByText("在个人中心选择钱包付款")).toHaveLength(2);
  expect(screen.getByRole("link", { name: "登录后前往个人中心" }).getAttribute("href")).toBe("/login?next=%2Fmember%2Fprofile");
});
it("does not infer wallet availability from an open card catalog", async () => {
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "list_membership_catalog" ? membershipPreviewCatalog(true) : walletPreviewMine().catalog, error: null }));
  render(await Page());
  expect(screen.getByRole("status").textContent).toContain("钱包付款尚未开放");
  expect(screen.queryByText(/钱包付款已开放/)).toBeNull();
  expect(screen.queryByText(/银行卡付款/)).toBeNull();
});
it.each(["rpc-error", "rejected", "invalid"])("keeps prices but marks wallet status unverified on %s", async (failure) => {
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === "list_membership_catalog") return { data: membershipPreviewCatalog(), error: null };
    if (failure === "rejected") throw new Error("private upstream token should never render");
    if (failure === "rpc-error") return { data: walletPreviewMine(true).catalog, error: new Error("private upstream token should never render") };
    return { data: { ...walletPreviewMine().catalog, purchase_available: true }, error: null };
  });
  render(await Page());
  expect(screen.getByRole("status").textContent).toContain("钱包付款状态待核实");
  expect(screen.queryByText(/钱包付款已开放/)).toBeNull();
  expect(screen.getByText(/US\$52\.00/)).toBeDefined();
  expect(screen.queryByText(/private upstream/)).toBeNull();
});
it("starts independent public catalog requests in parallel", async () => {
  let resolveCatalog!: (value: { data: ReturnType<typeof membershipPreviewCatalog>; error: null }) => void;
  mocks.rpc.mockImplementation((name: string) => name === "list_membership_catalog"
    ? new Promise((resolve) => { resolveCatalog = resolve; })
    : Promise.resolve({ data: walletPreviewMine(true).catalog, error: null }));
  const page = Page();
  await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(2));
  resolveCatalog({ data: membershipPreviewCatalog(), error: null });
  render(await page);
  expect(screen.getByRole("status").textContent).toContain("钱包付款已开放");
});
