import type { KnowledgePage } from "@wavekb/knowledge";

/** Resolve a declared canonical Unit, never a similar title or inferred topic. */
export function matchingSourceUnitPage(text: string, sectionTitle: string, pages: KnowledgePage[]): KnowledgePage | null {
  const matches = pages.filter((page) => page.kind === "core"
    && page.generation_source === "canonical_units"
    && page.source_unit_ids.length === 1
    && page.id === `unit-${page.source_unit_ids[0]}`
    && (sectionTitle === "快速答案"
      ? text.startsWith(`${page.title}：`)
      : sectionTitle === "完整解释" && page.unit_types.length === 1
        && text.startsWith(`${page.title}（${page.unit_types[0]}）\n`)));
  return matches.length === 1 ? matches[0] : null;
}
