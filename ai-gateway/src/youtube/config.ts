export type YouTubeSyncConfig = {
  enabled: boolean;
  readiness: "disabled" | "unconfigured" | "ready";
  revocationReady: boolean;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenMasterKey: string;
  supabaseUrl: string;
  serviceRoleKey: string;
  pollMs: number;
  maxPagesPerConnection: number;
  maxCallsPerPoll: number;
  batchSize: number;
};

function integerSetting(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error("youtube_configuration_invalid");
  return parsed;
}

function httpsUrl(value: string, originOnly: boolean): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search
      || (originOnly && url.pathname !== "/")) throw new Error();
    return originOnly ? url.origin : url.href;
  } catch {
    throw new Error("youtube_configuration_invalid");
  }
}

// This integration never depends on AI, trading, or global login-site settings.
export function loadYouTubeSyncConfig(env: Record<string, string | undefined>): YouTubeSyncConfig {
  const flag = env.YOUTUBE_SYNC_ENABLED?.trim() || "false";
  if (flag !== "true" && flag !== "false") throw new Error("youtube_configuration_invalid");
  const config: YouTubeSyncConfig = {
    enabled: flag === "true",
    readiness: flag === "true" ? "unconfigured" : "disabled",
    revocationReady: false,
    clientId: env.YOUTUBE_OAUTH_CLIENT_ID?.trim() || "",
    clientSecret: env.YOUTUBE_OAUTH_CLIENT_SECRET?.trim() || "",
    redirectUri: env.YOUTUBE_OAUTH_REDIRECT_URI?.trim() || "",
    tokenMasterKey: env.YOUTUBE_TOKEN_MASTER_KEY?.trim() || "",
    supabaseUrl: env.SUPABASE_URL?.trim() || "",
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "",
    pollMs: integerSetting(env.YOUTUBE_SYNC_POLL_SECONDS, 600, 300, 900) * 1000,
    maxPagesPerConnection: integerSetting(env.YOUTUBE_SYNC_MAX_PAGES_PER_CONNECTION, 2, 2, 5),
    maxCallsPerPoll: integerSetting(env.YOUTUBE_SYNC_MAX_CALLS_PER_POLL, 20, 4, 100),
    batchSize: integerSetting(env.YOUTUBE_SYNC_BATCH_SIZE, 50, 1, 50),
  };
  // Local retention cleanup still works when importing is disabled/unconfigured.
  if (config.supabaseUrl) config.supabaseUrl = httpsUrl(config.supabaseUrl, true);
  if (/\s/.test(config.serviceRoleKey)) throw new Error("youtube_configuration_invalid");
  if (config.tokenMasterKey) {
    if (/\s/.test(config.tokenMasterKey) || Buffer.from(config.tokenMasterKey, "base64").length !== 32
      || Buffer.from(config.tokenMasterKey, "base64").toString("base64") !== config.tokenMasterKey) {
      throw new Error("youtube_configuration_invalid");
    }
    config.revocationReady = Boolean(config.supabaseUrl && config.serviceRoleKey);
  }
  if (!config.enabled || !config.clientId || !config.clientSecret || !config.redirectUri
    || !config.tokenMasterKey || !config.supabaseUrl || !config.serviceRoleKey) return config;
  if ([config.clientId, config.clientSecret, config.tokenMasterKey, config.serviceRoleKey].some((value) => /\s/.test(value))
    || !config.clientId.endsWith(".apps.googleusercontent.com")
    || Buffer.from(config.tokenMasterKey, "base64").length !== 32
    || Buffer.from(config.tokenMasterKey, "base64").toString("base64") !== config.tokenMasterKey) {
    throw new Error("youtube_configuration_invalid");
  }
  // A valid enabled setup must have room for ownership/retention checks and
  // both the fresh head and a deep page; otherwise a large import can starve.
  if (config.maxCallsPerPoll < 5 + 2 * Math.ceil(50 / config.batchSize)) throw new Error("youtube_configuration_invalid");
  config.redirectUri = httpsUrl(config.redirectUri, false);
  config.readiness = "ready";
  return config;
}
