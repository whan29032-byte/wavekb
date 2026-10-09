import { describe, expect, it } from "vitest";
import { getKnowledgePage } from "@wavekb/knowledge";
import { matchingSourceUnitPage } from "./source-unit-reference";

const unit = getKnowledgePage("unit-ewp-rule-zigzag")!;
const explanation = `${unit.title}（${unit.unit_types[0]}）\n原文解释`;

describe("exact canonical source-unit matching", () => {
  it("resolves an explanation only with its exact title, single type, and newline delimiter", () => {
    expect(matchingSourceUnitPage(explanation, "完整解释", [unit])).toBe(unit);
    for (const text of [explanation.replace(unit.title, `${unit.title}补充`), explanation.replace("RULE", "GUIDELINE"), explanation.replace("\n", " ")]) {
      expect(matchingSourceUnitPage(text, "完整解释", [unit])).toBeNull();
    }
    expect(matchingSourceUnitPage(explanation, "快速答案", [unit])).toBeNull();
    expect(matchingSourceUnitPage(explanation, "其他解释", [unit])).toBeNull();
  });

  it("keeps existing exact summary matching without guessing partial titles", () => {
    expect(matchingSourceUnitPage(`${unit.title}：摘要`, "快速答案", [unit])).toBe(unit);
    expect(matchingSourceUnitPage(`${unit.title}补充：摘要`, "快速答案", [unit])).toBeNull();
  });

  it("rejects ambiguous, multi-type, aggregate, and non-canonical sources", () => {
    expect(matchingSourceUnitPage(explanation, "完整解释", [unit, { ...unit }])).toBeNull();
    for (const altered of [
      { ...unit, unit_types: ["RULE", "GUIDELINE"] },
      { ...unit, id: "core-zigzag" },
      { ...unit, source_unit_ids: [...unit.source_unit_ids, "ewp-guide-zigzag"] },
      { ...unit, generation_source: "markdown_candidate" as const },
      { ...unit, kind: "candidate" as const },
    ]) expect(matchingSourceUnitPage(explanation, "完整解释", [altered])).toBeNull();
  });
});
