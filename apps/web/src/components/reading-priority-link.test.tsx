import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pathname: "/knowledge/core-full-book", link: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
vi.mock("next/link", () => ({ default: (props: { href: string; children: React.ReactNode; prefetch?: boolean }) => {
  state.link(props);
  return <a href={props.href}>{props.children}</a>;
} }));
import { ReadingPriorityLink } from "./reading-priority-link";

afterEach(() => { cleanup(); state.link.mockClear(); });

it.each(["/knowledge", "/knowledge/core-full-book", "/knowledge/books/elliott-wave-principle-eleventh-edition"])("does not prefetch an unclicked destination while reading %s", (pathname) => {
  state.pathname = pathname;
  render(<ReadingPriorityLink href="/knowledge" prefetch>返回知识库</ReadingPriorityLink>);
  expect(state.link.mock.calls.at(-1)?.[0].prefetch).toBe(false);
  expect(screen.getByRole("link", { name: "返回知识库" }).getAttribute("href")).toBe("/knowledge");
});

it("preserves normal client navigation and its existing prefetch policy outside reading", () => {
  state.pathname = "/community/idea_sharing";
  render(<ReadingPriorityLink href="/mentors">导师</ReadingPriorityLink>);
  expect(state.link.mock.calls.at(-1)?.[0].prefetch).toBeUndefined();
  render(<ReadingPriorityLink href="/research" prefetch={false}>机构研报</ReadingPriorityLink>);
  expect(state.link.mock.calls.at(-1)?.[0].prefetch).toBe(false);
});
