import type { ComponentProps } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MobileNavigation } from "./mobile-navigation";

vi.mock("next/navigation", () => ({ usePathname: () => "/membership/plans" }));
vi.mock("next/link", () => ({ default: ({ prefetch, ...props }: ComponentProps<"a"> & { prefetch?: boolean | null }) => { void prefetch; return <a {...props} />; } }));
afterEach(cleanup);

it("exposes public membership plans in the mobile menu and dismisses after selection", () => {
  render(<MobileNavigation />);
  fireEvent.click(screen.getByRole("button", { name: "展开主导航" }));
  const plans = screen.getByRole("link", { name: "会员方案" });
  expect(plans.getAttribute("href")).toBe("/membership/plans");
  expect(plans.getAttribute("aria-current")).toBe("page");
  fireEvent.click(plans);
  expect(screen.queryByRole("navigation", { name: "移动主导航" })).toBeNull();
});
