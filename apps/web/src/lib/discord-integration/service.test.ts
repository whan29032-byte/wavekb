import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  DiscordIntegrationError,
  createDiscordLink,
  createSupabaseDiscordStore,
  getDiscordMember,
  type DiscordIntegrationStore,
} from "./service";

const config = {
  apiSecret: "bot-secret-value-that-is-at-least-32-bytes",
  guildId: "1545731927733047306",
  serviceRoleKey: "service-role",
  publicOrigin: "https://wavekb.com",
};

function store(overrides: Partial<DiscordIntegrationStore> = {}) {
  const calls: Array<{ operation: string; value: unknown }> = [];
  const value: DiscordIntegrationStore = {
    async issueLink(input) {
      calls.push({ operation: "issue", value: input });
      return { expiresAt: "2026-11-25T08:10:00.000Z" };
    },
    async findMemberByDiscordId(discordUserId) {
      calls.push({ operation: "find", value: discordUserId });
      return null;
    },
    ...overrides,
  };
  return { value, calls };
}

describe("createDiscordLink", () => {
  it("uses one atomic store operation and returns its database-computed expiry", async () => {
    const database = store();
    const result = await createDiscordLink(
      { discordUserId: "111111111111111111", guildId: config.guildId, requestOrigin: "https://ignored.test" },
      {
        config,
        store: database.value,
        createToken: () => ({ rawToken: "raw-link-token", tokenHash: "a".repeat(64) }),
      },
    );

    expect(result).toEqual({
      linkUrl: "https://wavekb.com/account/discord-link#token=raw-link-token",
      expiresAt: "2026-11-25T08:10:00.000Z",
    });
    expect(database.calls).toEqual([
      {
        operation: "issue",
        value: {
          tokenHash: "a".repeat(64),
          discordUserId: "111111111111111111",
          guildId: config.guildId,
        },
      },
    ]);
    expect(JSON.stringify(database.calls)).not.toContain("raw-link-token");
  });

  it("maps issuance to one restricted database RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: "2026-11-25T08:10:00.000Z",
      error: null,
    });
    const client = {
      rpc,
      from: vi.fn(() => { throw new Error("table writes must not be used for issuance"); }),
    } as unknown as SupabaseClient;
    const database = createSupabaseDiscordStore(client);

    await expect(database.issueLink({
      tokenHash: "b".repeat(64),
      discordUserId: "111111111111111111",
      guildId: config.guildId,
    })).resolves.toEqual({ expiresAt: "2026-11-25T08:10:00.000Z" });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("issue_discord_link_token", {
      p_token_hash: "b".repeat(64),
      p_discord_user_id: "111111111111111111",
      p_guild_id: config.guildId,
    });
  });

  it("rejects invalid identities and a server outside the configured guild", async () => {
    const database = store();
    await expect(createDiscordLink(
      { discordUserId: "bad", guildId: config.guildId, requestOrigin: "https://wavekb.com" },
      { config, store: database.value },
    )).rejects.toMatchObject({ code: "invalid_discord_user", status: 400 });
    await expect(createDiscordLink(
      { discordUserId: "111111111111111111", guildId: "999999999999999999", requestOrigin: "https://wavekb.com" },
      { config, store: database.value },
    )).rejects.toMatchObject({ code: "guild_not_allowed", status: 403 });
    expect(database.calls).toEqual([]);
  });
});

describe("getDiscordMember", () => {
  it("returns only the public allowlisted identity and wallet fields", async () => {
    const database = store({
      async findMemberByDiscordId() {
        return {
          id: "internal-user-uuid",
          publicUid: 583104,
          displayName: "悠悠",
          avatarUrl: "https://cdn.example/avatar.png",
          displayTitle: "结构观察者",
          nameplateStyle: "blackgold",
          accountStatus: "active",
          balance: 320,
          lifetimeEarned: 900,
        };
      },
    });
    const result = await getDiscordMember("111111111111111111", {
      config,
      store: database.value,
    });
    expect(result).toEqual({
      uid: 583104,
      displayName: "悠悠",
      avatarUrl: "https://cdn.example/avatar.png",
      displayTitle: "结构观察者",
      nameplateStyle: "blackgold",
      points: { balance: 320, lifetimeEarned: 900 },
    });
    expect(result).not.toHaveProperty("id");
    expect(result).not.toHaveProperty("accountStatus");
  });

  it("distinguishes unlinked and restricted accounts without returning profile data", async () => {
    const missing = store();
    await expect(getDiscordMember("111111111111111111", {
      config,
      store: missing.value,
    })).rejects.toEqual(new DiscordIntegrationError("not_linked", 404));

    const banned = store({
      async findMemberByDiscordId() {
        return {
          id: "internal",
          publicUid: 10001,
          displayName: "Blocked",
          avatarUrl: null,
          displayTitle: null,
          nameplateStyle: "classic",
          accountStatus: "banned",
          balance: null,
          lifetimeEarned: null,
        };
      },
    });
    await expect(getDiscordMember("111111111111111111", {
      config,
      store: banned.value,
    })).rejects.toEqual(new DiscordIntegrationError("account_restricted", 403));
  });

  it("normalizes a missing wallet to zero points", async () => {
    const database = store({
      async findMemberByDiscordId() {
        return {
          id: "internal",
          publicUid: 10001,
          displayName: "No wallet",
          avatarUrl: null,
          displayTitle: null,
          nameplateStyle: "classic",
          accountStatus: "active",
          balance: null,
          lifetimeEarned: null,
        };
      },
    });
    const result = await getDiscordMember("111111111111111111", {
      config,
      store: database.value,
    });
    expect(result.points).toEqual({ balance: 0, lifetimeEarned: 0 });
  });
});
