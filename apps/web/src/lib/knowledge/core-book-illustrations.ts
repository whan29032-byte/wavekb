import type { KnowledgeAsset, KnowledgePage } from "@wavekb/knowledge";
import { matchingSourceUnitPage } from "./source-unit-reference";

export type CoreBookFigure = {
  asset: KnowledgeAsset;
  anchorId: string;
  firstOccurrence: boolean;
  firstUnitTitle: string;
};

export type CoreBookExplanation = {
  text: string;
  unit: KnowledgePage | null;
  figures: CoreBookFigure[];
};

export function isPrimaryTenthEditionExcerpt(asset: KnowledgeAsset) {
  return asset.source_id === "ewp-10-zh-2016"
    && asset.edition === 10
    && asset.authority === "primary"
    && asset.figure_type === "original_source_excerpt";
}

/** Keep all explanations in source order; show each verified original page once. */
export function coreBookExplanations(paragraphs: string[], sourceUnitPages: KnowledgePage[]): CoreBookExplanation[] {
  const seen = new Map<string, { anchorId: string; firstUnitTitle: string }>();
  return paragraphs.map((text) => {
    const unit = matchingSourceUnitPage(text, "完整解释", sourceUnitPages);
    const assets = unit ? [...new Map(unit.primary_figures.filter(isPrimaryTenthEditionExcerpt)
      .map((asset) => [asset.asset_path, asset])).values()] : [];
    const figures = assets.map((asset) => {
      const previous = seen.get(asset.asset_path);
      if (previous) return { asset, ...previous, firstOccurrence: false };
      const first = { anchorId: `core-book-figure-${seen.size + 1}`, firstUnitTitle: unit!.title };
      seen.set(asset.asset_path, first);
      return { asset, ...first, firstOccurrence: true };
    });
    return { text, unit, figures };
  });
}

export function coreBookFigureCaption(asset: KnowledgeAsset) {
  return [
    "第10版原页摘录（补充资料）",
    asset.caption,
    asset.book_pages?.length ? `原书页 ${asset.book_pages.join("、")}` : "",
    asset.pdf_page ? `PDF 第 ${asset.pdf_page} 页` : "",
  ].filter(Boolean).join(" · ");
}
