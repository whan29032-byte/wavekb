import { readFileSync } from "node:fs";

export type KnowledgeType = "rule" | "guide" | "method" | "case" | "term";

export type KnowledgeItem = {
  knowledgeId: string;
  title: string;
  type: KnowledgeType;
  sourceId: string;
  authority: string;
  pdfPages: number[];
  text: string;
  searchable: string;
};

const UNIT_TYPE_TO_KNOWLEDGE_TYPE: Record<string, KnowledgeType> = {
  RULE: "rule",
  GUIDELINE: "guide",
  METHOD: "method",
  CONFIRMATION: "method",
  HISTORICAL_CASE: "case",
  DEFINITION: "term",
  TERMINOLOGY: "term",
  CHARACTERISTIC: "term",
  THEORY_BOUNDARY: "term",
};

function normalizeKnowledgeType(type: unknown): KnowledgeType {
  if (typeof type !== "string") return "term";
  return UNIT_TYPE_TO_KNOWLEDGE_TYPE[type]
    ?? UNIT_TYPE_TO_KNOWLEDGE_TYPE[type.toUpperCase()]
    ?? "term";
}

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
      type: normalizeKnowledgeType(unit.type),
      sourceId: unit.source?.source_id ?? "unknown",
      authority: unit.source?.authority ?? "unknown",
      pdfPages: unit.source?.pdf_pages ?? [],
      text: fields.join("；"),
      searchable: fields.join(" ").toLowerCase(),
    };
  });
}
