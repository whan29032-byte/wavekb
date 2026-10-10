import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MembershipPlansCatalog } from "./membership-plans-catalog";
import { membershipPreviewCatalog } from "./membership-commerce.fixtures";
afterEach(cleanup);
describe("MembershipPlansCatalog", () => {
  it("shows confirmed prices and numeric benefits while payment is closed", () => {
    render(<MembershipPlansCatalog catalog={membershipPreviewCatalog()} />);
    expect(screen.getByText(/US\$52\.00/)).toBeDefined(); expect(screen.getByText(/US\$520\.00/)).toBeDefined();
    expect(screen.getByText("每日 50 次")).toBeDefined(); expect(screen.getByText(/导师优惠 10%（9 折）/)).toBeDefined();
    expect(screen.queryByRole("link", { name: "前往核对并购买" })).toBeNull();
    expect(screen.getByRole("link", { name: "注册免费账户" }).getAttribute("href")).toBe("/register?next=%2Fmembership");
    expect(screen.getByRole("link", { name: "已有账户，登录" }).getAttribute("href")).toBe("/login?next=%2Fmembership");
  });
  it("does not invent an unavailable catalog or price", () => {
    render(<MembershipPlansCatalog catalog={null} error="暂不可用" />);
    expect(screen.getByRole("alert").textContent).toContain("暂不可用"); expect(screen.queryByText(/US\$52/)).toBeNull();
    expect(screen.getByRole("link", { name: /阅读知识库/ }).getAttribute("href")).toBe("/knowledge");
  });
  it("routes an authenticated visitor to server account checks", () => {
    render(<MembershipPlansCatalog catalog={membershipPreviewCatalog(true)} signedIn />);
    expect(screen.getAllByRole("link", { name: "前往核对并购买" })[0].getAttribute("href")).toBe("/membership");
    expect(screen.getByText(/测试订单不会授予正式 VIP/)).toBeDefined();
  });
});
