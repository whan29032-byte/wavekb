import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { HermesMemberAiCard } from "./hermes-member-ai-card";

afterEach(cleanup);

it("presents Hermes as a separate membership service without a personal credential form", () => {
  render(<HermesMemberAiCard />);
  expect(screen.getByRole("region", { name: "Hermes 云端研究" })).toBeDefined();
  expect(screen.getByText("会员专属")).toBeDefined();
  expect(screen.getByText(/无需填写个人 API Key/)).toBeDefined();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.getByRole("link", { name: "前往分析，选择 Hermes" }).getAttribute("href")).toBe("/workbench");
  expect(screen.getByRole("link", { name: "查看我的会员与额度" }).getAttribute("href")).toBe("/membership");
});

it("does not advertise local tools or unverified learning as available capabilities", () => {
  render(<HermesMemberAiCard />);
  expect(screen.getByText(/不连接本机 Hermes/)).toBeDefined();
  expect(screen.getByText(/不代表模型已训练或结论已验证/)).toBeDefined();
});
