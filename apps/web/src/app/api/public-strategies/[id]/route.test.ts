// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicStrategySnapshot } from "@wavekb/domain/trading-review";
import { publicStrategyForPost } from "@/lib/community/public-strategy";
import { GET } from "./route";

const fetchMock = vi.fn();
const id = "11111111-1111-4111-8111-111111111111";
const postId = "22222222-2222-4222-8222-222222222222";
const digest = "a".repeat(64);
const etag = `"${digest}"`;
const from = "2026-11-26T00:00:00.000Z";
const to = "2026-11-26T01:00:00.000Z";
const markerKey = "b".repeat(32);
const payload = {
  id, post_id: postId, projection_digest: digest,
  projection: {
    schema_version: "wavekb-public-strategy-snapshot-v1",
    renderer_schema_version: "wavekb-public-trade-chart-v1",
    calculation_engine_version: "openalgo-charts-2.7.5",
    provider: "binance", product: "usdt_perpetual", symbol: "BTC/USDT", direction: "long",
    timeframe: "1h", price_type: "trade", range: { from, to }, snapshot_status: "closed",
    candles: [{ series_basis: "trade", open_time: from, close_time: to, open: "20", high: "25", low: "20", close: "25", volume: "100", status: "final", gap_before: false, gap_after: false }],
    markers: [{ marker_key: markerKey, occurred_at: from, price: "20", allocation_role: "open", side: "buy", position_side: "long", liquidity: "maker" }],
    public_annotations: [{ marker_key: markerKey, body: "公开注记", tags: ["纪律"] }],
    indicators: [{ id: "c".repeat(32), indicator_id: "ema", settings: { length: 14 }, series: [{ points: [{ time: from, value: null }] }] }],
    drawings: [{ id: "d".repeat(32), tool: "text", points: [{ time: Date.parse(from) / 1_000, price: 20 }], style: {}, text: { value: "公开图文" }, paneIndex: 0, zIndex: 0, locked: true, visible: true }],
    coverage: { status: "complete", source: "public_api", fetched_at: to, gaps: [] },
    show_quantity: false, show_absolute_pnl: false, price_return_rate: "25", price_return_label: "价格收益率", warnings: [],
  },
} satisfies PublicStrategySnapshot;

function request(snapshotId = id, headers: HeadersInit = {}, query = "") {
  return GET(new Request(`https://wavekb.com/api/public-strategies/${snapshotId}${query}`, { headers }), {
    params: Promise.resolve({ id: snapshotId }),
  });
}

function gatewayJson(body: object) {
  return Response.json(body, { headers: { etag, "set-cookie": "hidden=upstream-private", "cache-control": "public, max-age=31536000, immutable" } });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("AUTH_GATEWAY_INTERNAL_URL", "http://127.0.0.1:8787");
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("public strategy snapshot proxy", () => {
  it("binds a guest strategy embed to that exact published community post", async () => {
    const chart_package = { provider: "wavekb-trade-snapshot", snapshot_id: id };
    const published = { id: postId, status: "published" as const, chart_package };
    fetchMock.mockResolvedValue(gatewayJson(payload));
    expect(await publicStrategyForPost(published, fetchMock)).toEqual(payload);
    expect(await publicStrategyForPost({ ...published, id }, fetchMock)).toBeNull();
    expect(await publicStrategyForPost({ ...published, status: "hidden" }, fetchMock)).toBeNull();
    expect(await publicStrategyForPost({ ...published, chart_package: { provider: "tradingview", snapshot_id: id } }, fetchMock)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("returns the public DTO and revalidation headers without forwarding credentials", async () => {
    fetchMock.mockResolvedValue(gatewayJson(payload));
    const response = await request(id, { cookie: "hidden=session", authorization: "Bearer hidden-token", "if-none-match": `"${"f".repeat(64)}"` });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://127.0.0.1:8787/v1/public/strategy-snapshots/${id}`);
    expect(init).toMatchObject({ method: "GET", cache: "no-store", credentials: "omit", redirect: "error" });
    expect(new Headers(init.headers).get("authorization")).toBeNull();
    expect(new Headers(init.headers).get("cookie")).toBeNull();
    expect(new Headers(init.headers).get("if-none-match")).toBe(`"${"f".repeat(64)}"`);
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe(etag);
    expect(response.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toEqual(payload);
  });

  it("revalidates a cached snapshot and respects subsequent takedown", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304, headers: { etag } }))
      .mockResolvedValueOnce(Response.json({ error: "private details" }, { status: 404 }));
    const cached = await request(id, { "if-none-match": etag });
    expect(cached.status).toBe(304);
    expect(cached.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    expect(await cached.text()).toBe("");
    const removed = await request(id, { "if-none-match": etag });
    expect(removed.status).toBe(404);
    expect(removed.headers.get("cache-control")).toBe("no-store");
    expect(await removed.json()).toEqual({ error: "not_found" });
  });

  it.each([[false, false], [false, true], [true, false], [true, true]])("preserves only opted-in fields for quantity=%s and absolute P&L=%s", async (quantity, pnl) => {
    const publicAmounts = { ...(quantity ? { quantity: "0.15" } : {}), ...(pnl ? { absolute_pnl: { amount: "-0.12", currency: "USDT" } } : {}) };
    const visible = {
      ...payload,
      projection: {
        ...payload.projection,
        show_quantity: quantity, show_absolute_pnl: pnl,
        ...publicAmounts,
        markers: [{ ...payload.projection.markers[0], ...publicAmounts }],
      },
    };
    fetchMock.mockResolvedValue(gatewayJson(visible));
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(visible);
  });

  it("fails closed when a stale ETag or different ID reaches a response", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304, headers: { etag } }))
      .mockResolvedValueOnce(gatewayJson({ ...payload, id: postId }));
    expect((await request(id, { "if-none-match": `"${"f".repeat(64)}"` })).status).toBe(502);
    expect((await request()).status).toBe(502);
  });

  it("rejects invalid paths and query shapes before fetching", async () => {
    expect((await request("private-id")).status).toBe(404);
    expect((await request(id, {}, "?access_token=secret")).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { ...payload, account_id: "private-account-identifier" },
    { ...payload, projection: { ...payload.projection, chart_state: { private_note: "private-draft" } } },
    { ...payload, projection: { ...payload.projection, markers: [{ ...payload.projection.markers[0], fill_id: "native-fill-id" }] } },
    { ...payload, projection: { ...payload.projection, markers: [{ ...payload.projection.markers[0], quantity: "123.456" }] } },
    { ...payload, projection: { ...payload.projection, absolute_pnl: { amount: "123.456", currency: "USDT" } } },
    { ...payload, projection: { ...payload.projection, public_annotations: [{ ...payload.projection.public_annotations[0], storage_path: "private-signed-path" }] } },
    { ...payload, projection: { ...payload.projection, indicators: [{ ...payload.projection.indicators[0], settings: { credentials: "private-key" } }] } },
    { ...payload, projection: { ...payload.projection, drawings: [{ ...payload.projection.drawings[0], style: { accountSize: 123.456 } }] } },
  ])("fails closed for undocumented or hidden data", async (unsafe) => {
    fetchMock.mockResolvedValue(gatewayJson(unsafe));
    const response = await request();
    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "strategy_snapshot_unavailable" });
  });

  it("returns a fixed no-store error when the upstream is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("private-gateway-host"));
    const response = await request();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "strategy_snapshot_unavailable" });
  });
});
