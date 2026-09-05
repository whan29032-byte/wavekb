import type { TlineRecord } from "./client";
import { researchView } from "./presentation";

type Query = Record<string, string | string[] | undefined>;
export function directoryQuery(query: Query) {
  const { q = "", institution = "", page = "1" } = query;
  if (typeof q !== "string" || q.length > 200 || typeof institution !== "string" || institution.length > 200 || typeof page !== "string" || !/^[1-9]\d{0,5}$/.test(page)) throw new Error("Invalid research filters");
  return { q: q.trim(), institution, page: Number(page) };
}

// Search only content fields, never IDs, source URLs or opaque metadata.
function searchable(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(searchable).join(" ");
  if (value && typeof value === "object") return Object.values(value).map(searchable).join(" ");
  return "";
}

export function researchDirectory(rows: TlineRecord[], institutions: TlineRecord[], query: ReturnType<typeof directoryQuery>) {
  const seen = new Set<string>();
  const terms = query.q.normalize("NFKC").toLocaleLowerCase("en").split(/\s+/).filter(Boolean);
  const all = rows.flatMap((row) => {
    const view = researchView(row, institutions);
    if (!view.id || seen.has(view.id)) return [];
    seen.add(view.id);
    return [{ row, view }];
  });
  const institutionOptions = [...new Map(all.filter(({ view }) => view.institutionSlug).map(({ view }) => [view.institutionSlug, { slug: view.institutionSlug, name: view.institution }])).values()].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  const matches = all.filter(({ row, view }) => {
    if (query.institution && query.institution !== view.institutionSlug) return false;
    const content = searchable([row.title, view.institution, row.analysis, row.assets, row.views]).normalize("NFKC").toLocaleLowerCase("en");
    return terms.every((term) => content.includes(term));
  });
  const pages = Math.max(1, Math.ceil(matches.length / 30));
  const page = Math.min(query.page, pages);
  return { items: matches.slice((page - 1) * 30, page * 30).map(({ view }) => view), total: matches.length, available: all.length, pages, page, institutionOptions };
}
