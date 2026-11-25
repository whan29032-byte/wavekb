import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export type DiscordIntegrationConfig = {
  apiSecret: string;
  guildId: string;
  serviceRoleKey: string;
  publicOrigin: string | null;
};

type Environment = Record<string, string | undefined>;

export function isDiscordSnowflake(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]{17,20}$/.test(value);
}

function normalizedOrigin(value: string | undefined) {
  const input = value?.trim();
  if (!input) return null;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("DISCORD_LINK_PUBLIC_ORIGIN must be an absolute HTTP(S) origin");
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error("DISCORD_LINK_PUBLIC_ORIGIN must be an absolute HTTP(S) origin");
  }
  return url.origin;
}

export function requireDiscordIntegrationConfig(
  environment: Environment = process.env,
): DiscordIntegrationConfig {
  const apiSecret = environment.DISCORD_BOT_API_SECRET?.trim() ?? "";
  const guildId = environment.DISCORD_BOT_GUILD_ID?.trim() ?? "";
  const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!apiSecret) throw new Error("DISCORD_BOT_API_SECRET is required");
  if (!isDiscordSnowflake(guildId)) throw new Error("DISCORD_BOT_GUILD_ID must be a Discord snowflake");
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  return {
    apiSecret,
    guildId,
    serviceRoleKey,
    publicOrigin: normalizedOrigin(environment.DISCORD_LINK_PUBLIC_ORIGIN),
  };
}

function secretDigest(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

export function authorizeDiscordBot(
  headers: Headers,
  expectedSecret = requireDiscordIntegrationConfig().apiSecret,
) {
  const authorization = headers.get("authorization") ?? "";
  const supplied = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  return Boolean(expectedSecret) && timingSafeEqual(
    secretDigest(supplied),
    secretDigest(expectedSecret),
  );
}

export function createDiscordLinkToken(
  random: (size: number) => Buffer = randomBytes,
) {
  const rawToken = random(32).toString("base64url");
  return {
    rawToken,
    tokenHash: createHash("sha256").update(rawToken, "utf8").digest("hex"),
  };
}
