import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Page from "./page";

const mocks = vi.hoisted(() => ({ actor: vi.fn(), profile: vi.fn(), nameplates: vi.fn() }));
vi.mock("@/lib/auth/dal", () => ({ requireActiveMember: mocks.actor }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not-found"); } }));
vi.mock("@/lib/member/server-repository", () => ({ getMyProfile: mocks.profile, getMyNameplates: mocks.nameplates }));
vi.mock("@/components/profile-editor", () => ({ ProfileEditor: () => <div>资料编辑组件</div> }));
vi.mock("@/components/youtube-connection", () => ({ YoutubeConnectionPanel: () => <div>YouTube 绑定组件</div> }));
beforeEach(() => { vi.resetAllMocks(); mocks.actor.mockResolvedValue({ id: "owner" }); mocks.profile.mockResolvedValue({ id: "owner", public_uid: 12345 }); mocks.nameplates.mockResolvedValue([]); });
afterEach(cleanup);

it("exposes VIP management within the existing authenticated profile without new registration", async () => {
  render(await Page()); expect(mocks.actor).toHaveBeenCalledWith("/member/profile"); expect(mocks.profile).toHaveBeenCalledWith("owner");
  const entry = screen.getByRole("link", { name: "开通 / 管理 VIP" }); expect(entry.getAttribute("href")).toBe("/membership"); expect(entry.className).toContain("min-h-11");
  expect(screen.queryByRole("link", { name: /注册/ })).toBeNull();
});

it("does not render a private account or VIP entry for another profile returned by mistake", async () => {
  mocks.profile.mockResolvedValue({ id: "other", public_uid: 54321 }); await expect(Page()).rejects.toThrow("not-found");
});
