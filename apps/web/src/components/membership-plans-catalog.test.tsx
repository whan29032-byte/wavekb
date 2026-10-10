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
    expect(screen.queryByRole("heading", { name: "免费账户" })).toBeNull();
    expect(screen.queryByRole("link", { name: "注册免费账户" })).toBeNull();
    expect(screen.queryByRole("region", { name: "免费账户可用服务" })).toBeNull();
    expect(screen.getByRole("link", { name: "登录后前往个人中心" }).getAttribute("href")).toBe("/login?next=%2Fmember%2Fprofile");
  });
  it("does not invent an unavailable catalog or price", () => {
    render(<MembershipPlansCatalog catalog={null} error="暂不可用" />);
    expect(screen.getByRole("alert").textContent).toContain("暂不可用"); expect(screen.queryByText(/US\$52/)).toBeNull();
    expect(screen.getByRole("link", { name: "登录后前往个人中心" }).getAttribute("href")).toBe("/login?next=%2Fmember%2Fprofile");
  });
  it("routes an authenticated visitor to server account checks", () => {
    render(<MembershipPlansCatalog catalog={membershipPreviewCatalog(true)} signedIn personalCenterHref="/member/12345" />);
    expect(screen.getByRole("link", { name: "前往个人中心" }).getAttribute("href")).toBe("/member/12345");
    expect(screen.queryByRole("link", { name: "前往核对并购买" })).toBeNull();
    expect(screen.getByText(/测试订单不会授予正式 VIP/)).toBeDefined();
  });
});
