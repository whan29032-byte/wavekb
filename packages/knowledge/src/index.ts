import knowledgeJson from "./knowledge.json";

export type KnowledgeAsset = {
  id?: string;
  asset_path: string;
  source_id?: string;
  edition?: number;
  authority?: "primary" | "supplement";
  figure_type?: string;
  caption?: string;
  width: number;
  height: number;
  pdf_page?: number;
  book_pages?: number[];
  figure_nos?: string[];
};

export type KnowledgeSection = {
  title: string;
  paragraphs: string[];
  items: string[];
};

export type KnowledgePage = {
  id: string;
  title: string;
  kind: "core" | "candidate";
  order: number;
  parent: string | null;
  status: string;
  sections: KnowledgeSection[];
  figures: KnowledgeAsset[];
  primary_figures: KnowledgeAsset[];
  supplement_figures: KnowledgeAsset[];
  supplement_source_images: KnowledgeAsset[];
  source_images: KnowledgeAsset[];
  related_page_ids: string[];
  source_unit_ids: string[];
  generation_source: "canonical_units" | "markdown_candidate";
  source_authorities: Array<"primary" | "supplement">;
  unit_types: string[];
  source_refs: KnowledgeSourceRef[];
  search_terms: string[];
};

export type KnowledgeSourceRef = {
  unit_id: string;
  source_id: string;
  authority: "primary" | "supplement";
  chapter: string;
  section: string;
  pdf_pages: number[];
  figures: string[];
};

export type KnowledgeQuestion = {
  id: string;
  question: string;
  intent: string;
  required_unit_ids: string[];
  optional_unit_ids: string[];
  answer_order: string[];
  stop_conditions: string[];
  reasoning_route: Array<{
    stage: "rule_exclusion" | "guideline_ranking" | "evidence_confirmation" | "invalidation_management";
    unit_ids: string[];
    instruction: string;
  }>;
};

export type KnowledgeRelation = { source: string; target: string; type: string };
export type KnowledgeChapter = { id: string; unit_ids: string[] };
export type KnowledgeTheme = { id: string; title: string; unit_ids: string[]; children: KnowledgeTheme[] };

export type KnowledgeRoot = Pick<KnowledgePage, "id" | "title" | "kind" | "order" | "parent">;
export type KnowledgeData = {
  schema_version: number;
  pages: KnowledgePage[];
  roots: KnowledgeRoot[];
  themes: KnowledgeTheme[];
  chapters: KnowledgeChapter[];
  questions: KnowledgeQuestion[];
  relations: KnowledgeRelation[];
  summary: Record<string, unknown>;
};

const data = knowledgeJson as unknown as KnowledgeData;
const pageById = new Map(data.pages.map((page) => [page.id, page]));

export function knowledgeData(): KnowledgeData {
  return data;
}

export function getKnowledgePage(id: string): KnowledgePage | null {
  return pageById.get(id) ?? null;
}

export function childrenOf(parentId: string): KnowledgePage[] {
  return data.pages.filter((page) => page.parent === parentId).sort((a, b) => a.order - b.order);
}

export function searchKnowledge(query: string, limit = 30): KnowledgePage[] {
  const normalized = query.trim().toLocaleLowerCase("zh-CN");
  if (!normalized) return [];
  return data.pages
    .map((page) => {
      const title = page.title.toLocaleLowerCase("zh-CN");
      const body = [
        ...page.sections.flatMap((section) => [...section.paragraphs, ...section.items]),
        ...page.search_terms,
        ...page.source_refs.flatMap((source) => [source.chapter, source.section, source.source_id, ...source.figures]),
      ].join(" ").toLocaleLowerCase("zh-CN");
      const score = title === normalized ? 4 : title.includes(normalized) ? 3 : body.includes(normalized) ? 1 : 0;
      return { page, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.page.order - b.page.order)
    .slice(0, limit)
    .map((item) => item.page);
}
