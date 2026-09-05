import { beforeEach, expect, it, vi } from "vitest";
import { listPosts, listPostsByAuthor, listPostComments, getPost } from "./server-repository";

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({ rows: {} as Record<string, Row[]>, calls: [] as Array<{ table: string; select: string; count?: string; filters: Array<[string, unknown]>; orders: Array<[string, boolean]>; range?: number[] }>, fail: false, legacyIdentity: false }));
vi.mock("@/lib/env", () => ({ publicSupabaseConfig: () => ({ configured: true }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  rpc: async (name: string, args: Record<string, unknown>) => {
    const basic = { id: "author", public_uid: 12345, display_name: "作者", avatar_url: null };
    if (!db.legacyIdentity) return { data: [{ ...basic, nameplate_style: "classic" }], error: null };
    if (name === "get_public_post_profiles") return { data: null, error: { code: "PGRST202" } };
    if (name === "get_public_profiles") return { data: [basic], error: null };
    if (name === "search_profile_by_uid" && args.p_uid === 12345) return { data: [{ ...basic, nameplate_style: "blackgold", role: "member", display_title: "研究者" }], error: null };
    throw new Error("Unexpected identity query");
  },
  from(table: string) {
    const call = { table, select: "", count: undefined as string | undefined, filters: [] as Array<[string, unknown]>, orders: [] as Array<[string, boolean]>, range: undefined as number[] | undefined };
    db.calls.push(call); let limit = 1000; let single = false;
    const query = {
      select(columns: string, options?: { count?: string }) { call.select = columns; call.count = options?.count; return query; },
      eq(field: string, value: unknown) { call.filters.push([field, value]); return query; },
      order(field: string, options: { ascending: boolean }) { call.orders.push([field, options.ascending]); return query; },
      limit(size: number) { limit = size; return query; },
      range(from: number, to: number) { call.range = [from, to]; return query; },
      maybeSingle() { single = true; return query; },
      then(resolve: (value: unknown) => unknown) {
        const filtered = (db.rows[table] ?? []).filter((row) => call.filters.every(([field, value]) => row[field] === value));
        filtered.sort((a, b) => { for (const [field, ascending] of call.orders) { const cmp = String(a[field]).localeCompare(String(b[field])); if (cmp) return ascending ? cmp : -cmp; } return 0; });
        const rows = filtered.slice(call.range?.[0] ?? 0, call.range ? call.range[1] + 1 : limit).map((row) => {
          const copy = { ...row };
          if (!call.select.includes("chart_package")) delete copy.chart_package;
          if (!call.select.includes("research_timeline_nodes")) delete copy.research_timeline_nodes;
          return copy;
        });
        return Promise.resolve(resolve({ data: single ? rows[0] ?? null : rows, count: call.count === "exact" ? filtered.length : null, error: db.fail ? new Error("database unavailable") : null }));
      },
    }; return query;
  },
}) }));
const posts = (count: number, author = "author", board = "idea_sharing") => Array.from({ length: count }, (_, n) => ({ id: `post-${String(n).padStart(4, "0")}`, author_id: author, board, status: "published", created_at: "2026-09-01", body: "body", post_images: [], chart_package: { large: "chart-payload" }, research_timeline_nodes: [{ id: "timeline", author_id: "author", created_at: "2026-09-01", body: "timeline-payload" }] }));
beforeEach(() => { db.rows = {}; db.calls = []; db.fail = false; db.legacyIdentity = false; });

it("preserves equipped identity on post cards, timeline nodes and comments with the deployed legacy RPCs", async () => {
  db.legacyIdentity = true;
  db.rows.posts = posts(1);
  db.rows.post_comments = [{ id: "comment", post_id: "post-0000", author_id: "author", status: "visible", body: "comment", created_at: "2026-09-01" }];
  expect((await listPosts("idea_sharing"))[0].profiles?.nameplate_style).toBe("blackgold");
  expect((await getPost("post-0000"))?.timeline_nodes[0].profiles?.nameplate_style).toBe("blackgold");
  expect((await listPostComments("post-0000"))[0].profiles?.nameplate_style).toBe("blackgold");
});

it("pages published board posts beyond the old cap with stable ties and a sentinel", async () => {
  db.rows.posts = [...posts(65), ...posts(20, "other", "question_answers"), { ...posts(1)[0], id: "hidden", status: "hidden" }];
  const result = await listPosts("idea_sharing", 20, 2);
  expect(result.items).toHaveLength(20); expect(result.items[0].id).toBe("post-0044"); expect(result.items.at(-1)?.id).toBe("post-0025"); expect(result.hasNext).toBe(true);
  expect(db.calls[0]).toMatchObject({ range: [20, 40], filters: [["board", "idea_sharing"], ["status", "published"]], orders: [["created_at", false], ["id", false]] });
  expect(result.items[0].chart_package).toBeNull(); expect(result.items[0].timeline_nodes).toEqual([]);
});

it("returns exact published-author total rather than the current page length", async () => {
  db.rows.posts = [...posts(1205), ...posts(30, "other"), { ...posts(1)[0], id: "draft", status: "draft" }];
  const result = await listPostsByAuthor("author", 16, 76);
  expect(result.items).toHaveLength(5); expect(result.items[0].id).toBe("post-0004"); expect(result.hasNext).toBe(false); expect(result.total).toBe(1205);
  expect(db.calls[0]).toMatchObject({ count: "exact", range: [1200, 1216], filters: [["author_id", "author"], ["status", "published"]] });
});

it("counts an author's participating boards across all published pages", async () => {
  db.rows.posts = [...posts(50), { ...posts(1)[0], id: "older", board: "question_answers" }];
  const result = await listPostsByAuthor("author", 16, 1);
  expect(result.boardCount).toBe(2); expect(result.total).toBe(51);
});

it("reaches comments after two hundred while preserving visible-only chronology", async () => {
  db.rows.post_comments = Array.from({ length: 251 }, (_, n) => ({ id: `comment-${String(n).padStart(4, "0")}`, post_id: "post", author_id: "author", status: "visible", body: "comment", created_at: "2026-09-01" }));
  db.rows.post_comments.push({ id: "hidden", post_id: "post", author_id: "author", status: "hidden" });
  const result = await listPostComments("post", 5);
  expect(result.items).toHaveLength(50); expect(result.items[0].id).toBe("comment-0200"); expect(result.hasNext).toBe(true);
  expect(db.calls[0]).toMatchObject({ range: [200, 250], filters: [["post_id", "post"], ["status", "visible"]], orders: [["created_at", true], ["id", true]] });
});

it("keeps legacy array callers compatible and details retain chart/timeline payloads", async () => {
  db.rows.posts = posts(25);
  expect(await listPosts("idea_sharing")).toHaveLength(20);
  const post = await getPost("post-0000");
  expect(post?.chart_package).toEqual({ large: "chart-payload" }); expect(post?.timeline_nodes[0].body).toBe("timeline-payload");
});

it("reports query failures rather than an empty published page", async () => {
  db.fail = true;
  await expect(listPosts("idea_sharing", 20, 1)).rejects.toThrow("database unavailable");
});
