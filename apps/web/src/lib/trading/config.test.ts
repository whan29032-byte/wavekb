import { afterEach, describe, expect, it, vi } from "vitest";
import { tradingChartAvailability, tradingFillChartEnabled, tradingWorkbenchV2Enabled, workbenchLiveMarketOrigin } from "./config";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("fill chart availability", () => {
  it("reads its own Gateway flag and treats an older or unreachable Gateway as disabled", async () => {
    const env = { AUTH_GATEWAY_INTERNAL_URL: "http://127.0.0.1:8787/" };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ ok: true, features: { trading_workbench_v2: true } }))
      .mockResolvedValueOnce(Response.json({ ok: true, features: { trading_fill_chart: true } }))
      .mockResolvedValueOnce(Response.json({ ok: true, features: { trading_fill_chart: "true" } }))
      .mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetcher);
    expect(await tradingFillChartEnabled({})).toBe(false);
    expect(await tradingFillChartEnabled(env)).toBe(false);
    expect(await tradingFillChartEnabled(env)).toBe(true);
    expect(await tradingFillChartEnabled(env)).toBe(false);
    expect(await tradingFillChartEnabled(env)).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("supports a Web kill switch while keeping the Gateway authoritative for enabling", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true, features: { trading_fill_chart: false } }));
    vi.stubGlobal("fetch", fetcher);
    const env = { AUTH_GATEWAY_INTERNAL_URL: "http://127.0.0.1:8787/" };
    expect(await tradingFillChartEnabled({ ...env, TRADING_FILL_CHART_ENABLED: "false" })).toBe(false);
    expect(await tradingFillChartEnabled({ ...env, TRADING_FILL_CHART_ENABLED: "no" })).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await tradingFillChartEnabled({ ...env, TRADING_FILL_CHART_ENABLED: "true" })).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("consults Gateway pilot access with the verified session token", async () => {
    const env = { AUTH_GATEWAY_INTERNAL_URL: "http://127.0.0.1:8787/" };
    const fetcher = vi.fn(async (url: string) => url.endsWith("/health")
      ? Response.json({ ok: true, features: { trading_fill_chart: false, trading_fill_chart_pilot: true } })
      : Response.json({ enabled: true }));
    vi.stubGlobal("fetch", fetcher);
    expect(await tradingFillChartEnabled(env)).toBe(false);
    expect(await tradingFillChartEnabled(env, async () => "verified-token")).toBe(true);
    expect(fetcher).toHaveBeenLastCalledWith("http://127.0.0.1:8787/v1/user/trading-chart-access", expect.objectContaining({
      cache: "no-store", headers: { authorization: "Bearer verified-token" },
    }));
  });

  it("exposes sharing only when both the chart and sharing are enabled for this member", async () => {
    const env = { AUTH_GATEWAY_INTERNAL_URL: "http://127.0.0.1:8787" };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ ok: true, features: { trading_public_strategies: true } }))
      .mockResolvedValueOnce(Response.json({ ok: true, features: { trading_fill_chart: true } }))
      .mockResolvedValueOnce(Response.json({ ok: true, features: { trading_fill_chart_pilot: true, trading_public_strategies: true } }))
      .mockResolvedValueOnce(Response.json({ enabled: false, share_enabled: true }))
      .mockResolvedValueOnce(Response.json({ ok: true, features: { trading_fill_chart: true, trading_public_strategies: true } }));
    vi.stubGlobal("fetch", fetcher);
    expect(await tradingChartAvailability(env)).toEqual({ chart: false, share: false });
    expect(await tradingChartAvailability(env)).toEqual({ chart: true, share: false });
    expect(await tradingChartAvailability(env, async () => "verified-token")).toEqual({ chart: false, share: false });
    expect(await tradingChartAvailability(env)).toEqual({ chart: true, share: true });
  });
});

describe("trading workbench cutover flag", () => {
  it("fails closed when the Gateway URL is absent", async () => {
    vi.stubEnv("TRADING_WORKBENCH_V2_ENABLED", "");
    vi.stubEnv("AUTH_GATEWAY_INTERNAL_URL", "");
    expect(await tradingWorkbenchV2Enabled()).toBe(false);
  });

  it("accepts an explicit strict local override", async () => {
    vi.stubEnv("TRADING_WORKBENCH_V2_ENABLED", "true");
    expect(await tradingWorkbenchV2Enabled()).toBe(true);
    vi.stubEnv("TRADING_WORKBENCH_V2_ENABLED", "false");
    expect(await tradingWorkbenchV2Enabled()).toBe(false);
    vi.stubEnv("TRADING_WORKBENCH_V2_ENABLED", "yes");
    await expect(tradingWorkbenchV2Enabled()).rejects.toThrow(/TRADING_WORKBENCH_V2_ENABLED/);
  });

  it("uses the Gateway health feature state when no override is configured", async () => {
    vi.stubEnv("TRADING_WORKBENCH_V2_ENABLED", "");
    vi.stubEnv("AUTH_GATEWAY_INTERNAL_URL", "http://127.0.0.1:8787");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      features: { trading_workbench_v2: true },
    }), { status: 200 })));
    expect(await tradingWorkbenchV2Enabled()).toBe(true);
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:8787/health", expect.objectContaining({ cache: "no-store" }));
  });

  it("fails closed on malformed or unavailable Gateway health", async () => {
    vi.stubEnv("TRADING_WORKBENCH_V2_ENABLED", "");
    vi.stubEnv("AUTH_GATEWAY_INTERNAL_URL", "http://127.0.0.1:8787/");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, features: {} }), { status: 200 })));
    expect(await tradingWorkbenchV2Enabled()).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await tradingWorkbenchV2Enabled()).toBe(false);
  });
});

describe("live market rollout", () => {
  const config = { WORKBENCH_LIVE_MARKET_ORIGIN: "https://charts.example.net", WORKBENCH_LIVE_MARKET_ENABLED: "true", WORKBENCH_LIVE_MARKET_PILOT_UIDS: "33333, 44444" };
  it("requires a chart-enabled pilot member unless the separate member rollout is enabled", () => {
    expect(workbenchLiveMarketOrigin(33333, true, config)).toBe("https://charts.example.net");
    expect(workbenchLiveMarketOrigin(22222, true, config)).toBeNull();
    expect(workbenchLiveMarketOrigin(33333, false, config)).toBeNull();
    expect(workbenchLiveMarketOrigin(33333, true, {})).toBeNull();
    expect(workbenchLiveMarketOrigin(22222, true, { ...config, WORKBENCH_LIVE_MARKET_PUBLIC_ENABLED: "true" })).toBe("https://charts.example.net");
    expect(workbenchLiveMarketOrigin(0, true, { ...config, WORKBENCH_LIVE_MARKET_PUBLIC_ENABLED: "true" })).toBeNull();
  });
});
