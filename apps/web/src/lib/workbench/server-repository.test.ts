import { beforeEach, describe, expect, it, vi } from "vitest";
import { listPrivateEntries, listWorkbenchAnalyses } from "./server-repository";
import { getMyPersonalSpaceSummary } from "@/lib/member/server-repository";

type Row = Record<string, unknown>;
const database = vi.hoisted(() => ({ rows: {} as Record<string, Row[]>, calls: [] as Array<{ table: string; head: boolean; count?: string; range?: number[]; filters: Array<[string, unknown]>; orders: string[] }>, failedTable: "" }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  rpc: async () => ({ data: { wallet: { balance: 42 } }, error: null }),
  from(table: string) {
    const call = { table, head: false, count: undefined as string | undefined, range: undefined as number[] | undefined, filters: [] as Array<[string, unknown]>, orders: [] as string[] };
    database.calls.push(call);
    let limit = 1000;
    const ascending = new Map<string, boolean>();
    const query = {
      select(_columns: string, options?: { count?: string; head?: boolean }) { call.head = Boolean(options?.head); call.count = options?.count; return query; },
      eq(field: string, value: unknown) { call.filters.push([field, value]); return query; },
      is(field: string, value: unknown) { call.filters.push([field, value]); return query; },
      order(field: string, options: { ascending: boolean }) { call.orders.push(field); ascending.set(field, options.ascending); return query; },
      limit(value: number) { limit = value; return query; },
      range(from: number, to: number) { call.range = [from, to]; return query; },
      then(resolve: (value: unknown) => unknown) {
        const filtered = (database.rows[table] || []).filter((row) => call.filters.every(([field, value]) => row[field] === value));
        filtered.sort((a, b) => { for (const field of call.orders) { const order = String(b[field]).localeCompare(String(a[field])) * (ascending.get(field) ? -1 : 1); if (order) return order; } return 0; });
        const start = call.range?.[0] || 0;
        const end = call.range ? call.range[1] + 1 : limit;
        return Promise.resolve(resolve({ data: call.head ? null : filtered.slice(start, end), count: call.count === "exact" ? filtered.length : null, error: database.failedTable === table ? new Error("database unavailable") : null }));
      },
    };
    return query;
  },
}) }));

beforeEach(() => { database.rows = {}; database.calls = []; database.failedTable = ""; });
const entries = (length: number, kind = "review", owner = "owner") => Array.from({ length }, (_, index) => ({ id: `${kind}-${String(index).padStart(4, "0")}`, owner_id: owner, kind, deleted_at: null, updated_at: "2026-09-01", title: `record ${index}` }));

describe("workbench server pagination", () => {
  it("reaches records beyond the old cap with bounded owner/type-filtered stable pages", async () => {
    database.rows.private_entries = [...entries(145), ...entries(30, "journal"), ...entries(40, "review", "other"), { ...entries(1)[0], id: "deleted", deleted_at: "2026-09-01" }];
    const result = await listPrivateEntries("owner", "review", 6);
    expect(result.items).toHaveLength(20);
    expect(result.items[0].id).toBe("review-0044");
    expect(result.items[19].id).toBe("review-0025");
    expect(result.hasNext).toBe(true);
    expect(database.calls[0]).toMatchObject({ range: [100, 120], orders: ["updated_at", "id"], filters: [["owner_id", "owner"], ["deleted_at", null], ["kind", "review"]] });
  });
  it("returns the final short page without a misleading next link", async () => {
    database.rows.private_entries = entries(45);
    const result = await listPrivateEntries("owner", undefined, 3);
    expect(result.items).toHaveLength(5); expect(result.hasNext).toBe(false);
  });
  it("paginates analyses past twenty using a deterministic owner-scoped query", async () => {
    database.rows.workbench_analyses = [...entries(43), ...entries(20, "review", "other")];
    const result = await listWorkbenchAnalyses("owner", 2);
    expect(result.items).toHaveLength(20); expect(result.items[0].id).toBe("review-0022"); expect(result.hasNext).toBe(true);
    expect(database.calls[0]).toMatchObject({ range: [20, 40], orders: ["updated_at", "id"], filters: [["owner_id", "owner"]] });
  });
  it("propagates database errors instead of claiming an empty list", async () => {
    database.failedTable = "private_entries";
    await expect(listPrivateEntries("owner", "review", 1)).rejects.toThrow("database unavailable");
  });
});

describe("personal space totals", () => {
  it("uses independent exact head counts without the API row cap", async () => {
    database.rows.private_entries = [...entries(1205), ...entries(1004, "journal"), ...entries(1003, "draft"), ...entries(50, "review", "other"), { ...entries(1)[0], deleted_at: "deleted" }];
    database.rows.workbench_analyses = [...entries(1201), ...entries(50, "review", "other")];
    expect(await getMyPersonalSpaceSummary("owner")).toEqual({ points: 42, reviews: 1205, journals: 1004, drafts: 1003, analyses: 1201 });
    expect(database.calls).toHaveLength(4);
    for (const call of database.calls) expect(call).toMatchObject({ count: "exact", head: true });
  });
});
