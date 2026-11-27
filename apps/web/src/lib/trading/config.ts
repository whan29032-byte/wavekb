import "server-only";

type TradingEnvironment = Readonly<Record<string, string | undefined>>;
type GatewayTradingFeatures = {
  trading_workbench_v2?: unknown;
  trading_fill_chart?: unknown;
  trading_fill_chart_pilot?: unknown;
};

export function tradingWorkbenchV2Enabled(
  env: TradingEnvironment = process.env,
): Promise<boolean> {
  const value = env.TRADING_WORKBENCH_V2_ENABLED;
  if (value === "true") return Promise.resolve(true);
  if (value === "false") return Promise.resolve(false);
  if (value !== undefined && value !== "") {
    return Promise.reject(new Error("TRADING_WORKBENCH_V2_ENABLED must be true or false"));
  }
  return gatewayTradingFeatures(env).then((features) => features?.trading_workbench_v2 === true);
}

export async function tradingFillChartEnabled(
  env: TradingEnvironment = process.env,
  accessToken?: () => Promise<string | null>,
): Promise<boolean> {
  const value = env.TRADING_FILL_CHART_ENABLED;
  if (value !== undefined && value !== "" && value !== "true") return false;
  const features = await gatewayTradingFeatures(env);
  if (features?.trading_fill_chart === true) return true;
  if (features?.trading_fill_chart_pilot !== true || !accessToken) return false;

  const origin = gatewayOrigin(env);
  if (!origin) return false;
  try {
    const token = await accessToken();
    if (!token) return false;
    const response = await fetch(`${origin}/v1/user/trading-chart-access`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
      headers: { authorization: `Bearer ${token}` },
    });
    return response.ok && (await response.json() as { enabled?: unknown }).enabled === true;
  } catch {
    return false;
  }
}

function gatewayOrigin(env: TradingEnvironment) {
  return env.AUTH_GATEWAY_INTERNAL_URL?.replace(/\/$/, "");
}

function gatewayTradingFeatures(env: TradingEnvironment): Promise<GatewayTradingFeatures | null> {
  const origin = gatewayOrigin(env);
  if (!origin) return Promise.resolve(null);
  return fetch(`${origin}/health`, {
    cache: "no-store",
    signal: AbortSignal.timeout(3_000),
  }).then(async (response) => {
    if (!response.ok) return null;
    const payload = await response.json() as {
      ok?: unknown;
      features?: GatewayTradingFeatures;
    };
    return payload.ok === true ? payload.features ?? null : null;
  }).catch(() => null);
}
