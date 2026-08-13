import type { KnowledgeItem } from "./index.ts";

const TYPE_WEIGHT: Record<string, number> = {
  rule: 100,
  guide: 70,
  method: 50,
  case: 30,
  term: 20,
};
const AUTHORITY_WEIGHT: Record<string, number> = {
  primary: 40,
  supplement: 10,
};

export type KnowledgeContext = {
  task: string;
  items: KnowledgeItem[];
  totalCharacters: number;
  boundary: "UNTRUSTED_KNOWLEDGE";
};

export function retrieveKnowledge(
  index: KnowledgeItem[],
  task: string,
  query: string,
  characterBudget: number,
): KnowledgeContext {
  const tokens = query.toLowerCase().split(/[\s,，。;；:/]+/).filter(Boolean);
  const ranked = index.map((item) => {
    const matches = tokens.reduce(
      (score, token) => score + (item.searchable.includes(token) ? 20 + token.length : 0),
      0,
    );
    return {
      item,
      score: matches
        + (TYPE_WEIGHT[item.type] ?? 0)
        + (AUTHORITY_WEIGHT[item.authority] ?? 0)
        + (item.sourceId === "ewp-10-zh-2016" ? 20 : 0),
      matches,
    };
  })
    .filter((entry) => entry.matches > 0)
    .sort((a, b) => b.score - a.score || a.item.knowledgeId.localeCompare(b.item.knowledgeId));

  const selected: KnowledgeItem[] = [];
  let totalCharacters = 0;
  const seen = new Set<string>();
  for (const entry of ranked) {
    if (seen.has(entry.item.knowledgeId)) continue;
    const size = entry.item.text.length;
    if (totalCharacters + size > characterBudget) continue;
    seen.add(entry.item.knowledgeId);
    selected.push(entry.item);
    totalCharacters += size;
  }
  return { task, items: selected, totalCharacters, boundary: "UNTRUSTED_KNOWLEDGE" };
}
