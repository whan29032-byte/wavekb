import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { getKnowledgePage } from "@wavekb/knowledge";
import { coreBookExplanations } from "@/lib/knowledge/core-book-illustrations";
import KnowledgeDetailPage from "./page";

afterEach(cleanup);

describe("knowledge detail body navigation", () => {
  it.each([
    ["unit-ewp-method-nominal-vs-real", "unit-ewp-method-scale"],
    ["unit-ewp-guide-extension", "unit-ewp-guide-commodity-fifth-extension"],
    ["unit-ewp-rule-impulse-core", "unit-ewp-glossary-283"],
  ])("provides a real body-section link for %s, not only a separate sidebar link", async (id, targetId) => {
    render(await KnowledgeDetailPage({ params: Promise.resolve({ id }) }));
    const bodySection = screen.getByRole("region", { name: "相关知识" });
    const target = getKnowledgePage(targetId)!;
    const link = within(bodySection).getByRole("link", { name: target.title });
    expect(link.getAttribute("href")).toBe(`/knowledge/${targetId}`);
    expect(link.textContent).toBe(target.title);
    expect(bodySection.textContent).not.toContain(targetId.slice(5));
  });

  it("makes all 117 full-book summary and explanation titles actionable and retains the full directory", async () => {
    const page = getKnowledgePage("core-full-book")!;
    render(await KnowledgeDetailPage({ params: Promise.resolve({ id: page.id }) }));
    for (const sectionTitle of ["快速答案", "完整解释"]) {
      const section = screen.getByRole("region", { name: sectionTitle });
      const unitTitleLinks = within(section).getAllByRole("link").filter((link) => link.getAttribute("href")?.startsWith("/knowledge/unit-"));
      expect(unitTitleLinks).toHaveLength(page.source_unit_ids.length);
      expect(unitTitleLinks.map((link) => link.getAttribute("href"))).toEqual(page.source_unit_ids.map((id) => `/knowledge/unit-${id}`));
    }
    fireEvent.click(screen.getByText("查看本页知识目录（117）"));
    const directory = screen.getByRole("navigation", { name: "本页知识目录" });
    expect(within(directory).getAllByRole("link")).toHaveLength(117);
  });

  it("places deduplicated tenth-edition excerpts beside their exact full-book explanations, never in the quick summary", async () => {
    const page = getKnowledgePage("core-full-book")!;
    const paragraphs = page.sections.find((section) => section.title === "完整解释")!.paragraphs;
    const units = page.source_unit_ids.map((id) => getKnowledgePage(`unit-${id}`)!);
    const plan = coreBookExplanations(paragraphs, units);
    render(await KnowledgeDetailPage({ params: Promise.resolve({ id: page.id }) }));
    const summary = screen.getByRole("region", { name: "快速答案" });
    expect(summary.querySelector("img")).toBeNull();
    const explanations = screen.getByRole("region", { name: "完整解释" });
    expect(explanations.querySelectorAll("[data-reading-explanation]")).toHaveLength(117);
    for (const item of plan) {
      const block = explanations.querySelector(`[data-source-unit-id="${item.unit!.id}"]`)!;
      expect(block.querySelector(":scope > p")?.textContent).toBe(item.text);
      expect(block.querySelectorAll("img")).toHaveLength(item.figures.filter((figure) => figure.firstOccurrence).length);
      expect(block.querySelectorAll("[data-core-book-figure-reference]")).toHaveLength(item.figures.filter((figure) => !figure.firstOccurrence).length);
      for (const link of block.querySelectorAll<HTMLAnchorElement>("[data-core-book-figure-reference]")) {
        const target = document.getElementById(link.getAttribute("href")!.slice(1))!;
        expect(target.dataset.coreBookFigure).toBe(link.dataset.coreBookFigureReference);
        expect(target.querySelector("img")).not.toBeNull();
      }
    }
    expect(explanations.querySelector('[data-authority="supplement"]')).toBeNull();
    expect(screen.queryByRole("region", { name: "第11版原书图示" })).toBeNull();
  });

  it("does not inject full-book illustration references into other aggregate knowledge views", async () => {
    const { container } = render(await KnowledgeDetailPage({ params: Promise.resolve({ id: "core-zigzag" }) }));
    expect(container.querySelector("[data-reading-explanation]")).toBeNull();
    expect(container.querySelector("[data-core-book-figure-reference]")).toBeNull();
    expect(container.querySelector("[data-core-book-figure]")).toBeNull();
  });

  it("shows the first eight related pages and expands all remaining public targets", async () => {
    const page = getKnowledgePage("unit-ewp-method-multiple-counts")!;
    const expected = page.related_page_ids.map(getKnowledgePage).filter((item) => item !== null);
    render(await KnowledgeDetailPage({ params: Promise.resolve({ id: page.id }) }));
    const sidebar = screen.getByRole("navigation", { name: "相关知识" });
    const remainder = sidebar.querySelector("details")!;
    expect(remainder.open).toBe(false);
    expect(within(sidebar).getAllByRole("link").filter((link) => !remainder.contains(link))).toHaveLength(8);
    fireEvent.click(within(sidebar).getByText(`展开全部关联（另 ${expected.length - 8} 条）`));
    expect(remainder.open).toBe(true);
    const allLinks = within(sidebar).getAllByRole("link");
    expect(allLinks).toHaveLength(expected.length);
    expect(allLinks.map((link) => link.getAttribute("href"))).toEqual(expected.map((target) => `/knowledge/${target.id}`));
    expect(within(sidebar).getByRole("link", { name: getKnowledgePage("unit-ewp-method-objective-invalidation")!.title })).toBeDefined();
  });

  it("does not expose hidden case pages when rendering candidate related navigation", async () => {
    render(await KnowledgeDetailPage({ params: Promise.resolve({ id: "candidate-framework-zigzag" }) }));
    const links = screen.getAllByRole("link", { hidden: true });
    expect(links.some((link) => link.getAttribute("href") === "/knowledge/candidate-framework-case-btc-zc")).toBe(false);
    expect(links.some((link) => link.getAttribute("href") === "/knowledge/candidate-framework-case-xiaomi-alternatives")).toBe(false);
  });
});
