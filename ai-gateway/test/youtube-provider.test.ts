import assert from "node:assert/strict";
import test from "node:test";
import { loadYouTubeSyncConfig } from "../src/youtube/config.ts";
import { GoogleYouTubeProvider, YouTubeProviderError, YOUTUBE_READONLY_SCOPE } from "../src/youtube/provider.ts";

const env = {
  YOUTUBE_SYNC_ENABLED: "true", YOUTUBE_OAUTH_CLIENT_ID: "test.apps.googleusercontent.com",
  YOUTUBE_OAUTH_CLIENT_SECRET: "synthetic-client-secret", YOUTUBE_OAUTH_REDIRECT_URI: "https://wavekb.com/api/integrations/youtube/callback",
  YOUTUBE_TOKEN_MASTER_KEY: Buffer.alloc(32, 17).toString("base64"),
  SUPABASE_URL: "https://database.example.test", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-role",
};
const config = loadYouTubeSyncConfig(env);
const channel = `UC${"a".repeat(22)}`, otherChannel = `UC${"b".repeat(22)}`;
const firstVideo = "abcdefghijk", secondVideo = "lmnopqrstuv";
const tokens = { access_token: "synthetic-access-token", refresh_token: "synthetic-refresh-token", expires_in: 3600, token_type: "Bearer", scope: YOUTUBE_READONLY_SCOPE };
const json = (body: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(body), { status, ...(headers ? { headers } : {}) });
const detail = (id: string, privacy = "public", idChannel = channel) => ({
  id, snippet: { channelId: idChannel, title: "Original title", description: "Original description", publishedAt: "2024-01-01T00:00:00Z" },
  status: { privacyStatus: privacy, embeddable: true },
});

test("YouTube configuration is disabled by default and incomplete setup cannot become ready", () => {
  assert.equal(loadYouTubeSyncConfig({}).readiness, "disabled");
  const missing = loadYouTubeSyncConfig({ YOUTUBE_SYNC_ENABLED: "true" });
  assert.equal(missing.readiness, "unconfigured");
  assert.equal(missing.pollMs, 600_000);
  assert.equal(config.readiness, "ready");
  assert.equal(config.maxPagesPerConnection, 2);
  assert.equal(config.maxCallsPerPoll, 20);
  assert.equal(config.batchSize, 50);
  assert.equal(loadYouTubeSyncConfig({ ...env, AUTH_SITE_URL: "https://unrelated.invalid" }).redirectUri, config.redirectUri);
});

test("configuration requires an independent 32-byte key, fixed HTTPS callback and bounded capacity", () => {
  for (const patch of [
    { YOUTUBE_SYNC_ENABLED: "yes" }, { YOUTUBE_TOKEN_MASTER_KEY: "synthetic-private@example.test" },
    { YOUTUBE_OAUTH_REDIRECT_URI: "http://wavekb.com/callback" }, { YOUTUBE_OAUTH_REDIRECT_URI: "https://user:secret@wavekb.com/callback" },
    { YOUTUBE_OAUTH_REDIRECT_URI: "https://wavekb.com/callback?next=https://other.invalid" },
    { SUPABASE_URL: "https://database.example.test/other" }, { YOUTUBE_SYNC_POLL_SECONDS: "299" },
    { YOUTUBE_SYNC_POLL_SECONDS: "901" }, { YOUTUBE_SYNC_MAX_PAGES_PER_CONNECTION: "6" },
    { YOUTUBE_SYNC_MAX_PAGES_PER_CONNECTION: "1" }, { YOUTUBE_SYNC_MAX_CALLS_PER_POLL: "6" },
    { YOUTUBE_SYNC_MAX_CALLS_PER_POLL: "101" }, { YOUTUBE_SYNC_BATCH_SIZE: "51" },
    { YOUTUBE_SYNC_BATCH_SIZE: "1", YOUTUBE_SYNC_MAX_CALLS_PER_POLL: "20" },
    { YOUTUBE_OAUTH_CLIENT_SECRET: "synthetic secret" },
  ]) assert.throws(() => loadYouTubeSyncConfig({ ...env, ...patch }), (error: unknown) => (
    error instanceof Error && error.message === "youtube_configuration_invalid"
  ));
});

test("OAuth authorization requests only readonly, offline and S256 with a fixed callback", () => {
  const provider = new GoogleYouTubeProvider(config, async () => { throw new Error("must not fetch"); });
  const url = new URL(provider.authorizationUrl({ state: "s".repeat(43), codeChallenge: "c".repeat(43) }));
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.pathname, "/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("scope"), YOUTUBE_READONLY_SCOPE);
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("redirect_uri"), config.redirectUri);
  assert.throws(() => provider.authorizationUrl({ state: "arbitrary", codeChallenge: "c".repeat(43) }));
  assert.throws(() => new GoogleYouTubeProvider(loadYouTubeSyncConfig({})).authorizationUrl({ state: "s".repeat(43), codeChallenge: "c".repeat(43) }));
});

test("code exchange uses the server secret and PKCE verifier only at the fixed Google token endpoint", async () => {
  const requests: { url: string; options?: RequestInit }[] = [];
  const fetchImpl: typeof fetch = async (url, options) => { requests.push({ url: String(url), ...(options ? { options } : {}) }); return json(tokens); };
  const provider = new GoogleYouTubeProvider(config, fetchImpl);
  assert.deepEqual(await provider.exchangeCode({ code: "synthetic-code", codeVerifier: "v".repeat(43), redirectUri: config.redirectUri }), {
    accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresIn: 3600, scope: YOUTUBE_READONLY_SCOPE,
  });
  assert.equal(requests[0]?.url, "https://oauth2.googleapis.com/token");
  assert.equal(requests[0]?.options?.redirect, "error");
  assert.ok(requests[0]?.options?.signal instanceof AbortSignal);
  const body = new URLSearchParams(String(requests[0]?.options?.body));
  assert.equal(body.get("code_verifier"), "v".repeat(43));
  assert.equal(body.get("client_secret"), env.YOUTUBE_OAUTH_CLIENT_SECRET);
  assert.equal(body.get("redirect_uri"), config.redirectUri);
  await assert.rejects(provider.exchangeCode({ code: "synthetic-code", codeVerifier: "v".repeat(43), redirectUri: "https://attacker.invalid" }));
  assert.equal(requests.length, 1);
});

test("refresh and revoke are real protocol adapters, not fabricated successes, and disabled setup never fetches", async () => {
  const requests: { url: string; body: URLSearchParams }[] = [];
  const provider = new GoogleYouTubeProvider(config, async (url, options) => {
    requests.push({ url: String(url), body: new URLSearchParams(String(options?.body)) });
    return String(url).endsWith("/revoke") ? new Response("") : json({ ...tokens, refresh_token: undefined, scope: undefined });
  });
  const refreshed = await provider.refreshToken("synthetic-refresh-token");
  assert.equal(refreshed.accessToken, tokens.access_token);
  assert.equal(refreshed.refreshToken, undefined);
  assert.equal(requests[0]?.body.get("grant_type"), "refresh_token");
  await provider.revokeToken("synthetic-refresh-token");
  assert.equal(requests[1]?.url, "https://oauth2.googleapis.com/revoke");
  assert.equal(requests[1]?.body.get("token"), "synthetic-refresh-token");
  let fetched = false;
  await assert.rejects(new GoogleYouTubeProvider(loadYouTubeSyncConfig({}), async () => { fetched = true; return json(tokens); }).refreshToken("synthetic-refresh-token"));
  assert.equal(fetched, false);
});

test("disabled import may revoke an existing token with key/database config, but cannot authorize, exchange, refresh or read videos", async () => {
  const maintenance = loadYouTubeSyncConfig({
    YOUTUBE_TOKEN_MASTER_KEY: env.YOUTUBE_TOKEN_MASTER_KEY,
    SUPABASE_URL: env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
  });
  assert.equal(maintenance.readiness, "disabled");
  assert.equal(maintenance.revocationReady, true);
  const requests: string[] = [];
  const provider = new GoogleYouTubeProvider(maintenance, async (url) => { requests.push(String(url)); return new Response(""); });
  await provider.revokeToken("synthetic-refresh-token");
  await assert.rejects(provider.refreshToken("synthetic-refresh-token"), /oauth_configuration_invalid/);
  await assert.rejects(provider.exchangeCode({ code: "synthetic-code", codeVerifier: "v".repeat(43) }), /oauth_configuration_invalid/);
  await assert.rejects(provider.publicVideos([firstVideo], "synthetic-access-token"), /oauth_configuration_invalid/);
  assert.throws(() => provider.authorizationUrl({ state: "s".repeat(43), codeChallenge: "c".repeat(43) }), /oauth_configuration_invalid/);
  assert.deepEqual(requests, ["https://oauth2.googleapis.com/revoke"]);
});

test("owned channels use OAuth mine=true and provider-returned upload playlists, never handle or browser ownership claims", async () => {
  const provider = new GoogleYouTubeProvider(config, async (raw, options) => {
    const url = new URL(String(raw));
    assert.equal(url.origin, "https://www.googleapis.com");
    assert.equal(url.pathname, "/youtube/v3/channels");
    assert.equal(url.searchParams.get("mine"), "true");
    assert.equal(url.searchParams.has("id"), false);
    assert.equal(new Headers(options?.headers).get("authorization"), "Bearer synthetic-access-token");
    return json({ items: [{ id: channel, snippet: { title: "Verified channel" }, contentDetails: { relatedPlaylists: { uploads: "UUaaaaaaaaaaaaaaaaaaaaaa" } } }] });
  });
  assert.deepEqual(await provider.ownedChannels("synthetic-access-token"), [{ id: channel, title: "Verified channel", uploadsPlaylistId: "UUaaaaaaaaaaaaaaaaaaaaaa" }]);
});

test("uploads preserve bounded opaque page cursors and deduplicate returned IDs", async () => {
  const provider = new GoogleYouTubeProvider(config, async (raw) => {
    const url = new URL(String(raw));
    assert.equal(url.pathname, "/youtube/v3/playlistItems");
    assert.equal(url.searchParams.get("pageToken"), "opaque-page-cursor");
    assert.equal(url.searchParams.get("maxResults"), "50");
    return json({ items: [{ contentDetails: { videoId: firstVideo } }, { contentDetails: { videoId: firstVideo } }], nextPageToken: "next-opaque-cursor" });
  });
  assert.deepEqual(await provider.listUploads({ accessToken: "synthetic-access-token", playlistId: "UUaaaaaaaaaaaaaaaaaaaaaa", pageToken: "opaque-page-cursor" }), {
    videoIds: [firstVideo], nextPageToken: "next-opaque-cursor",
  });
});

test("batch video lookups return only public, original bounded metadata and do not expose private/unlisted videos", async () => {
  const thirdVideo = "12345678901";
  const provider = new GoogleYouTubeProvider(config, async (raw) => {
    const url = new URL(String(raw));
    assert.equal(url.pathname, "/youtube/v3/videos");
    assert.equal(url.searchParams.get("part"), "snippet,status");
    return json({ items: [detail(firstVideo), detail(secondVideo, "private"), detail(thirdVideo, "unlisted")] });
  });
  const result = await provider.publicVideos([firstVideo, secondVideo, thirdVideo], "synthetic-access-token");
  assert.equal(result.length, 1);
  assert.equal(result[0]?.channelId, channel);
  assert.equal(result[0]?.description, "Original description");
  assert.equal(result[0]?.publishedAt, "2024-01-01T00:00:00Z");
  assert.equal(result[0]?.privacyStatus, "public");
});

test("malformed, duplicate, unrequested or overlong metadata fails the entire batch so it cannot cause false deletion", async () => {
  for (const body of [
    { items: [detail(secondVideo)] }, { items: [detail(firstVideo), detail(firstVideo)] },
    { items: [{ ...detail(firstVideo), snippet: { ...detail(firstVideo).snippet, title: "t".repeat(101) } }] },
    { items: [{ ...detail(firstVideo), snippet: { ...detail(firstVideo).snippet, description: "d".repeat(5001) } }] },
    { items: [{ ...detail(firstVideo), snippet: { ...detail(firstVideo).snippet, description: "中".repeat(1667) } }] },
    { items: [{ ...detail(firstVideo), snippet: { ...detail(firstVideo).snippet, publishedAt: "invalid-time" } }] },
    { items: [detail(firstVideo, "unexpected")] },
    { items: [{ ...detail(firstVideo), snippet: { ...detail(firstVideo).snippet, channelId: "invalid" } }] },
  ]) await assert.rejects(new GoogleYouTubeProvider(config, async () => json(body)).publicVideos([firstVideo], "synthetic-access-token"), /provider_response_invalid/);
  const other = await new GoogleYouTubeProvider(config, async () => json({ items: [detail(firstVideo, "public", otherChannel)] })).publicVideos([firstVideo], "synthetic-access-token");
  assert.equal(other[0]?.channelId, otherChannel); // Worker/SQL must match the bound channel, not trust callback content.
});

test("metadata limits preserve a valid 100-codepoint emoji title and UTF-8 byte bounded Chinese description", async () => {
  const title = "😀".repeat(100), description = "中".repeat(1666);
  const body = { items: [{ ...detail(firstVideo), snippet: { ...detail(firstVideo).snippet, title, description } }] };
  const result = await new GoogleYouTubeProvider(config, async () => json(body)).publicVideos([firstVideo], "synthetic-access-token");
  assert.equal(result[0]?.title, title);
  assert.equal(result[0]?.description, description);
});

test("provider errors are static; quota is retryable and invalid_grant is a reconnect signal without token leakage", async () => {
  for (const example of [
    { status: 400, body: { error: "invalid_grant", error_description: "synthetic-token private@example.test" }, code: "invalid_grant", retryable: false },
    { status: 400, body: { error: "invalid_client" }, code: "oauth_configuration_invalid", retryable: false },
    { status: 403, body: { error: { errors: [{ reason: "quotaExceeded" }] } }, code: "quota_exceeded", retryable: true },
    { status: 429, body: {}, code: "quota_exceeded", retryable: true },
    { status: 503, body: {}, code: "provider_unavailable", retryable: true },
    { status: 403, body: {}, code: "oauth_denied", retryable: false },
  ]) {
    const provider = new GoogleYouTubeProvider(config, async () => json(example.body, example.status, { "retry-after": "999999" }));
    await assert.rejects(provider.refreshToken("synthetic-refresh-token"), (error: unknown) => {
      assert.ok(error instanceof YouTubeProviderError);
      assert.equal(error.code, example.code);
      assert.equal(error.retryable, example.retryable);
      assert.doesNotMatch(error.message, /synthetic-token|private@/);
      if (example.code === "quota_exceeded" || example.code === "provider_unavailable") assert.equal(error.retryAfterSeconds, 3600);
      return true;
    });
  }
  await assert.rejects(new GoogleYouTubeProvider(config, async () => { throw new Error("synthetic-token private@example.test"); }).refreshToken("synthetic-refresh-token"), /provider_unavailable/);
  await assert.rejects(new GoogleYouTubeProvider(config, async () => new Response("synthetic-token private@example.test", { status: 500 })).refreshToken("synthetic-refresh-token"), /provider_unavailable/);
  await assert.rejects(new GoogleYouTubeProvider(config, async () => new Response("not JSON")).refreshToken("synthetic-refresh-token"), /provider_response_invalid/);
});

test("unexpected OAuth scope/token shapes and invalid pagination cannot create success", async () => {
  for (const body of [{ ...tokens, scope: "openid" }, { ...tokens, scope: undefined }, { ...tokens, access_token: "header\ninjection" }, { ...tokens, expires_in: 0 }]) {
    await assert.rejects(new GoogleYouTubeProvider(config, async () => json(body)).exchangeCode({ code: "synthetic-code", codeVerifier: "v".repeat(43) }));
  }
  await assert.rejects(new GoogleYouTubeProvider(config, async () => json({ error: { errors: [{ reason: "invalidPageToken" }] } }, 400)).listUploads({
    accessToken: "synthetic-access-token", playlistId: "UUaaaaaaaaaaaaaaaaaaaaaa", pageToken: "stale-cursor",
  }), /pagination_cursor_invalid/);
});

test("Data API project configuration and access failures preserve the user grant rather than fabricating revocation", async () => {
  for (const reason of ["accessNotConfigured", "serviceDisabled", "forbidden"]) {
    const provider = new GoogleYouTubeProvider(config, async () => json({ error: { errors: [{ reason }], message: "synthetic-token private@example.test" } }, 403));
    await assert.rejects(provider.ownedChannels("synthetic-access-token"), (error: unknown) => {
      assert.ok(error instanceof YouTubeProviderError);
      assert.equal(error.code, "provider_access_unavailable");
      assert.equal(error.retryable, true);
      assert.doesNotMatch(error.message, /synthetic-|private@/);
      return true;
    });
  }
});
