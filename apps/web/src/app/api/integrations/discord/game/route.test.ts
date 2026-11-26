import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorized: false,
  execute: vi.fn(),
}));

vi.mock("@/lib/discord-integration/security", () => ({
  authorizeDiscordBot: () => mocks.authorized,
}));
vi.mock("@/lib/discord-integration/service", () => ({
  executeDiscordGameAction: mocks.execute,
  discordErrorResponse(error: unknown) {
    const value = error as { code?: string; status?: number };
    return { code: value.code ?? "integration_unavailable", status: value.status ?? 503 };
  },
}));

import { POST } from "./route";

beforeEach(() => {
  mocks.authorized = false;
  mocks.execute.mockReset();
});

function request(body: string) {
  return new Request("https://wavekb.com/api/integrations/discord/game", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("POST /api/integrations/discord/game", () => {
  it("rejects unauthorized requests before parsing or executing a game action", async () => {
    const response = await POST(request("{"));
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("returns the stable game envelope for an authorized bot", async () => {
    mocks.authorized = true;
    mocks.execute.mockResolvedValue({ action: "daily_checkin", points: 8, balance: 208 });
    const body = {
      discordUserId: "111111111111111111",
      guildId: "1545731927733047306",
      requestId: "222222222222222222",
      action: "daily_checkin",
      payload: {},
    };
    const response = await POST(request(JSON.stringify(body)));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      ok: true,
      result: { action: "daily_checkin", points: 8, balance: 208 },
    });
    expect(mocks.execute).toHaveBeenCalledWith(body);
  });

  it("rejects malformed and oversized JSON before calling the service", async () => {
    mocks.authorized = true;
    const malformed = await POST(request("{"));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: "invalid_request" });
    const oversized = await POST(request(JSON.stringify({ payload: { value: "x".repeat(9000) } })));
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toEqual({ error: "request_too_large" });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("returns only the stable mapped service error", async () => {
    mocks.authorized = true;
    mocks.execute.mockRejectedValue({
      code: "insufficient_points",
      status: 409,
      detail: "wallet and SQL detail must not escape",
    });
    const response = await POST(request(JSON.stringify({
      discordUserId: "111111111111111111",
      guildId: "1545731927733047306",
      requestId: "222222222222222222",
      action: "skill_draw",
      payload: { path: "esper", count: 1 },
    })));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "insufficient_points" });
  });
});
