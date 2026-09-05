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
    institutionSlug: text(institution.slug),
    assets: (Array.isArray(row.assets) ? row.assets : []).flatMap((value) => {
      const asset = object(value); const ticker = text(asset.ticker);
      return ticker ? [{ ticker, name: translated(asset.name), direction: typeof asset.direction === "number" && Number.isFinite(asset.direction) ? asset.direction : null }] : [];
    }),
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

type WindowQuery = Record<string, string | string[] | undefined>;
const DAY = 86_400_000;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/;

function parsedTimestamp(value: string): number {
  if (!value || value.length > 64 || !timestampPattern.test(value)) return Number.NaN;
  return Date.parse(value);
}

export function validateResearchWindow(query: WindowQuery): void {
  const { since, until, cursor } = query;
  if (Array.isArray(since) || Array.isArray(until) || Array.isArray(cursor) || cursor !== undefined || (!since && until !== undefined)) {
    throw new Error("时间窗口无效，请重新打开最近 7 天研报。");
  }
  if (since !== undefined && !Number.isFinite(parsedTimestamp(since))) throw new Error("时间窗口无效，请重新打开最近 7 天研报。");
  if (until !== undefined && !Number.isFinite(parsedTimestamp(until))) throw new Error("时间窗口无效，请重新打开最近 7 天研报。");
}

export function researchWindow(query: WindowQuery, lastSuccess: string | null, now = Date.now()) {
  validateResearchWindow(query);
  const success = lastSuccess === null ? now : parsedTimestamp(lastSuccess);
  if (!Number.isFinite(success)) throw new Error("时间窗口无效，请重新打开最近 7 天研报。");
  const anchor = Math.min(now, success);
  if (query.since === undefined) return { since: new Date(anchor - 7 * DAY).toISOString(), until: new Date(anchor).toISOString() };

  const since = parsedTimestamp(query.since as string);
  const until = query.until === undefined ? Math.min(since + 7 * DAY, anchor) : parsedTimestamp(query.until as string);
  const isLastGoodWindow = until === anchor && anchor < now - 8 * DAY;
  if (!Number.isFinite(until) || since >= until || until - since > 7 * DAY || until > now || (until < now - 8 * DAY && !isLastGoodWindow)) {
    throw new Error("时间窗口已过期或无效，请重新打开最近 7 天研报。");
  }
  return { since: new Date(since).toISOString(), until: new Date(until).toISOString() };
}
