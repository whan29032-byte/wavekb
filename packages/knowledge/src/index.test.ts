import { describe, expect, it } from "vitest";
import { childrenOf, getKnowledgePage, knowledgeData, searchKnowledge } from "./index";

describe("knowledge package", () => {
  it("preserves all verified pages with unique identifiers", () => {
    const data = knowledgeData();
    const pages = data.pages;
    expect(data.schema_version).toBe(2);
    expect(pages).toHaveLength(161);
    expect(new Set(pages.map((page) => page.id)).size).toBe(161);
    expect(data.themes).toHaveLength(8);
    expect(data.questions).toHaveLength(18);
    expect(data.relations).toHaveLength(174);
  });

  it("resolves the hierarchy and full page content", () => {
    const page = getKnowledgePage("unit-ewp-method-nominal-vs-real");
    expect(page?.sections.length).toBeGreaterThan(5);
    expect(childrenOf("full-methods").length).toBeGreaterThan(0);
  });

  it("finds a rule from its title or body", () => {
    expect(searchKnowledge("失效条件").length).toBeGreaterThan(0);
    expect(searchKnowledge("第一章").length).toBeGreaterThan(0);
  });

  it("keeps primary and supplement images in separate fields", () => {
    const page = getKnowledgePage("unit-ewp-rule-impulse-core");
    expect(page?.primary_figures.every((asset) => asset.authority === "primary")).toBe(true);
    expect(page?.supplement_figures.every((asset) => asset.authority === "supplement")).toBe(true);
    expect(page?.source_images).toEqual([]);
    expect(page?.figures).toEqual([]);
  });
});
