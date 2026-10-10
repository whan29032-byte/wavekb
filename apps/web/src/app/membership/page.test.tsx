import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Page from "./page";

const mocks = vi.hoisted(() => ({ actor: vi.fn(), rpc: vi.fn(), profile: vi.fn(), commerce: vi.fn(), wallet: vi.fn() }));
vi.mock("@/lib/auth/dal", () => ({ requireActiveMember: mocks.actor }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/member/server-repository", () => ({ getMyProfile: mocks.profile }));
vi.mock("@/components/membership-commerce", () => ({ MembershipCommerce: (props: unknown) => { mocks.commerce(props); return <div>购买组件</div>; } }));
vi.mock("@/components/membership-wallet", () => ({ MembershipWallet: (props: unknown) => { mocks.wallet(props); return <div>钱包支付组件</div>; } }));
vi.mock("@/components/membership-center", () => ({ MembershipCenter: () => <div>授权记录组件</div> }));
beforeEach(() => { vi.resetAllMocks(); mocks.actor.mockResolvedValue({ id: "owner" }); mocks.rpc.mockResolvedValue({ data: null, error: new Error("schema cache") }); });
afterEach(cleanup);

it("keeps the VIP route private and returns only to the current owner's verified center", async () => {
  mocks.profile.mockResolvedValue({ id: "owner", public_uid: 12345 }); render(await Page());
  expect(mocks.actor).toHaveBeenCalledWith("/membership"); expect(mocks.profile).toHaveBeenCalledWith("owner");
  expect(screen.getByRole("link", { name: "返回个人中心" }).getAttribute("href")).toBe("/member/12345");
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("我的 VIP 会员");
  expect(mocks.commerce).toHaveBeenCalledWith(expect.objectContaining({readOnly:true,actorId:"owner"}));
  expect(mocks.wallet).toHaveBeenCalledWith(expect.objectContaining({actorId:"owner",initial:null}));
});

it.each(["unavailable", "foreign"])("uses the private profile fallback if identity is %s", async (condition) => {
  if (condition === "unavailable") mocks.profile.mockRejectedValue(new Error("offline"));
  else mocks.profile.mockResolvedValue({ id: "other", public_uid: 54321 });
  render(await Page()); expect(screen.getByRole("link", { name: "返回个人中心" }).getAttribute("href")).toBe("/member/profile");
});
