import { readFileSync } from "node:fs";

export type KnowledgeItem = {
  knowledgeId: string;
  title: string;
  type: string;
  sourceId: string;
  authority: string;
  pdfPages: number[];
  text: string;
  searchable: string;
};

export function buildKnowledgeIndex(path: string): KnowledgeItem[] {
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
  return lines.map((line) => {
    const unit = JSON.parse(line);
    const fields = [
      unit.title,
      unit.statement,
      ...(unit.conditions ?? []),
      ...(unit.invalidations ?? []),
      ...(unit.exceptions ?? []),
      ...(unit.action ?? []),
    ].filter(Boolean);
    return {
      knowledgeId: unit.id,
      title: unit.title,
      type: unit.type,
      sourceId: unit.source?.source_id ?? "unknown",
      authority: unit.source?.authority ?? "unknown",
      pdfPages: unit.source?.pdf_pages ?? [],
      text: fields.join("；"),
      searchable: fields.join(" ").toLowerCase(),
    };
  });
}
