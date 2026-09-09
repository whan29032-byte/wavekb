import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { knowledgeData } from "@wavekb/knowledge";
import { CORE_BOOK_ID } from "@/lib/knowledge/book-catalog";
import KnowledgeThemePage from "./themes/[id]/page";
import KnowledgeQuestionPage from "./questions/[id]/page";
import KnowledgeChapterPage from "./chapters/[id]/page";

afterEach(() => cleanup());

describe("core book route return links", () => {
  it("returns theme readers to the theme index inside the core book", async () => {
    render(await KnowledgeThemePage({ params: Promise.resolve({ id: knowledgeData().themes[0].id }) }));

    expect(screen.getByRole("link", { name: "返回八大主题" }).getAttribute("href"))
      .toBe(`/knowledge/books/${CORE_BOOK_ID}?section=themes#core-themes`);
  });

  it("returns question readers to the question index inside the core book", async () => {
    render(await KnowledgeQuestionPage({ params: Promise.resolve({ id: knowledgeData().questions[0].id }) }));

    expect(screen.getByRole("link", { name: "返回问题路线" }).getAttribute("href"))
      .toBe(`/knowledge/books/${CORE_BOOK_ID}?section=questions#core-questions`);
  });

  it("returns chapter readers to the chapter index inside the core book", async () => {
    render(await KnowledgeChapterPage({ params: Promise.resolve({ id: knowledgeData().chapters[0].id }) }));

    expect(screen.getByRole("link", { name: "返回原书目录" }).getAttribute("href"))
      .toBe(`/knowledge/books/${CORE_BOOK_ID}?section=chapters#core-chapters`);
  });
});
