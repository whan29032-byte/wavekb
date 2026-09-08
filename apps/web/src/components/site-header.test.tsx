import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MobileNavigation } from "./mobile-navigation";
import { SiteHeader } from "./site-header";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("@/components/account-navigation", () => ({ AccountNavigation: () => <span>账户</span> }));
vi.mock("@/components/appearance-settings", () => ({ AppearanceSettings: () => <button type="button">网站外观</button> }));

afterEach(cleanup);

it("keeps the private trading workbench out of the desktop global navigation", () => {
  render(<SiteHeader />);
  const navigation = screen.getByRole("navigation", { name: "主导航" });
  expect(within(navigation).queryByRole("link", { name: "交易工作台" })).toBeNull();
  expect(within(navigation).getByRole("link", { name: "交易收益排行榜" }).getAttribute("href")).toBe("/leaderboard");
});

it("keeps the private trading workbench out of the mobile global navigation", () => {
  render(<MobileNavigation />);
  fireEvent.click(screen.getByRole("button", { name: "展开主导航" }));
  const navigation = screen.getByRole("navigation", { name: "移动主导航" });
  expect(within(navigation).queryByRole("link", { name: "交易工作台" })).toBeNull();
  expect(within(navigation).getByRole("link", { name: "交易收益榜" }).getAttribute("href")).toBe("/leaderboard");
});
