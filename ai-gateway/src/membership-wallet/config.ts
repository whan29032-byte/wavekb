export type WalletVerificationConfig = {
  enabled: boolean; readiness: "disabled" | "unconfigured" | "ready";
  ethereumRpcUrl: string | null; baseRpcUrl: string | null; tronApiKey: string | null;
  allowedHosts: readonly string[]; batchSize: number; timeoutMs: number;
};
// URLs are deployment-only configuration, not fields from invoices or claims.
// Explicit host allowlisting and redirect rejection prevent receipt requests
// from being turned into arbitrary outbound requests. Secret paths are never logged.
function rpcUrl(value: string | undefined, allowedHosts: readonly string[]): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.hash || (url.port && url.port !== "443")
      || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(url.hostname) || !url.hostname.includes(".")
      || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname)
      || /^\d+(?:\.\d+){3}$/.test(url.hostname) || !allowedHosts.includes(url.hostname)) throw new Error();
    return url.href;
  } catch { throw new Error("membership_wallet_rpc_configuration_invalid"); }
}
export function loadMembershipWalletVerificationConfig(env: Record<string, string | undefined>): WalletVerificationConfig {
  const setting = env.MEMBERSHIP_WALLET_ENABLED?.trim() || "false";
  if (setting !== "true" && setting !== "false") throw new Error("membership_wallet_enable_flag_invalid");
  const enabled = setting === "true";
  const batchSize = Number(env.MEMBERSHIP_WALLET_VERIFY_BATCH_SIZE || "2");
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10) throw new Error("membership_wallet_batch_invalid");
  const allowedHosts = (env.MEMBERSHIP_WALLET_RPC_ALLOWED_HOSTS || "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
  const result: WalletVerificationConfig = { enabled, readiness: enabled ? "ready" : "disabled", ethereumRpcUrl: null, baseRpcUrl: null,
    tronApiKey: null, allowedHosts, batchSize, timeoutMs: 8000 };
  if (!enabled) return result;
  result.ethereumRpcUrl = rpcUrl(env.MEMBERSHIP_WALLET_ETHEREUM_RPC_URL, allowedHosts);
  result.baseRpcUrl = rpcUrl(env.MEMBERSHIP_WALLET_BASE_RPC_URL, allowedHosts);
  const key = env.MEMBERSHIP_WALLET_TRONGRID_API_KEY?.trim();
  if (key && (key.length > 512 || /\s/.test(key))) throw new Error("membership_wallet_rpc_configuration_invalid");
  result.tronApiKey = key || null;
  // A missing EVM endpoint does not prevent the independent TRON route or
  // another configured chain from running. Missing-chain jobs retain evidence
  // and wait; SQL settings/recipient gates independently control new invoices.
  return result;
}
