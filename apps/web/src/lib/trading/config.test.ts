import { afterEach, describe, expect, it, vi } from "vitest";
import { tradingFillChartEnabled, tradingWorkbenchV2Enabled } from "./config";

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
