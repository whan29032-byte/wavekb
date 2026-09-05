import type { TlineRecord } from "./client";
const object = (value: unknown): TlineRecord => value && typeof value === "object" && !Array.isArray(value) ? value as TlineRecord : {};
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const translated = (value: unknown): string => text(value) || text(object(value).zh) || text(object(value).en);
function translatedArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const languages = object(value);
  return Array.isArray(languages.zh) && languages.zh.length ? languages.zh : Array.isArray(languages.en) ? languages.en : [];
}
export function researchView(row: TlineRecord, institutions: TlineRecord[]) {
  const institution = object(row.institution);
  const known = institutions.find((item) => item.slug === institution.slug);
  const analysis = object(row.analysis);
  const rawDate = text(row.publishedAt);
  let sourceUrl: string | null = null;
  try { const url = new URL(text(row.sourceUrl)); if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) sourceUrl = url.href; } catch { /* Invalid upstream link is not rendered. */ }
  return {
    id: text(row.id), title: translated(row.title) || "未提供标题",
    institution: text(institution.name) || text(known?.name) || "未提供机构",
    date: rawDate && Number.isFinite(Date.parse(rawDate)) ? new Date(rawDate).toISOString() : null,
    summary: translated(analysis.summary), interpretation: translated(analysis.interpretation),
    arguments: translatedArray(analysis.keyArguments).map(translated).filter(Boolean),
    risks: translatedArray(analysis.risks).map(translated).filter(Boolean),
    numbers: translatedArray(analysis.keyNumbers).flatMap((item) => {
      const number = object(item); const label = translated(number.label); const value = text(number.value);
      return label && value ? [{ label, value }] : [];
    }), sourceUrl,
  };
}
export type ResearchView = ReturnType<typeof researchView>;

export function researchWindow(query: Record<string, string | string[] | undefined>, now = Date.now()) {
  const { since, cursor } = query;
  if (Array.isArray(since) || Array.isArray(cursor) || (cursor !== undefined && (!cursor || cursor.length > 2048 || !since))) throw new Error("分页参数无效，请重新打开最近 7 天研报。");
  const start = since ?? new Date(Math.floor(now / 60000) * 60000 - 7 * 86400000).toISOString();
  const time = Date.parse(start);
  // One day of tolerance lets a reader continue a fixed seven-day window later.
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(start) || !Number.isFinite(time) || time < now - 8 * 86400000 || time > now) throw new Error("时间窗口已过期或无效，请重新打开最近 7 天研报。");
  return { since: start, cursor };
}
