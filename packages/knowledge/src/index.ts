import knowledgeJson from "./knowledge.json";

export type KnowledgeAsset = {
  asset_path: string;
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
  source_images: KnowledgeAsset[];
  related_page_ids: string[];
  source_unit_ids: string[];
};

export type KnowledgeRoot = Pick<KnowledgePage, "id" | "title" | "kind" | "order" | "parent">;
export type KnowledgeData = {
  pages: KnowledgePage[];
  roots: KnowledgeRoot[];
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
      const body = page.sections.flatMap((section) => [...section.paragraphs, ...section.items]).join(" ").toLocaleLowerCase("zh-CN");
      const score = title === normalized ? 4 : title.includes(normalized) ? 3 : body.includes(normalized) ? 1 : 0;
      return { page, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.page.order - b.page.order)
    .slice(0, limit)
    .map((item) => item.page);
}
