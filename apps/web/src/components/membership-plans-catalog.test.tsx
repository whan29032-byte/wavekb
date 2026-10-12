import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MembershipPlansCatalog } from "./membership-plans-catalog";
import { membershipPreviewCatalog } from "./membership-commerce.fixtures";
import { walletPreviewMine } from "./membership-wallet.fixtures";
import type { WalletCatalog } from "@/lib/membership/wallet-types";
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
  it("shows available wallet payment without advertising an unused card checkout or rendering recipients", () => {
    const wallet = walletPreviewMine(true).catalog;
    render(<MembershipPlansCatalog catalog={membershipPreviewCatalog()} walletCatalog={wallet} />);
    expect(screen.getByRole("status").textContent).toContain("钱包付款已开放");
    expect(screen.getByRole("status").textContent).toContain("订单专属小数金额");
    expect(screen.queryByText(/银行卡付款/)).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("提交交易哈希");
    expect(screen.getAllByText("在个人中心选择钱包付款")).toHaveLength(2);
    expect(screen.queryByText(/当前为测试付款模式/)).toBeNull();
    for (const route of wallet.routes) expect(screen.queryByText(route.recipient!, { exact: false })).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/US\$52\.00/)).toBeDefined(); expect(screen.getByText(/US\$520\.00/)).toBeDefined();
  });
  it("never treats card availability as wallet availability", () => {
    render(<MembershipPlansCatalog catalog={membershipPreviewCatalog(true)} walletCatalog={walletPreviewMine().catalog} signedIn personalCenterHref="/member/12345" />);
    expect(screen.getByRole("status").textContent).toContain("钱包付款尚未开放");
    expect(screen.queryByText(/钱包付款已开放/)).toBeNull();
    expect(screen.queryByText(/银行卡付款/)).toBeNull();
    expect(screen.getAllByText("钱包付款尚未开放")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "前往个人中心" }).getAttribute("href")).toBe("/member/12345");
  });
  it.each([null, { ...walletPreviewMine().catalog, purchase_available: true }, { ...walletPreviewMine(true).catalog, routes: [] }])("fails closed for explicit missing or invalid wallet data", (wallet) => {
    render(<MembershipPlansCatalog catalog={membershipPreviewCatalog()} walletCatalog={wallet as WalletCatalog | null} />);
    expect(screen.getByRole("status").textContent).toContain("钱包付款状态待核实");
    expect(screen.queryByText(/钱包付款已开放/)).toBeNull();
    expect(screen.getAllByText("钱包付款状态待核实")).toHaveLength(2);
  });
  it("does not advertise availability if an explicit wallet error accompanies an open response", () => {
    render(<MembershipPlansCatalog catalog={membershipPreviewCatalog()} walletCatalog={walletPreviewMine(true).catalog} walletError="钱包付款状态待核实，请重新核对。" />);
    expect(screen.getByRole("status").textContent).toContain("待核实");
    expect(screen.queryByText(/钱包付款已开放/)).toBeNull();
  });
});
