import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import {
  createDiscordLinkToken,
  isDiscordSnowflake,
  requireDiscordIntegrationConfig,
  type DiscordIntegrationConfig,
} from "./security";

export class DiscordIntegrationError extends Error {
  constructor(public readonly code: string, public readonly status: number) {
    super(code);
    this.name = "DiscordIntegrationError";
  }
}

export type DiscordMemberRecord = {
  id: string;
  publicUid: number;
  displayName: string;
  avatarUrl: string | null;
  displayTitle: string | null;
  nameplateStyle: string;
  accountStatus: string;
  balance: number | null;
  lifetimeEarned: number | null;
};

export const discordGameActions = [
  "status",
  "daily_checkin",
  "work",
  "skill_draw",
  "skill_collection",
  "pet_shop",
  "pet_buy_egg",
  "pet_hatch",
  "pet_adopt",
  "pet_list",
  "pet_rename",
  "pet_activate",
  "market_view",
  "market_bet",
] as const;

export type DiscordGameAction = (typeof discordGameActions)[number];
export type DiscordGamePayload = Record<string, unknown>;
export type DiscordGameResult = Record<string, unknown> & { action: DiscordGameAction };

export type DiscordIntegrationStore = {
  issueLink(input: {
    tokenHash: string;
    discordUserId: string;
    guildId: string;
  }): Promise<{ expiresAt: string }>;
  findMemberByDiscordId(discordUserId: string): Promise<DiscordMemberRecord | null>;
  executeGameAction(input: {
    discordUserId: string;
    requestId: string;
    action: DiscordGameAction;
    payload: DiscordGamePayload;
  }): Promise<DiscordGameResult>;
};

type Dependencies = {
  config: DiscordIntegrationConfig;
  store: DiscordIntegrationStore;
  createToken: () => { rawToken: string; tokenHash: string };
};

function databaseError(error: { message?: string } | null) {
  if (error) throw new DiscordIntegrationError("integration_unavailable", 503);
}

const gameDatabaseErrors: Readonly<Record<string, { code: string; status: number }>> = {
  not_linked: { code: "not_linked", status: 404 },
  account_restricted: { code: "account_restricted", status: 403 },
  request_id_conflict: { code: "request_id_conflict", status: 409 },
  reward_balance_insufficient: { code: "insufficient_points", status: 409 },
  work_cooldown: { code: "work_cooldown", status: 429 },
  work_daily_limit: { code: "work_daily_limit", status: 429 },
  pet_adoption_already_used: { code: "pet_adoption_already_used", status: 409 },
  pet_egg_insufficient: { code: "pet_egg_insufficient", status: 409 },
  pet_not_found: { code: "pet_not_found", status: 404 },
  market_closed: { code: "market_closed", status: 409 },
  market_daily_limit: { code: "market_daily_limit", status: 409 },
};

function gameDatabaseError(error: { message?: string } | null) {
  if (!error) return;
  const message = String(error.message ?? "");
  for (const [databaseCode, response] of Object.entries(gameDatabaseErrors)) {
    if (new RegExp(`(?:^|[^a-z_])${databaseCode}(?:$|[^a-z_])`).test(message)) {
      throw new DiscordIntegrationError(response.code, response.status);
    }
  }
  throw new DiscordIntegrationError("integration_unavailable", 503);
}

export function createSupabaseDiscordStore(client: SupabaseClient): DiscordIntegrationStore {
  return {
    async issueLink({ tokenHash, discordUserId, guildId }) {
      const result = await client.rpc("issue_discord_link_token", {
        p_token_hash: tokenHash,
        p_discord_user_id: discordUserId,
        p_guild_id: guildId,
      });
      databaseError(result.error);
      if (typeof result.data !== "string" || !Number.isFinite(Date.parse(result.data))) {
        throw new DiscordIntegrationError("integration_unavailable", 503);
      }
      return { expiresAt: new Date(result.data).toISOString() };
    },

    async findMemberByDiscordId(discordUserId) {
      const profile = await client
        .from("profiles")
        .select("id,public_uid,display_name,avatar_url,display_title,nameplate_style,account_status")
        .eq("discord_user_id", discordUserId)
        .maybeSingle();
      databaseError(profile.error);
      if (!profile.data) return null;

      const wallet = await client
        .from("reward_wallets")
        .select("balance,lifetime_earned")
        .eq("user_id", profile.data.id)
        .maybeSingle();
      databaseError(wallet.error);
      return {
        id: String(profile.data.id),
        publicUid: Number(profile.data.public_uid),
        displayName: String(profile.data.display_name),
        avatarUrl: profile.data.avatar_url == null ? null : String(profile.data.avatar_url),
        displayTitle: profile.data.display_title == null ? null : String(profile.data.display_title),
        nameplateStyle: String(profile.data.nameplate_style || "classic"),
        accountStatus: String(profile.data.account_status),
        balance: wallet.data?.balance == null ? null : Number(wallet.data.balance),
        lifetimeEarned: wallet.data?.lifetime_earned == null ? null : Number(wallet.data.lifetime_earned),
      };
    },

    async executeGameAction({ discordUserId, requestId, action, payload }) {
      const result = await client.rpc("discord_game_action", {
        p_discord_user_id: discordUserId,
        p_request_id: requestId,
        p_action: action,
        p_payload: payload,
      });
      gameDatabaseError(result.error);
      if (!isPlainObject(result.data) || result.data.action !== action) {
        throw new DiscordIntegrationError("integration_unavailable", 503);
      }
      return result.data as DiscordGameResult;
    },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(payload: DiscordGamePayload, allowed: readonly string[]) {
  const keys = Object.keys(payload);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}

function optionalKeys(payload: DiscordGamePayload, required: readonly string[], allowed: readonly string[]) {
  const keys = Object.keys(payload);
  return required.every((key) => keys.includes(key)) && keys.every((key) => allowed.includes(key));
}

function isPath(value: unknown): value is "esper" | "magician" {
  return value === "esper" || value === "magician";
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validGamePayload(action: DiscordGameAction, payload: DiscordGamePayload) {
  if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > 4096) return false;
  if (["status", "daily_checkin", "pet_shop", "market_view"].includes(action)) {
    return exactKeys(payload, []);
  }
  if (action === "pet_list") {
    return exactKeys(payload, ["page"])
      && Number.isInteger(payload.page)
      && Number(payload.page) >= 1
      && Number(payload.page) <= 10000;
  }
  if (["work", "skill_collection", "pet_adopt"].includes(action)) {
    return exactKeys(payload, ["path"]) && isPath(payload.path);
  }
  if (action === "skill_draw") {
    return exactKeys(payload, ["path", "count"])
      && isPath(payload.path)
      && (payload.count === 1 || payload.count === 10);
  }
  if (action === "pet_buy_egg" || action === "pet_hatch") {
    const eggType = payload.eggType;
    return optionalKeys(payload, ["eggType", "quantity"], ["eggType", "quantity", "path"])
      && (eggType === "basic" || eggType === "route" || eggType === "premium")
      && Number.isInteger(payload.quantity)
      && Number(payload.quantity) >= 1
      && Number(payload.quantity) <= 10
      && (eggType === "route" ? isPath(payload.path) : payload.path === undefined || isPath(payload.path));
  }
  if (action === "pet_rename") {
    return exactKeys(payload, ["petId", "name"])
      && isUuid(payload.petId)
      && typeof payload.name === "string"
      && payload.name.trim().length >= 1
      && payload.name.trim().length <= 16
      && !/[\r\n]/.test(payload.name);
  }
  if (action === "pet_activate") {
    return exactKeys(payload, ["petId"]) && isUuid(payload.petId);
  }
  if (action === "market_bet") {
    return exactKeys(payload, ["symbol", "direction", "stake"])
      && ["academy", "grimoire", "petegg"].includes(String(payload.symbol))
      && (payload.direction === "up" || payload.direction === "down")
      && Number.isInteger(payload.stake)
      && Number(payload.stake) >= 10
      && Number(payload.stake) <= 500;
  }
  return false;
}

function defaultDependencies(): Dependencies {
  const config = requireDiscordIntegrationConfig();
  return {
    config,
    store: createSupabaseDiscordStore(createServiceClient(config.serviceRoleKey)),
    createToken: createDiscordLinkToken,
  };
}

function resolvedDependencies(overrides?: Partial<Dependencies>): Dependencies {
  if (!overrides) return defaultDependencies();
  if (!overrides.config || !overrides.store) {
    const defaults = defaultDependencies();
    return { ...defaults, ...overrides };
  }
  return {
    config: overrides.config,
    store: overrides.store,
    createToken: overrides.createToken ?? createDiscordLinkToken,
  };
}

function integrationOrigin(configured: string | null, requestOrigin: string) {
  if (configured) return configured;
  let url: URL;
  try {
    url = new URL(requestOrigin);
  } catch {
    throw new DiscordIntegrationError("invalid_request_origin", 400);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new DiscordIntegrationError("invalid_request_origin", 400);
  }
  return url.origin;
}

export async function createDiscordLink(
  input: { discordUserId: unknown; guildId: unknown; requestOrigin: string },
  dependencyOverrides?: Partial<Dependencies>,
) {
  const dependencies = resolvedDependencies(dependencyOverrides);
  if (!isDiscordSnowflake(input.discordUserId)) {
    throw new DiscordIntegrationError("invalid_discord_user", 400);
  }
  if (!isDiscordSnowflake(input.guildId)) {
    throw new DiscordIntegrationError("invalid_guild", 400);
  }
  if (input.guildId !== dependencies.config.guildId) {
    throw new DiscordIntegrationError("guild_not_allowed", 403);
  }

  const token = dependencies.createToken();
  const issued = await dependencies.store.issueLink({
    tokenHash: token.tokenHash,
    discordUserId: input.discordUserId,
    guildId: input.guildId,
  });
  const link = new URL("/account/discord-link", integrationOrigin(
    dependencies.config.publicOrigin,
    input.requestOrigin,
  ));
  link.hash = new URLSearchParams({ token: token.rawToken }).toString();
  return { linkUrl: link.toString(), expiresAt: issued.expiresAt };
}

export async function getDiscordMember(
  discordUserId: unknown,
  dependencyOverrides?: Partial<Dependencies>,
) {
  const dependencies = resolvedDependencies(dependencyOverrides);
  if (!isDiscordSnowflake(discordUserId)) {
    throw new DiscordIntegrationError("invalid_discord_user", 400);
  }
  const profile = await dependencies.store.findMemberByDiscordId(discordUserId);
  if (!profile) throw new DiscordIntegrationError("not_linked", 404);
  if (profile.accountStatus !== "active") {
    throw new DiscordIntegrationError("account_restricted", 403);
  }
  return {
    uid: profile.publicUid,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    displayTitle: profile.displayTitle,
    nameplateStyle: profile.nameplateStyle,
    points: {
      balance: profile.balance ?? 0,
      lifetimeEarned: profile.lifetimeEarned ?? 0,
    },
  };
}

export async function executeDiscordGameAction(
  input: {
    discordUserId: unknown;
    guildId: unknown;
    requestId: unknown;
    action: unknown;
    payload: unknown;
  },
  dependencyOverrides?: Partial<Dependencies>,
) {
  const dependencies = resolvedDependencies(dependencyOverrides);
  if (!isDiscordSnowflake(input.discordUserId)) {
    throw new DiscordIntegrationError("invalid_discord_user", 400);
  }
  if (!isDiscordSnowflake(input.guildId)) {
    throw new DiscordIntegrationError("invalid_guild", 400);
  }
  if (input.guildId !== dependencies.config.guildId) {
    throw new DiscordIntegrationError("guild_not_allowed", 403);
  }
  if (!isDiscordSnowflake(input.requestId)) {
    throw new DiscordIntegrationError("invalid_request_id", 400);
  }
  if (typeof input.action !== "string" || !discordGameActions.includes(input.action as DiscordGameAction)) {
    throw new DiscordIntegrationError("invalid_game_action", 400);
  }
  if (!isPlainObject(input.payload)
      || !validGamePayload(input.action as DiscordGameAction, input.payload)) {
    throw new DiscordIntegrationError("invalid_game_payload", 400);
  }
  return dependencies.store.executeGameAction({
    discordUserId: input.discordUserId,
    requestId: input.requestId,
    action: input.action as DiscordGameAction,
    payload: input.payload,
  });
}

export function discordErrorResponse(error: unknown) {
  if (error instanceof DiscordIntegrationError) {
    return { code: error.code, status: error.status };
  }
  return { code: "integration_unavailable", status: 503 };
}
