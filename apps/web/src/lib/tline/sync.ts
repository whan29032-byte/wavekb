import { randomUUID } from "node:crypto";
import { TlineClient, TlineError, isRecord } from "./client.ts";
import type { TlineRecord } from "./client.ts";
import { ResearchStore } from "./store.ts";

export async function syncResearch(options: { path: string; client?: Pick<TlineClient, "institutions" | "researchPage">; now?: () => number }): Promise<{ status: "synced" | "locked" | "deferred"; count: number; lastSuccess: string | null }> {
  const now = options.now ?? Date.now;
  const started = now(), startedAt = new Date(started).toISOString(), deadline = started + 8 * 60000;
  const store = new ResearchStore(options.path), owner = randomUUID();
  let acquired = false;
  const guard = () => { if (now() >= deadline) throw new TlineError(504, "deadline_exceeded", "Research sync deadline exceeded"); };
  try {
    acquired = store.acquireLease(owner, started);
    const state = store.status();
    if (!acquired) return { status: "locked", count: 0, lastSuccess: state.lastSuccess };
    if (state.retryAt && Date.parse(state.retryAt) > now()) return { status: "deferred", count: 0, lastSuccess: state.lastSuccess };
    const client = options.client ?? new TlineClient({ deadline, now });
    const since = new Date(state.watermark ? Date.parse(state.watermark) - 10 * 60000 : started - 7 * 86400000).toISOString();
    guard(); const institutions = await client.institutions(); guard();
    const reports: TlineRecord[] = [], seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; ; page++) {
      guard();
      if (page >= 50) throw new TlineError(502, "page_limit", "Research page limit exceeded");
      const result = await client.researchPage(since, cursor); guard();
      if (!result || !Array.isArray(result.data) || !result.data.every(isRecord) || (result.nextCursor !== null && (typeof result.nextCursor !== "string" || !result.nextCursor || result.nextCursor.length > 2048))) throw new TlineError(502, "invalid_response", "Invalid research page");
      if (reports.length + result.data.length > 10000) throw new TlineError(502, "record_limit", "Research record limit exceeded");
      reports.push(...result.data);
      if (result.nextCursor === null) break;
      if (seen.has(result.nextCursor)) throw new TlineError(502, "repeated_cursor", "Research cursor repeated");
      seen.add(result.nextCursor); cursor = result.nextCursor;
    }
    guard(); const finishedAt = new Date(now()).toISOString();
    store.publish(institutions, reports, startedAt, finishedAt, owner, guard);
    return { status: "synced", count: new Set(reports.map((row) => row.id)).size, lastSuccess: finishedAt };
  } catch (error) {
    let code = "sync_failed", retryAt: string | null = null;
    if (error instanceof TlineError) {
      code = error.status === 401 ? "unauthorized" : error.status === 403 ? "forbidden" : error.status === 429 ? "rate_limited" : ["not_configured", "network_error", "invalid_response", "repeated_cursor", "page_limit", "record_limit", "deadline_exceeded"].includes(error.code) ? error.code : "sync_failed";
      if (error.status === 429 && Number.isFinite(error.retryAfterSeconds) && error.retryAfterSeconds! >= 0) {
        const retry = now() + error.retryAfterSeconds! * 1000;
        retryAt = new Date(Math.min(retry, 8640000000000000)).toISOString();
      }
    }
    if (acquired && store.ownsLease(owner, now())) store.failure(startedAt, code, retryAt);
    throw new TlineError(502, code, code === "deadline_exceeded" ? "Research sync deadline exceeded" : "Research sync failed");
  } finally { try { if (acquired) store.releaseLease(owner); } finally { store.close(); } }
}
