import "server-only";

type TradingEnvironment = Readonly<Record<string, string | undefined>>;
type GatewayTradingFeature = "trading_workbench_v2" | "trading_fill_chart";

export function tradingWorkbenchV2Enabled(
  env: TradingEnvironment = process.env,
): Promise<boolean> {
  const value = env.TRADING_WORKBENCH_V2_ENABLED;
  if (value === "true") return Promise.resolve(true);
  if (value === "false") return Promise.resolve(false);
  if (value !== undefined && value !== "") {
    return Promise.reject(new Error("TRADING_WORKBENCH_V2_ENABLED must be true or false"));
  }
  return gatewayTradingFeature(env, "trading_workbench_v2");
}

export function tradingFillChartEnabled(env: TradingEnvironment = process.env): Promise<boolean> {
  const value = env.TRADING_FILL_CHART_ENABLED;
  if (value !== undefined && value !== "" && value !== "true") return Promise.resolve(false);
  return gatewayTradingFeature(env, "trading_fill_chart");
}

function gatewayTradingFeature(env: TradingEnvironment, name: GatewayTradingFeature): Promise<boolean> {
  const gatewayOrigin = env.AUTH_GATEWAY_INTERNAL_URL?.replace(/\/$/, "");
  if (!gatewayOrigin) return Promise.resolve(false);
  return fetch(`${gatewayOrigin}/health`, {
    cache: "no-store",
    signal: AbortSignal.timeout(3_000),
  }).then(async (response) => {
    if (!response.ok) return false;
    const payload = await response.json() as {
      ok?: unknown;
      features?: Partial<Record<GatewayTradingFeature, unknown>>;
    };
    return payload.ok === true && payload.features?.[name] === true;
  }).catch(() => false);
}
