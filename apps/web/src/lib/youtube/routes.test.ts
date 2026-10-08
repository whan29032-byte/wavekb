// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as connectionGet, POST } from "@/app/api/youtube/[action]/route";
import { GET as callbackGet } from "@/app/api/youtube/callback/route";
import { youtubeStateCookie } from "./server";
import { parseYoutubeConnection, youtubeReadonlyScope } from "./contracts";

const boundary = vi.hoisted(() => ({ owner: "11111111-1111-4111-8111-111111111111", token: "private-user-token", configured: true }));
vi.mock("@/lib/env", () => ({ publicSupabaseConfig: () => ({ configured: boundary.configured }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: boundary.owner ? { id: boundary.owner } : null }, error: null }), getSession: async () => ({ data: { session: boundary.token ? { access_token: boundary.token } : null }, error: null }) } }) }));
const fetchMock = vi.fn();
const state = "a".repeat(43);
const connection = { id: "22222222-2222-4222-8222-222222222222", channelId: "UCabcdefghijklmnopqrstuv", channelTitle: "研究频道", syncEnabled: false, importHistory: true, historyStatus: "pending", historyImported: 0, status: "connected", lastSyncedAt: null, lastErrorCode: null };
const authorizeUrl = (scope = youtubeReadonlyScope) => `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&scope=${encodeURIComponent(scope)}&state=${state}&redirect_uri=${encodeURIComponent("https://wavekb.com/api/youtube/callback")}`;
const context = (action: string) => ({ params: Promise.resolve({ action }) });
const response = (body: object, status = 200) => new Response(JSON.stringify(body), { status });
const post = (action: string, body: object, origin = "https://wavekb.com") => new NextRequest(`https://wavekb.com/api/youtube/${action}`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); boundary.owner = "11111111-1111-4111-8111-111111111111"; boundary.token = "private-user-token"; boundary.configured = true; vi.stubEnv("AUTH_GATEWAY_INTERNAL_URL", "http://127.0.0.1:8787"); vi.stubEnv("AUTH_GATEWAY_PUBLIC_ORIGIN", "https://wavekb.com"); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("YouTube proxy privacy and OAuth state", () => {
  it("reports a real disabled response without exposing credentials", async () => {
    fetchMock.mockResolvedValue(response({ configured: false, connection: null, secret: "do-not-forward" }));
    const result = await connectionGet(new NextRequest("https://wavekb.com/api/youtube/connection"), context("connection"));
    expect(await result.json()).toEqual({ configured: false, connection: null }); expect(result.headers.get("cache-control")).toBe("no-store");
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8787/v1/youtube/connection"); expect(fetchMock.mock.calls[0][1].headers.authorization).toBe("Bearer private-user-token");
  });
  it("rejects unsupported paths, cross-origin writes, absent login and implicit consent without forwarding", async () => {
    expect((await POST(post("callback", {}), context("callback"))).status).toBe(404);
    expect((await POST(post("authorize", { autoSync: true, importHistory: true }, "https://evil.example"), context("authorize"))).status).toBe(403);
    expect((await POST(post("authorize", { autoSync: "true", importHistory: true }), context("authorize"))).status).toBe(400);
    boundary.owner = ""; expect((await POST(post("authorize", { autoSync: false, importHistory: true }), context("authorize"))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("stores owner-bound state only in a short-lived secure HttpOnly Lax cookie", async () => {
    fetchMock.mockResolvedValue(response({ authorizationUrl: authorizeUrl(), state, accessToken: "never-forward" }));
    const result = await POST(post("authorize", { autoSync: false, importHistory: true, actorId: "different-user", returnTo: "https://evil.example" }), context("authorize"));
    expect(result.status).toBe(200); expect(await result.json()).toEqual({ authorizationUrl: authorizeUrl() });
    const cookie = result.headers.get("set-cookie")!; expect(cookie).toContain(`${youtubeStateCookie}=${boundary.owner}.${state}`);
    for (const flag of ["HttpOnly", "Secure", "SameSite=lax", "Max-Age=600", "Path=/api/youtube/callback"]) expect(cookie).toContain(flag);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ autoSync: false, importHistory: true }); expect(fetchMock.mock.calls[0][1].redirect).toBe("error");
  });
  it.each(["https://evil.example/authorize", authorizeUrl(`${youtubeReadonlyScope} https://www.googleapis.com/auth/youtube.force-ssl`), authorizeUrl().replace(state, "b".repeat(43)), authorizeUrl().replace(encodeURIComponent("https://wavekb.com/api/youtube/callback"), encodeURIComponent("https://evil.example/callback"))])("rejects unsafe authorization response %s", async (url) => {
    fetchMock.mockResolvedValue(response({ authorizationUrl: url, state }));
    const result = await POST(post("authorize", { autoSync: false, importHistory: true }), context("authorize"));
    expect(result.status).toBe(503); expect(result.headers.get("set-cookie")).toBeNull();
    expect(JSON.stringify(await result.json())).not.toContain(url);
  });
  it("only completes OAuth for the same logged-in owner/state and clears the cookie", async () => {
    fetchMock.mockResolvedValue(response({ connection: { ...connection, refreshToken: "never-forward" } }));
    const request = new NextRequest(`https://wavekb.com/api/youtube/callback?code=4%2Fsecret-oauth-code&state=${state}&next=https://evil.example`, { headers: { cookie: `${youtubeStateCookie}=${boundary.owner}.${state}` } });
    const result = await callbackGet(request);
    expect(result.headers.get("location")).toBe("/member/profile?youtube=connected"); expect(result.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(result.headers.get("referrer-policy")).toBe("no-referrer"); expect(await result.text()).toBe("");
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8787/v1/youtube/callback"); expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ code: "4/secret-oauth-code", state });
  });
  it.each(["missing", "different-owner", "different-state", "duplicate-state", "invalid-code"])("does not exchange callback code with %s", async (kind) => {
    const cookie = kind === "missing" ? "" : `${youtubeStateCookie}=${kind === "different-owner" ? "other" : boundary.owner}.${kind === "different-state" ? "b".repeat(43) : state}`;
    const request = new NextRequest(`https://wavekb.com/api/youtube/callback?code=${kind === "invalid-code" ? "%0Asecret" : "secret-code"}&state=${state}${kind === "duplicate-state" ? `&state=${state}` : ""}`, { headers: { cookie } });
    const result = await callbackGet(request); expect(result.headers.get("location")).toBe("/member/profile?youtube=error&youtube_error=youtube_state_invalid"); expect(result.headers.get("set-cookie")).toContain("Max-Age=0"); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not leak cancellation parameters or raw provider failures", async () => {
    const request = new NextRequest(`https://wavekb.com/api/youtube/callback?error=access_denied&error_description=secret&state=${state}`, { headers: { cookie: `${youtubeStateCookie}=${boundary.owner}.${state}` } });
    expect((await callbackGet(request)).headers.get("location")).toBe("/member/profile?youtube=cancelled"); expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(response({ error: "secret provider output", token: "never-forward" }, 500));
    const result = await POST(post("settings", { syncEnabled: false }), context("settings")); expect(await result.json()).toEqual({ error: "youtube_request_failed" });
  });
  it.each(["youtube_channel_selection_required", "youtube_refresh_token_missing", "youtube_state_invalid", "provider secret token"]) ("redirects callback failure with only a whitelisted safe code: %s", async (error) => {
    fetchMock.mockResolvedValue(response({ error, accessToken: "never-forward", detail: "provider secret token" }, 409));
    const request = new NextRequest(`https://wavekb.com/api/youtube/callback?code=4%2Fsecret-oauth-code&state=${state}`, { headers: { cookie: `${youtubeStateCookie}=${boundary.owner}.${state}` } });
    const result = await callbackGet(request);
    expect(result.headers.get("location")).toBe(`/member/profile?youtube=error&youtube_error=${error.startsWith("youtube_") ? error : "youtube_request_failed"}`);
    expect(result.headers.get("location")).not.toContain("secret");
    expect(result.headers.get("location")).not.toContain(state);
    expect(result.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await result.text()).toBe("");
  });
  it("requires explicit destructive confirmation and strips returned provider fields", async () => {
    expect((await POST(post("disconnect", { confirmRemoveSyncedPosts: false }), context("disconnect"))).status).toBe(400); expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(response({ disconnected: true, removedPosts: 2, refreshToken: "never-forward" }));
    const result = await POST(post("disconnect", { confirmRemoveSyncedPosts: true }), context("disconnect")); expect(await result.json()).toEqual({ disconnected: true, removedPosts: 2, remoteRevocationPending: false });
    expect(parseYoutubeConnection({ ...connection, accessToken: "never-forward" })).toEqual(connection);
  });
  it("preserves pending remote revocation without exposing its retry credentials", async () => {
    fetchMock.mockResolvedValue(response({ disconnected: true, removedPosts: 2, remoteRevocationPending: true, refreshToken: "never-forward" }));
    const result = await POST(post("disconnect", { confirmRemoveSyncedPosts: true }), context("disconnect"));
    expect(await result.json()).toEqual({ disconnected: true, removedPosts: 2, remoteRevocationPending: true });
    fetchMock.mockResolvedValue(response({ configured: false, connection: { ...connection, status: "revocation_pending", lastErrorCode: "youtube_revocation_pending", refreshToken: "never-forward" } }));
    const read = await connectionGet(new NextRequest("https://wavekb.com/api/youtube/connection"), context("connection"));
    expect(await read.json()).toEqual({ configured: false, connection: { ...connection, status: "revocation_pending", lastErrorCode: "youtube_revocation_pending" } });
  });
  it("accepts redacted channel metadata after revocation or refresh expiry but rejects an empty connected ID", async () => {
    for (const status of ["revocation_pending", "reconnect_required"]) {
      const actual = { ...connection, status, channelId: "", channelTitle: "" };
      fetchMock.mockResolvedValueOnce(response({ configured: false, connection: actual }));
      const result = await connectionGet(new NextRequest("https://wavekb.com/api/youtube/connection"), context("connection"));
      expect(result.status).toBe(200); expect(await result.json()).toEqual({ configured: false, connection: actual });
    }
    expect(parseYoutubeConnection({ ...connection, channelTitle: "" })).toEqual({ ...connection, channelTitle: "" });
    expect(() => parseYoutubeConnection({ ...connection, channelId: "" })).toThrow("youtube_response_invalid");
  });
});
