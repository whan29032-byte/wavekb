const splitHosts = (value: string): string[] =>
  value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);

export type GatewayConfig = {
  PORT: number;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  AI_SECRET_MASTER_KEY: Buffer;
  ALLOWED_PROVIDER_HOSTS: string[];
  ALLOWED_LOCAL_PROVIDER_HOSTS: string[];
  AI_DAILY_USER_LIMIT: number;
  AI_MAX_IMAGE_BYTES: number;
  ALLOWED_WEB_ORIGINS: string[];
  AUTH_SITE_URL: string;
  AUTH_LOGIN_LIMIT_PER_15_MINUTES: number;
  AUTH_UID_ACTION_LIMIT_PER_HOUR: number;
  AUTH_FEATURE_ENABLED: boolean;
};

const integer = (value: string | undefined, fallback: number, minimum: number, maximum: number): number => {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`invalid integer setting: ${value ?? fallback}`);
  }
  return parsed;
};

const boolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`invalid boolean setting: ${value}`);
};

export function loadConfig(env: Record<string, string | undefined>): GatewayConfig {
  const supabaseUrl = env.SUPABASE_URL ?? "";
  try {
    new URL(supabaseUrl);
  } catch {
    throw new Error("SUPABASE_URL must be a valid URL");
  }
  if ((env.SUPABASE_SERVICE_ROLE_KEY ?? "").length < 20) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  }
  if ((env.SUPABASE_PUBLISHABLE_KEY ?? "").length < 20) {
    throw new Error("SUPABASE_PUBLISHABLE_KEY is required");
  }
  const authSiteUrl = env.AUTH_SITE_URL ?? "";
  try {
    const parsed = new URL(authSiteUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("protocol");
  } catch {
    throw new Error("AUTH_SITE_URL must be a valid HTTP(S) URL");
  }
  const masterKey = Buffer.from(env.AI_SECRET_MASTER_KEY ?? "", "base64");
  if (masterKey.length !== 32) {
    throw new Error("AI_SECRET_MASTER_KEY must decode to 32-byte key");
  }
  return {
    PORT: integer(env.PORT, 8787, 1, 65535),
    SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY as string,
    SUPABASE_PUBLISHABLE_KEY: env.SUPABASE_PUBLISHABLE_KEY as string,
    AI_SECRET_MASTER_KEY: masterKey,
    ALLOWED_PROVIDER_HOSTS: splitHosts(env.ALLOWED_PROVIDER_HOSTS ?? ""),
    ALLOWED_LOCAL_PROVIDER_HOSTS: splitHosts(env.ALLOWED_LOCAL_PROVIDER_HOSTS ?? ""),
    AI_DAILY_USER_LIMIT: integer(env.AI_DAILY_USER_LIMIT, 20, 0, 1_000_000),
    AI_MAX_IMAGE_BYTES: integer(env.AI_MAX_IMAGE_BYTES, 10 * 1024 * 1024, 1024, 100 * 1024 * 1024),
    ALLOWED_WEB_ORIGINS: splitHosts(
      env.ALLOWED_WEB_ORIGINS ?? "http://127.0.0.1:8765,http://localhost:8765",
    ),
    AUTH_SITE_URL: authSiteUrl,
    AUTH_LOGIN_LIMIT_PER_15_MINUTES: integer(
      env.AUTH_LOGIN_LIMIT_PER_15_MINUTES,
      8,
      1,
      1000,
    ),
    AUTH_UID_ACTION_LIMIT_PER_HOUR: integer(
      env.AUTH_UID_ACTION_LIMIT_PER_HOUR,
      12,
      1,
      1000,
    ),
    AUTH_FEATURE_ENABLED: boolean(env.AUTH_FEATURE_ENABLED, false),
  };
}
