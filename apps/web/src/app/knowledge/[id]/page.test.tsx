import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { getKnowledgePage } from "@wavekb/knowledge";
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
      expect(within(section).getAllByRole("link")).toHaveLength(page.source_unit_ids.length);
    }
    fireEvent.click(screen.getByText("查看本页知识目录（117）"));
    const directory = screen.getByRole("navigation", { name: "本页知识目录" });
    expect(within(directory).getAllByRole("link")).toHaveLength(117);
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
