import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  DiscordIntegrationError,
  createDiscordLink,
  createSupabaseDiscordStore,
  executeDiscordGameAction,
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
    async executeGameAction(input) {
      calls.push({ operation: "game", value: input });
      return { action: input.action };
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

describe("executeDiscordGameAction", () => {
  it("validates and forwards one allowlisted action to the atomic store operation", async () => {
    const database = store({
      async executeGameAction(input) {
        return { action: input.action, balance: 875, stake: 125 };
      },
    });
    await expect(executeDiscordGameAction({
      discordUserId: "111111111111111111",
      guildId: config.guildId,
      requestId: "222222222222222222",
      action: "market_bet",
      payload: { symbol: "academy", direction: "up", stake: 125 },
    }, { config, store: database.value })).resolves.toEqual({
      action: "market_bet",
      balance: 875,
      stake: 125,
    });
  });

  it("maps a game action to exactly one restricted database RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { action: "skill_draw", cost: 100 },
      error: null,
    });
    const client = {
      rpc,
      from: vi.fn(() => { throw new Error("direct game table access is forbidden"); }),
    } as unknown as SupabaseClient;
    const database = createSupabaseDiscordStore(client);
    await expect(database.executeGameAction({
      discordUserId: "111111111111111111",
      requestId: "222222222222222222",
      action: "skill_draw",
      payload: { path: "esper", count: 1 },
    })).resolves.toEqual({ action: "skill_draw", cost: 100 });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("discord_game_action", {
      p_discord_user_id: "111111111111111111",
      p_request_id: "222222222222222222",
      p_action: "skill_draw",
      p_payload: { path: "esper", count: 1 },
    });
  });

  it("rejects wrong guilds, invalid request IDs and unrecognized actions before storage", async () => {
    const database = store();
    await expect(executeDiscordGameAction({
      discordUserId: "111111111111111111",
      guildId: "999999999999999999",
      requestId: "222222222222222222",
      action: "status",
      payload: {},
    }, { config, store: database.value })).rejects.toMatchObject({ code: "guild_not_allowed", status: 403 });
    await expect(executeDiscordGameAction({
      discordUserId: "111111111111111111",
      guildId: config.guildId,
      requestId: "not-an-interaction",
      action: "status",
      payload: {},
    }, { config, store: database.value })).rejects.toMatchObject({ code: "invalid_request_id", status: 400 });
    await expect(executeDiscordGameAction({
      discordUserId: "111111111111111111",
      guildId: config.guildId,
      requestId: "222222222222222222",
      action: "transfer_points",
      payload: {},
    }, { config, store: database.value })).rejects.toMatchObject({ code: "invalid_game_action", status: 400 });
    expect(database.calls).toEqual([]);
  });

  it("strictly rejects unexpected or out-of-range payload fields", async () => {
    const database = store();
    const base = {
      discordUserId: "111111111111111111",
      guildId: config.guildId,
      requestId: "222222222222222222",
    };
    await expect(executeDiscordGameAction({
      ...base,
      action: "skill_draw",
      payload: { path: "esper", count: 2 },
    }, { config, store: database.value })).rejects.toMatchObject({ code: "invalid_game_payload", status: 400 });
    await expect(executeDiscordGameAction({
      ...base,
      action: "market_bet",
      payload: { symbol: "academy", direction: "up", stake: 9, admin: true },
    }, { config, store: database.value })).rejects.toMatchObject({ code: "invalid_game_payload", status: 400 });
    await expect(executeDiscordGameAction({
      ...base,
      action: "pet_list",
      payload: { page: 2 },
    }, { config, store: database.value })).resolves.toEqual({ action: "pet_list" });
    await expect(executeDiscordGameAction({
      ...base,
      action: "pet_list",
      payload: { page: 0 },
    }, { config, store: database.value })).rejects.toMatchObject({ code: "invalid_game_payload", status: 400 });
    expect(database.calls).toEqual([{
      operation: "game",
      value: {
        discordUserId: "111111111111111111",
        requestId: "222222222222222222",
        action: "pet_list",
        payload: { page: 2 },
      },
    }]);
  });

  it("maps known game conflicts without leaking unknown database details", async () => {
    const cooldownRpc = vi.fn().mockResolvedValue({ data: null, error: { message: "work_cooldown" } });
    const cooldownStore = createSupabaseDiscordStore({ rpc: cooldownRpc } as unknown as SupabaseClient);
    await expect(cooldownStore.executeGameAction({
      discordUserId: "111111111111111111",
      requestId: "222222222222222222",
      action: "work",
      payload: { path: "esper" },
    })).rejects.toMatchObject({ code: "work_cooldown", status: 429 });

    const unknownRpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "password=secret; internal SQL failed" },
    });
    const unknownStore = createSupabaseDiscordStore({ rpc: unknownRpc } as unknown as SupabaseClient);
    await expect(unknownStore.executeGameAction({
      discordUserId: "111111111111111111",
      requestId: "222222222222222222",
      action: "status",
      payload: {},
    })).rejects.toEqual(new DiscordIntegrationError("integration_unavailable", 503));
  });
});
