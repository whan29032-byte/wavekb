import { afterEach, describe, expect, it, vi } from "vitest";
import { tradingWorkbenchV2Enabled } from "./config";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
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
