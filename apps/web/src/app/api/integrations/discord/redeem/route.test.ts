import { beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: boundary.getUser }, rpc: boundary.rpc }),
}));

import { POST } from "./route";

const token = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc";
const tokenHash = "dc4bf80c77473d130fa0de86ba4018fe98bb214005e6a5891d12ba91446f9e81";

function request(rawToken = token, origin = "https://wavekb.com") {
  return new Request("https://wavekb.com/api/integrations/discord/redeem", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin,
      "sec-fetch-site": origin === "https://wavekb.com" ? "same-origin" : "cross-site",
    },
    body: new URLSearchParams({ token: rawToken }),
  });
}

beforeEach(() => {
  boundary.getUser.mockReset().mockResolvedValue({
    data: { user: { id: "11111111-1111-4111-8111-111111111111" } },
    error: null,
  });
  boundary.rpc.mockReset().mockResolvedValue({
    data: { public_uid: 583104, discord_user_id: "111111111111111111" },
    error: null,
  });
});

describe("POST /api/integrations/discord/redeem", () => {
  it("rejects a cross-origin form before accessing the authenticated client", async () => {
    const response = await POST(request(token, "https://attacker.example"));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "cross_origin_request" });
    expect(boundary.getUser).not.toHaveBeenCalled();
    expect(boundary.rpc).not.toHaveBeenCalled();
  });

  it("rejects a state-changing form without an explicit browser Origin", async () => {
    const response = await POST(new Request("https://wavekb.com/api/integrations/discord/redeem", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    }));
    expect(response.status).toBe(403);
    expect(boundary.getUser).not.toHaveBeenCalled();
    expect(boundary.rpc).not.toHaveBeenCalled();
  });

  it("redirects an expired login session without putting the binding token in a URL", async () => {
    boundary.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await POST(request());
    expect(response.status).toBe(303);
    const location = response.headers.get("location") ?? "";
    expect(location).toContain("/login?next=");
    expect(decodeURIComponent(location)).toContain("/account/discord-link");
    expect(location).not.toContain(token);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(boundary.rpc).not.toHaveBeenCalled();
  });

  it("redeems the token hash and redirects to a URL that no longer contains the raw token", async () => {
    const response = await POST(request());
    expect(boundary.rpc).toHaveBeenCalledWith("redeem_discord_link_token", {
      p_token_hash: tokenHash,
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://wavekb.com/account/discord-link?status=linked");
    expect(response.headers.get("location")).not.toContain(token);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("rejects a malformed token without calling the database RPC", async () => {
    const response = await POST(request("not-valid"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://wavekb.com/account/discord-link?status=invalid");
    expect(boundary.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["discord_link_token_expired", "expired"],
    ["discord_link_token_used", "used"],
    ["discord_link_token_revoked", "revoked"],
    ["discord_identity_already_linked", "conflict"],
    ["account_restricted", "restricted"],
    ["unexpected_database_error", "error"],
  ])("maps %s to the stable %s page state", async (message, status) => {
    boundary.rpc.mockResolvedValue({ data: null, error: { message } });
    const response = await POST(request());
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `https://wavekb.com/account/discord-link?status=${status}`,
    );
  });
});
