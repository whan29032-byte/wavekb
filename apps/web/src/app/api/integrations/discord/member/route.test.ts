import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorized: false,
  getMember: vi.fn(),
}));

vi.mock("@/lib/discord-integration/security", () => ({
  authorizeDiscordBot: () => mocks.authorized,
}));
vi.mock("@/lib/discord-integration/service", () => ({
  getDiscordMember: mocks.getMember,
  discordErrorResponse(error: unknown) {
    const value = error as { code?: string; status?: number };
    return { code: value.code ?? "integration_unavailable", status: value.status ?? 503 };
  },
}));

import { GET } from "./route";

beforeEach(() => {
  mocks.authorized = false;
  mocks.getMember.mockReset();
});

describe("GET /api/integrations/discord/member", () => {
  it("rejects unauthorized requests before reading a member", async () => {
    const response = await GET(new Request(
      "https://wavekb.com/api/integrations/discord/member?discordUserId=111111111111111111",
    ));
    expect(response.status).toBe(401);
    expect(mocks.getMember).not.toHaveBeenCalled();
  });

  it("returns the public member envelope with no-store caching", async () => {
    mocks.authorized = true;
    mocks.getMember.mockResolvedValue({
      uid: 583104,
      displayName: "悠悠",
      avatarUrl: null,
      displayTitle: null,
      nameplateStyle: "classic",
      points: { balance: 42, lifetimeEarned: 100 },
    });
    const response = await GET(new Request(
      "https://wavekb.com/api/integrations/discord/member?discordUserId=111111111111111111",
    ));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      linked: true,
      member: {
        uid: 583104,
        displayName: "悠悠",
        avatarUrl: null,
        displayTitle: null,
        nameplateStyle: "classic",
        points: { balance: 42, lifetimeEarned: 100 },
      },
    });
  });

  it("maps a service not-linked error to its stable status and code", async () => {
    mocks.authorized = true;
    mocks.getMember.mockRejectedValue({ code: "not_linked", status: 404 });
    const response = await GET(new Request(
      "https://wavekb.com/api/integrations/discord/member?discordUserId=111111111111111111",
    ));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_linked" });
  });
});
