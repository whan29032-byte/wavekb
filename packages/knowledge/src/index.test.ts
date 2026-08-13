import { describe, expect, it } from "vitest";
import { childrenOf, getKnowledgePage, knowledgeData, searchKnowledge } from "./index";

describe("knowledge package", () => {
  it("preserves all verified pages with unique identifiers", () => {
    const pages = knowledgeData().pages;
    expect(pages).toHaveLength(161);
    expect(new Set(pages.map((page) => page.id)).size).toBe(161);
  });

  it("resolves the hierarchy and full page content", () => {
    const page = getKnowledgePage("unit-ewp-method-nominal-vs-real");
    expect(page?.sections.length).toBeGreaterThan(5);
    expect(childrenOf("full-methods").length).toBeGreaterThan(0);
  });

  it("finds a rule from its title or body", () => {
    expect(searchKnowledge("失效条件").length).toBeGreaterThan(0);
  });
});
