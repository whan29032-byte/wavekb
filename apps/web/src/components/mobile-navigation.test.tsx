import type { ComponentProps } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MobileNavigation } from "./mobile-navigation";

vi.mock("next/navigation", () => ({ usePathname: () => "/knowledge" }));
vi.mock("next/link", () => ({ default: ({ prefetch, ...props }: ComponentProps<"a"> & { prefetch?: boolean | null }) => { void prefetch; return <a {...props} />; } }));
afterEach(cleanup);

it("keeps the existing main menu without membership marketing and dismisses after selection", () => {
  render(<MobileNavigation />);
  fireEvent.click(screen.getByRole("button", { name: "展开主导航" }));
  expect(screen.queryByRole("link", { name: /会员/ })).toBeNull();
  const knowledge = screen.getByRole("link", { name: "知识库" });
  expect(knowledge.getAttribute("href")).toBe("/knowledge");
  expect(knowledge.getAttribute("aria-current")).toBe("page");
  fireEvent.click(knowledge);
  expect(screen.queryByRole("navigation", { name: "移动主导航" })).toBeNull();
});
