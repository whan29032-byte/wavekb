import "server-only";

export function tradingWorkbenchV2Enabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<boolean> {
  const value = env.TRADING_WORKBENCH_V2_ENABLED;
  if (value === "true") return Promise.resolve(true);
  if (value === "false") return Promise.resolve(false);
  if (value !== undefined && value !== "") {
    return Promise.reject(new Error("TRADING_WORKBENCH_V2_ENABLED must be true or false"));
  }

  const gatewayOrigin = env.AUTH_GATEWAY_INTERNAL_URL?.replace(/\/$/, "");
  if (!gatewayOrigin) return Promise.resolve(false);
  return fetch(`${gatewayOrigin}/health`, {
    cache: "no-store",
    signal: AbortSignal.timeout(3_000),
  }).then(async (response) => {
    if (!response.ok) return false;
    const payload = await response.json() as {
      ok?: unknown;
      features?: { trading_workbench_v2?: unknown };
    };
    return payload.ok === true && payload.features?.trading_workbench_v2 === true;
  }).catch(() => false);
}
