import type { AnchorHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { knowledgeData } from "@wavekb/knowledge";
import KnowledgeChapterPage from "./chapters/[id]/page";
import KnowledgeThemePage from "./themes/[id]/page";
import KnowledgeQuestionPage from "./questions/[id]/page";
import KnowledgeBookDetailPage from "./books/[id]/page";
import { UNIT_BOOK_ID } from "@/lib/knowledge/book-catalog";

vi.mock("next/link", () => ({
  default: ({ href, className, children, prefetch }: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => <a href={href} className={className} data-next-client-link="true" data-prefetch={String(prefetch)}>{children}</a>,
}));
afterEach(() => cleanup());

const data = knowledgeData();
const cases = [
  { section: "chapters", label: "返回原书目录", id: "chapter-01", Page: KnowledgeChapterPage },
  { section: "themes", label: "返回八大主题", id: data.themes[0]!.id, Page: KnowledgeThemePage },
  { section: "questions", label: "返回问题路线", id: data.questions[0]!.id, Page: KnowledgeQuestionPage },
];

describe("native book index return links", () => {
  it.each(cases)("returns $section to an existing expanded index without client hash duplication", async ({ section, label, id, Page }) => {
    const source = render(await Page({ params: Promise.resolve({ id }) }));
    const link = screen.getByRole("link", { name: label }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(`/knowledge/books/${UNIT_BOOK_ID}?section=${section}#core-${section}`);
    expect(link.getAttribute("data-next-client-link")).toBeNull();
    expect(link.className).toContain("min-h-11");
    expect(link.className).toContain("focus-visible:outline");
    expect(source.container.querySelectorAll("a[data-next-client-link]").length).toBeGreaterThan(0);
    source.container.querySelectorAll("a[data-next-client-link]").forEach((entry) => expect(entry.getAttribute("data-prefetch")).toBe("false"));
    const destination = new URL(link.href);
    source.unmount();

    render(await KnowledgeBookDetailPage({
      params: Promise.resolve({ id: UNIT_BOOK_ID }),
      searchParams: Promise.resolve({ section: destination.searchParams.get("section")! }),
    }));
    const target = document.getElementById(destination.hash.slice(1));
    expect(target).not.toBeNull();
    expect((target as HTMLDetailsElement).open).toBe(true);
    expect(target?.className).toContain("scroll-mt-24");
  });
});
