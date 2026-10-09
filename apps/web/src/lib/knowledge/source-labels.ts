import type { KnowledgeAsset, KnowledgePage } from "@wavekb/knowledge";

const sourceEditions: Record<string, number> = { "ewp-10-zh-2016": 10, "ewp-11-zh-2021": 11 };

// Reading preference is not source authority: edition must come from the actual source.
export function sourceEditionLabel(sourceId?: string, edition?: number) {
  const actualEdition = sourceId ? sourceEditions[sourceId] : undefined;
  if (actualEdition && edition && actualEdition !== edition) return "来源版次待核对";
  const value = actualEdition || edition;
  return value ? `第${value}版` : sourceId || "来源待核对";
}

export function knowledgePageSourceLabels(page: Pick<KnowledgePage, "source_refs">) {
  return [...new Set(page.source_refs.map((source) => sourceEditionLabel(source.source_id)))].sort((left, right) => left === "第11版" ? -1 : right === "第11版" ? 1 : left.localeCompare(right));
}

export function knowledgeAssetSourceLabel(asset: KnowledgeAsset) {
  const label = sourceEditionLabel(asset.source_id, asset.edition);
  return label === "第10版" ? `${label}补充来源` : label === "第11版" ? `${label}原书来源` : label;
}
