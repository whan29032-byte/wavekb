import { describe, expect, it } from "vitest";
import {
  authorizeDiscordBot,
  createDiscordLinkToken,
  hashDiscordLinkToken,
  isDiscordLinkToken,
  isDiscordSnowflake,
  requireDiscordIntegrationConfig,
} from "./security";

describe("Discord integration security", () => {
  it("accepts only the exact Bearer secret", () => {
    const secret = "test-secret-value-that-is-long-enough";
    expect(authorizeDiscordBot(new Headers({ authorization: `Bearer ${secret}` }), secret)).toBe(true);
    expect(authorizeDiscordBot(new Headers({ authorization: "Bearer wrong-secret" }), secret)).toBe(false);
    expect(authorizeDiscordBot(new Headers({ authorization: secret }), secret)).toBe(false);
    expect(authorizeDiscordBot(new Headers(), secret)).toBe(false);
  });

  it("validates Discord snowflakes without accepting signs or whitespace", () => {
    expect(isDiscordSnowflake("1545731927733047306")).toBe(true);
    expect(isDiscordSnowflake("12345678901234567")).toBe(true);
    expect(isDiscordSnowflake(" 1545731927733047306")).toBe(false);
    expect(isDiscordSnowflake("+1545731927733047306")).toBe(false);
    expect(isDiscordSnowflake("123")).toBe(false);
  });

  it("creates a URL-safe raw token while exposing only its SHA-256 hash for storage", () => {
    const token = createDiscordLinkToken(() => Buffer.alloc(32, 7));
    expect(token.rawToken).toBe("BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc");
    expect(token.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(token.tokenHash).not.toContain(token.rawToken);
  });

  it("accepts only a 32-byte base64url link token and hashes it deterministically", () => {
    const rawToken = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc";
    expect(isDiscordLinkToken(rawToken)).toBe(true);
    expect(isDiscordLinkToken(`${rawToken}=`)).toBe(false);
    expect(isDiscordLinkToken("short-token")).toBe(false);
    expect(hashDiscordLinkToken(rawToken)).toBe(
      "dc4bf80c77473d130fa0de86ba4018fe98bb214005e6a5891d12ba91446f9e81",
    );
  });

  it("requires all server-only integration settings and normalizes the public origin", () => {
    const config = requireDiscordIntegrationConfig({
      DISCORD_BOT_API_SECRET: " bot-secret ",
      DISCORD_BOT_GUILD_ID: "1545731927733047306",
      SUPABASE_SERVICE_ROLE_KEY: " service-role ",
      DISCORD_LINK_PUBLIC_ORIGIN: "https://wavekb.com/",
    });
    expect(config).toEqual({
      apiSecret: "bot-secret",
      guildId: "1545731927733047306",
      serviceRoleKey: "service-role",
      publicOrigin: "https://wavekb.com",
    });
    expect(() => requireDiscordIntegrationConfig({
      DISCORD_BOT_API_SECRET: "secret",
      DISCORD_BOT_GUILD_ID: "not-a-snowflake",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
    })).toThrow(/DISCORD_BOT_GUILD_ID/);
    expect(() => requireDiscordIntegrationConfig({
      DISCORD_BOT_API_SECRET: "secret",
      DISCORD_BOT_GUILD_ID: "1545731927733047306",
      SUPABASE_SERVICE_ROLE_KEY: "",
    })).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});
