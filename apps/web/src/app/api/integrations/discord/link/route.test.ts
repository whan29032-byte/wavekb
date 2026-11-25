import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorized: false,
  createLink: vi.fn(),
}));

vi.mock("@/lib/discord-integration/security", () => ({
  authorizeDiscordBot: () => mocks.authorized,
}));
vi.mock("@/lib/discord-integration/service", () => ({
  createDiscordLink: mocks.createLink,
  discordErrorResponse: (error: unknown) => error,
}));

import { POST } from "./route";

beforeEach(() => {
  mocks.authorized = false;
  mocks.createLink.mockReset();
});

describe("POST /api/integrations/discord/link", () => {
  it("rejects an unauthorized bot before creating a link", async () => {
    const response = await POST(new Request("https://wavekb.com/api/integrations/discord/link", {
      method: "POST",
      body: JSON.stringify({ discordUserId: "111111111111111111", guildId: "1545731927733047306" }),
    }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(mocks.createLink).not.toHaveBeenCalled();
  });

  it("returns a no-store link response for an authorized bot", async () => {
    mocks.authorized = true;
    mocks.createLink.mockResolvedValue({
      linkUrl: "https://wavekb.com/account/discord-link?token=raw",
      expiresAt: "2026-11-25T08:10:00.000Z",
    });
    const response = await POST(new Request("https://wavekb.com/api/integrations/discord/link", {
      method: "POST",
      body: JSON.stringify({ discordUserId: "111111111111111111", guildId: "1545731927733047306" }),
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      linkUrl: "https://wavekb.com/account/discord-link?token=raw",
      expiresAt: "2026-11-25T08:10:00.000Z",
    });
    expect(mocks.createLink).toHaveBeenCalledWith({
      discordUserId: "111111111111111111",
      guildId: "1545731927733047306",
      requestOrigin: "https://wavekb.com",
    });
  });

  it("rejects malformed JSON without invoking the service", async () => {
    mocks.authorized = true;
    const response = await POST(new Request("https://wavekb.com/api/integrations/discord/link", {
      method: "POST",
      body: "{",
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(mocks.createLink).not.toHaveBeenCalled();
  });

  it("returns a stable no-store error when atomic issuance is unavailable", async () => {
    mocks.authorized = true;
    mocks.createLink.mockRejectedValue({
      code: "integration_unavailable",
      status: 503,
      detail: "database detail must not escape",
    });
    const response = await POST(new Request("https://wavekb.com/api/integrations/discord/link", {
      method: "POST",
      body: JSON.stringify({
        discordUserId: "111111111111111111",
        guildId: "1545731927733047306",
      }),
    }));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "integration_unavailable" });
  });
});
