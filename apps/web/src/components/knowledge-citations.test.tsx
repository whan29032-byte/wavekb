import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { KnowledgeCitations } from "./knowledge-citations";

afterEach(cleanup);

const citation = {
  knowledge_id: "unit-ewp-rule-impulse-core",
  book_id: "elliott-wave-principle-tenth-edition",
  book_title: "艾略特波浪理论",
  title: "推动浪的三条硬规则",
  source_id: "ewp-10-zh-2016",
  pages: [32],
  href: "/knowledge/unit-ewp-rule-impulse-core",
  snippet: "浪二不得越过浪一的起点。",
};

describe("knowledge citations", () => {
  it("renders only expanded server citations with their book, page, excerpt, and safe link", () => {
    render(<KnowledgeCitations citations={[citation]} jobKnowledgeVersion="version-a" outputKnowledgeVersion="version-a" />);

    expect(screen.getByRole("heading", { name: "本次知识依据" })).toBeDefined();
    expect(screen.getByText("艾略特波浪理论")).toBeDefined();
    expect(screen.getByText("推动浪的三条硬规则")).toBeDefined();
    expect(screen.getByText(/PDF 第 32 页/)).toBeDefined();
    expect(screen.getByText("浪二不得越过浪一的起点。")).toBeDefined();
    expect(screen.getByRole("link", { name: "打开知识原文" }).getAttribute("href")).toBe(citation.href);
  });

  it("uses distilled PDF wording for an extension book page", () => {
    render(<KnowledgeCitations citations={[{ ...citation, book_id: "elliott-wave-natural-law", book_title: "自然法则", href: "/knowledge/books/elliott-wave-natural-law#page-8", pages: [8] }]} jobKnowledgeVersion="version-a" outputKnowledgeVersion="version-a" />);

    expect(screen.getByText(/蒸馏 PDF 第 8 页/)).toBeDefined();
  });

  it.each(["https://example.test/knowledge", "/knowledge/%2e%2e/private", "/knowledge/books/elliott-wave-natural-law#page-9"])("refuses unsafe or untrusted href %s", (href) => {
    render(<KnowledgeCitations citations={[{ ...citation, href }]} jobKnowledgeVersion="version-a" outputKnowledgeVersion="version-a" />);

    expect(screen.queryByRole("link", { name: "打开知识原文" })).toBeNull();
  });

  it("has no presentation for empty or legacy job output", () => {
    const { rerender } = render(<KnowledgeCitations citations={[]} />);
    expect(screen.queryByRole("heading", { name: "本次知识依据" })).toBeNull();
    rerender(<KnowledgeCitations citations={undefined} />);
    expect(screen.queryByRole("heading", { name: "本次知识依据" })).toBeNull();
  });

  it.each([
    [undefined, "version-a"],
    [null, "version-a"],
    ["", "version-a"],
    ["version-a", "version-b"],
  ])("does not trust structurally valid citations when job/output knowledge versions do not match", (jobKnowledgeVersion, outputKnowledgeVersion) => {
    render(<KnowledgeCitations citations={[citation]} jobKnowledgeVersion={jobKnowledgeVersion} outputKnowledgeVersion={outputKnowledgeVersion} />);

    expect(screen.queryByRole("heading", { name: "本次知识依据" })).toBeNull();
    expect(screen.queryByText(citation.book_title)).toBeNull();
    expect(screen.queryByText(citation.snippet)).toBeNull();
  });
});
