import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Page from "./page";
import { membershipPreviewCatalog } from "@/components/membership-commerce.fixtures";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), user: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/auth/dal", () => ({ getCurrentUser: mocks.user }));
beforeEach(() => { vi.resetAllMocks(); mocks.user.mockResolvedValue(null); }); afterEach(cleanup);
it("loads only the public catalog for guests and preserves the membership registration destination", async () => {
  mocks.rpc.mockResolvedValue({ data: membershipPreviewCatalog(), error: null }); render(await Page());
  expect(mocks.rpc).toHaveBeenCalledWith("list_membership_catalog"); expect(mocks.rpc).toHaveBeenCalledOnce(); expect(screen.getByRole("link", { name: "注册免费账户" }).getAttribute("href")).toBe("/register?next=%2Fmembership");
});
it("fails closed on a missing commerce schema without invented VIP prices", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: new Error("PGRST202 schema cache") }); render(await Page()); expect(screen.getByRole("alert").textContent).toContain("尚未部署"); expect(screen.queryByText(/US\$52/)).toBeNull();
});
