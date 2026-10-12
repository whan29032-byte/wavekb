import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Page from "./page";

const mocks = vi.hoisted(() => ({ actor: vi.fn(), personalConnections: vi.fn() }));
vi.mock("@/lib/auth/dal", () => ({ requireActiveMember: mocks.actor }));
vi.mock("@/components/ai-connections", () => ({ AiConnections: () => {
  mocks.personalConnections(); return <section aria-label="个人模型接口">自带 Key 设置</section>;
} }));

beforeEach(() => { vi.clearAllMocks(); mocks.actor.mockResolvedValue({ id: "owner" }); });
afterEach(cleanup);

it("shows the separate member-only Hermes entry alongside existing personal model settings", async () => {
  render(await Page());
  expect(mocks.actor).toHaveBeenCalledWith("/workbench/ai");
  expect(screen.getByRole("heading", { level: 1, name: "选择 AI 分析服务" })).toBeDefined();
  expect(screen.getByRole("region", { name: "Hermes 云端研究" })).toBeDefined();
  expect(screen.getByRole("region", { name: "个人模型接口" })).toBeDefined();
  expect(screen.getByText("会员专属")).toBeDefined();
});

it("does not render the AI center if the existing active-account guard fails", async () => {
  mocks.actor.mockRejectedValue(new Error("authentication_required"));
  await expect(Page()).rejects.toThrow("authentication_required");
  expect(mocks.personalConnections).not.toHaveBeenCalled();
});
