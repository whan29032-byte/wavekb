import "server-only";
import { TlineClient, TlineError } from "./client";

// Share identical reads for one minute, with a bounded cache. This is not a
// database sync and never advances a persisted watermark after a partial page.
const entries = new Map<string, { until: number; pending: boolean; value: Promise<unknown> }>();
let credential = "";
let active = 0;
function cached<T>(id: string, read: () => Promise<T>): Promise<T> {
  const key = process.env.TLINE_API_KEY?.trim() ?? "";
  if (credential !== key) { entries.clear(); credential = key; }
  const now = Date.now();
  const existing = entries.get(id);
  if (existing && (existing.pending || existing.until > now)) return existing.value as Promise<T>;
  for (const [name, value] of entries) if (!value.pending && value.until <= now) entries.delete(name);
  if (active >= 4) throw new TlineError(429, "busy", "Research requests are busy; retry later", 5);
  if (entries.size >= 32) {
    const settled = [...entries].find(([, value]) => !value.pending);
    if (settled) entries.delete(settled[0]);
  }
  active++;
  let request: Promise<T>;
  try { request = read(); } catch (error) { active--; throw error; }
  const value = request.then((result) => {
    const entry = entries.get(id);
    if (entry?.value === value) { entry.pending = false; entry.until = Date.now() + 60_000; }
    return result;
  }).catch((error: unknown) => { if (entries.get(id)?.value === value) entries.delete(id); throw error; }).finally(() => { active--; });
  entries.set(id, { until: now + 60_000, pending: true, value });
  return value;
}
export function readInstitutions() {
  return cached("institutions", () => new TlineClient().institutions());
}
export async function readResearchPage(since: string, cursor?: string) {
  const institutions = await readInstitutions();
  const page = await cached(JSON.stringify(["research", since, cursor]), () => new TlineClient().researchPage(since, cursor));
  if (page.nextCursor && page.nextCursor === cursor) throw new Error("Tline repeated a cursor");
  return { institutions, ...page };
}
export async function readResearch(id: string) {
  const institutions = await readInstitutions();
  const data = await cached(JSON.stringify(["detail", id]), () => new TlineClient().research(id));
  return { institutions, data };
}
