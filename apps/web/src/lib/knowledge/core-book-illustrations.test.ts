import { describe, expect, it } from "vitest";
import { getKnowledgePage, type KnowledgeAsset } from "@wavekb/knowledge";
import { coreBookExplanations, coreBookFigureCaption, isPrimaryTenthEditionExcerpt } from "./core-book-illustrations";

const unit = getKnowledgePage("unit-ewp-guide-zigzag")!;
const rule = getKnowledgePage("unit-ewp-rule-zigzag")!;
const excerpt = unit.primary_figures[0];
const textFor = (page: typeof unit) => `${page.title}（${page.unit_types[0]}）\n解释正文`;

describe("core full-book illustration plan", () => {
  it("accepts only all four explicit tenth-edition primary original-excerpt qualifiers", () => {
    expect(isPrimaryTenthEditionExcerpt(excerpt)).toBe(true);
    const rejected: KnowledgeAsset[] = [
      { ...excerpt, source_id: "ewp-11-zh-2021" },
      { ...excerpt, edition: 11 },
      { ...excerpt, authority: "supplement" },
      { ...excerpt, figure_type: "source_page" },
      { ...excerpt, source_id: undefined },
      { ...excerpt, edition: undefined },
      { ...excerpt, authority: undefined },
      { ...excerpt, figure_type: undefined },
    ];
    expect(rejected.every((asset) => !isPrimaryTenthEditionExcerpt(asset))).toBe(true);
    const plan = coreBookExplanations([textFor(unit)], [{ ...unit, primary_figures: [...rejected, excerpt], supplement_figures: [excerpt] }]);
    expect(plan[0].figures.map((figure) => figure.asset)).toEqual([excerpt]);
  });

  it("never borrows figures from similar titles or from a mismatched type", () => {
    const text = [textFor(unit).replace("GUIDELINE", "RULE"), `${unit.title}补充（GUIDELINE）\n解释正文`, "未知单元（RULE）\n正文"];
    const plan = coreBookExplanations(text, [unit]);
    expect(plan.map((item) => item.text)).toEqual(text);
    expect(plan.every((item) => item.unit === null && item.figures.length === 0)).toBe(true);
  });

  it("preserves all 117 explanations and displays each shared original page only at its first related Unit", () => {
    const fullBook = getKnowledgePage("core-full-book")!;
    const paragraphs = fullBook.sections.find((section) => section.title === "完整解释")!.paragraphs;
    const units = fullBook.source_unit_ids.map((id) => getKnowledgePage(`unit-${id}`)!);
    const plan = coreBookExplanations(paragraphs, units);
    expect(plan).toHaveLength(117);
    expect(plan.map((item) => item.text)).toEqual(paragraphs);
    expect(plan.map((item) => item.unit?.id)).toEqual(units.map((item) => item.id));
    const all = plan.flatMap((item) => item.figures);
    const first = all.filter((figure) => figure.firstOccurrence);
    expect(first.length).toBeGreaterThan(20);
    expect(new Set(first.map((figure) => figure.asset.asset_path)).size).toBe(first.length);
    expect(new Set(first.map((figure) => figure.anchorId)).size).toBe(first.length);
    expect(all.every((figure) => isPrimaryTenthEditionExcerpt(figure.asset))).toBe(true);
    for (const repeat of all.filter((figure) => !figure.firstOccurrence)) {
      expect(first.find((figure) => figure.asset.asset_path === repeat.asset.asset_path)?.anchorId).toBe(repeat.anchorId);
    }
  });

  it("deduplicates within a Unit and links a later related Unit to the same original-page anchor", () => {
    const plan = coreBookExplanations([textFor(unit), textFor(rule)], [
      { ...unit, primary_figures: [excerpt, excerpt] },
      { ...rule, primary_figures: [excerpt] },
    ]);
    expect(plan[0].figures).toHaveLength(1);
    expect(plan[0].figures[0]).toMatchObject({ firstOccurrence: true, firstUnitTitle: unit.title });
    expect(plan[1].figures).toHaveLength(1);
    expect(plan[1].figures[0]).toMatchObject({ firstOccurrence: false, firstUnitTitle: unit.title, anchorId: plan[0].figures[0].anchorId });
  });

  it("labels the actual original PDF page as an excerpt instead of claiming an exact standalone figure match", () => {
    expect(coreBookFigureCaption({ ...excerpt, caption: "图1-14与斜纹浪导入", pdf_page: 43, book_pages: [] })).toBe("第10版原页摘录（补充资料） · 图1-14与斜纹浪导入 · PDF 第 43 页");
  });
});
