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

export type DiscordIntegrationStore = {
  issueLink(input: {
    tokenHash: string;
    discordUserId: string;
    guildId: string;
  }): Promise<{ expiresAt: string }>;
  findMemberByDiscordId(discordUserId: string): Promise<DiscordMemberRecord | null>;
};

type Dependencies = {
  config: DiscordIntegrationConfig;
  store: DiscordIntegrationStore;
  createToken: () => { rawToken: string; tokenHash: string };
};

function databaseError(error: { message?: string } | null) {
  if (error) throw new DiscordIntegrationError("integration_unavailable", 503);
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
  };
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
  link.searchParams.set("token", token.rawToken);
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

export function discordErrorResponse(error: unknown) {
  if (error instanceof DiscordIntegrationError) {
    return { code: error.code, status: error.status };
  }
  return { code: "integration_unavailable", status: 503 };
}
