import "server-only";
import { parseTradeXOrigin } from "./tradex-bridge";

type TradingEnvironment = Readonly<Record<string, string | undefined>>;
type GatewayTradingFeatures = {
  trading_workbench_v2?: unknown;
  trading_fill_chart?: unknown;
  trading_fill_chart_pilot?: unknown;
  trading_public_strategies?: unknown;
};

export function workbenchLiveMarketOrigin(publicUid: number, chartEnabled: boolean, env: TradingEnvironment = process.env): string | null {
  if (!chartEnabled || !Number.isSafeInteger(publicUid) || publicUid < 10_000 || publicUid > 999_999 || env.WORKBENCH_LIVE_MARKET_ENABLED !== "true") return null;
  if (env.WORKBENCH_LIVE_MARKET_PUBLIC_ENABLED !== "true"
    && !env.WORKBENCH_LIVE_MARKET_PILOT_UIDS?.split(",").some((uid) => uid.trim() === String(publicUid))) return null;
  return parseTradeXOrigin(env.WORKBENCH_LIVE_MARKET_ORIGIN)?.origin ?? null;
}

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
  return (await tradingChartAvailability(env, accessToken)).chart;
}

export async function tradingChartAvailability(
  env: TradingEnvironment = process.env,
  accessToken?: () => Promise<string | null>,
): Promise<{ chart: boolean; share: boolean }> {
  const disabled = { chart: false, share: false };
  const value = env.TRADING_FILL_CHART_ENABLED;
  if (value !== undefined && value !== "" && value !== "true") return disabled;
  const features = await gatewayTradingFeatures(env);
  if (features?.trading_fill_chart === true) return { chart: true, share: features.trading_public_strategies === true };
  if (features?.trading_fill_chart_pilot !== true || !accessToken) return disabled;

  const origin = gatewayOrigin(env);
  if (!origin) return disabled;
  try {
    const token = await accessToken();
    if (!token) return disabled;
    const response = await fetch(`${origin}/v1/user/trading-chart-access`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) return disabled;
    const status = await response.json() as { enabled?: unknown; share_enabled?: unknown };
    return status.enabled === true
      ? { chart: true, share: status.share_enabled === true }
      : disabled;
  } catch {
    return disabled;
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
