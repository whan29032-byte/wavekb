import { describe, expect, it } from "vitest";
import { knowledgeData } from "@wavekb/knowledge";
import { knowledgeAssetSourceLabel, knowledgePageSourceLabels, sourceEditionLabel } from "./source-labels";

describe("actual source edition labels", () => {
  it("uses source identity rather than authority or preferred catalog role", () => {
    expect(knowledgeAssetSourceLabel({ asset_path: "test", width: 1, height: 1, source_id: "ewp-11-zh-2021", edition: 11, authority: "primary" })).toBe("第11版原书来源");
    expect(knowledgeAssetSourceLabel({ asset_path: "test", width: 1, height: 1, source_id: "ewp-10-zh-2016", edition: 10, authority: "supplement" })).toBe("第10版补充来源");
    expect(sourceEditionLabel("ewp-11-zh-2021", 10)).toBe("来源版次待核对");
    expect(sourceEditionLabel("unknown-source")).toBe("unknown-source");
  });

  it("preserves all actual eleventh-edition Unit source labels inside the old collection", () => {
    const units = knowledgeData().pages.filter((page) => page.id.startsWith("unit-") && page.source_refs[0]?.source_id === "ewp-11-zh-2021");
    expect(units).toHaveLength(36);
    for (const unit of units) expect(knowledgePageSourceLabels(unit)).toContain("第11版");
    expect(knowledgePageSourceLabels({ source_refs: [] })).toEqual([]);
  });
});
