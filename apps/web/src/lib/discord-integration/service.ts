import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import {
  createDiscordLinkToken,
  isDiscordSnowflake,
  requireDiscordIntegrationConfig,
  type DiscordIntegrationConfig,
} from "./security";

const LINK_LIFETIME_MS = 10 * 60 * 1000;

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

export type DiscordIntegrationStore = {
  revokePendingLinks(input: {
    discordUserId: string;
    guildId: string;
    revokedAt: string;
  }): Promise<void>;
  insertLink(input: {
    tokenHash: string;
    discordUserId: string;
    guildId: string;
    expiresAt: string;
  }): Promise<void>;
  findMemberByDiscordId(discordUserId: string): Promise<DiscordMemberRecord | null>;
};

type Dependencies = {
  config: DiscordIntegrationConfig;
  store: DiscordIntegrationStore;
  now: () => Date;
  createToken: () => { rawToken: string; tokenHash: string };
};

function databaseError(error: { message?: string } | null) {
  if (error) throw new DiscordIntegrationError("integration_unavailable", 503);
}

export function createSupabaseDiscordStore(client: SupabaseClient): DiscordIntegrationStore {
  return {
    async revokePendingLinks({ discordUserId, guildId, revokedAt }) {
      const result = await client
        .from("discord_link_tokens")
        .update({ revoked_at: revokedAt })
        .eq("discord_user_id", discordUserId)
        .eq("guild_id", guildId)
        .is("revoked_at", null)
        .is("redeemed_at", null);
      databaseError(result.error);
    },

    async insertLink({ tokenHash, discordUserId, guildId, expiresAt }) {
      const result = await client.from("discord_link_tokens").insert({
        token_hash: tokenHash,
        discord_user_id: discordUserId,
        guild_id: guildId,
        expires_at: expiresAt,
      });
      databaseError(result.error);
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
  };
}

function defaultDependencies(): Dependencies {
  const config = requireDiscordIntegrationConfig();
  return {
    config,
    store: createSupabaseDiscordStore(createServiceClient(config.serviceRoleKey)),
    now: () => new Date(),
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
    now: overrides.now ?? (() => new Date()),
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

  const issuedAt = dependencies.now();
  const expiresAt = new Date(issuedAt.getTime() + LINK_LIFETIME_MS);
  const token = dependencies.createToken();
  await dependencies.store.revokePendingLinks({
    discordUserId: input.discordUserId,
    guildId: input.guildId,
    revokedAt: issuedAt.toISOString(),
  });
  await dependencies.store.insertLink({
    tokenHash: token.tokenHash,
    discordUserId: input.discordUserId,
    guildId: input.guildId,
    expiresAt: expiresAt.toISOString(),
  });
  const link = new URL("/account/discord-link", integrationOrigin(
    dependencies.config.publicOrigin,
    input.requestOrigin,
  ));
  link.searchParams.set("token", token.rawToken);
  return { linkUrl: link.toString(), expiresAt: expiresAt.toISOString() };
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

export function discordErrorResponse(error: unknown) {
  if (error instanceof DiscordIntegrationError) {
    return { code: error.code, status: error.status };
  }
  return { code: "integration_unavailable", status: 503 };
}
