import assert from "node:assert/strict";
import test from "node:test";
import { loadYouTubeSyncConfig } from "../src/youtube/config.ts";
import type { PublicVideo, SyncConnection, YouTubeProvider } from "../src/youtube/contracts.ts";
import { decryptYouTubeSecret } from "../src/youtube/crypto.ts";
import { YouTubeProviderError } from "../src/youtube/provider.ts";
import type { CommitYouTubePage, YouTubeSyncRepository } from "../src/youtube/repository.ts";
import { YouTubeSyncWorker } from "../src/youtube/worker.ts";

const env = {
  YOUTUBE_SYNC_ENABLED: "true", YOUTUBE_OAUTH_CLIENT_ID: "test.apps.googleusercontent.com",
  YOUTUBE_OAUTH_CLIENT_SECRET: "synthetic-client-secret", YOUTUBE_OAUTH_REDIRECT_URI: "https://wavekb.com/api/integrations/youtube/callback",
  YOUTUBE_TOKEN_MASTER_KEY: Buffer.alloc(32, 17).toString("base64"), SUPABASE_URL: "https://database.example.test", SUPABASE_SERVICE_ROLE_KEY: "synthetic-role",
};
const config = loadYouTubeSyncConfig(env);
const channelId = `UC${"a".repeat(22)}`;
const firstId = "abcdefghijk", secondId = "lmnopqrstuv";
const connection: SyncConnection = {
  id: "00000000-0000-4000-8000-000000000001", ownerId: "00000000-0000-4000-8000-000000000002", channelId,
  uploadsPlaylistId: "UUaaaaaaaaaaaaaaaaaaaaaa", refreshSecret: { ciphertext: "synthetic", iv: "synthetic", auth_tag: "synthetic", key_version: 1 },
  historyCursor: null, pollCursor: null, historyComplete: false, syncEnabled: true, lastSyncedAt: null,
  syncSince: "2020-01-01T00:00:00Z",
  leaseWorkerId: "00000000-0000-4000-8000-000000000003",
};
const video = (id: string, boundChannel = channelId): PublicVideo => ({ id, channelId: boundChannel, title: "Original title", description: "Original description",
  publishedAt: "2024-01-01T00:00:00Z", privacyStatus: "public", embeddable: true });

function fixture(options: {
  config?: typeof config;
  connections?: SyncConnection[];
  oldIds?: string[];
  provider?: Partial<YouTubeProvider>;
  repository?: Partial<YouTubeSyncRepository>;
} = {}) {
  const events: string[] = [], logs: string[] = [], pages: CommitYouTubePage[] = [];
  const refreshed: { videos: PublicVideo[]; ids: string[] }[] = [];
  const releases: { code: string | null; retryAt: string | null }[] = [];
  const queue = options.connections ?? [{ ...connection }];
  let clock = Date.parse("2026-10-08T00:00:00Z");
  const provider: YouTubeProvider = {
    authorizationUrl() { return "https://accounts.google.com/unused"; },
    async exchangeCode() { throw new Error("unused"); },
    async refreshToken() { events.push("refresh"); return { accessToken: "synthetic-access", expiresIn: 3600, scope: "" }; },
    async revokeToken() { events.push("revoke"); },
    async ownedChannels() { events.push("mine"); return [{ id: channelId, title: "Owned", uploadsPlaylistId: connection.uploadsPlaylistId }]; },
    async listUploads({ pageToken }) { events.push(`uploads:${pageToken ?? "head"}`); return { videoIds: pageToken ? [secondId] : [firstId], nextPageToken: pageToken ? null : "next-cursor" }; },
    async publicVideos(ids) { events.push(`videos:${ids.join(",")}`); return ids.map((id) => video(id)); },
    ...options.provider,
  };
  const repository: YouTubeSyncRepository = {
    async claimRevocation() { return null; },
    async completeRevocation() { events.push("revocation-complete"); },
    async releaseRevocation() { events.push("revocation-release"); },
    async rotateRefreshSecret() { events.push("rotate-secret"); },
    async updateChannelMetadata() { events.push("update-channel"); },
    async cleanupStaleData() { events.push("cleanup"); },
    async claimSync() { events.push("claim"); const value = queue.shift(); return value ? { ...value } : null; },
    async commitPage(_id, _worker, page) { events.push(`commit:${page.mode}`); pages.push(page); return { imported: page.videos.length }; },
    async releaseSync(_id, _worker, code, retryAt) { events.push("release"); releases.push({ code: code ?? null, retryAt: retryAt ?? null }); },
    async markReconnect() { events.push("reconnect"); },
    async oldVideoIds() { events.push("old"); return options.oldIds ?? []; },
    async refreshOldVideos(_id, _worker, videos, ids) { events.push("refresh-old"); refreshed.push({ videos, ids }); },
    ...options.repository,
  };
  const worker = new YouTubeSyncWorker(options.config ?? config, { provider, repository, decrypt: () => "synthetic-refresh", workerId: connection.leaseWorkerId,
    log: (code) => logs.push(code), now: () => clock, wait: async (milliseconds) => { clock += milliseconds; } });
  return { worker, events, logs, pages, refreshed, releases, advance: (milliseconds: number) => { clock += milliseconds; }, queue };
}

test("disabled/unconfigured YouTube workers do not acquire leases, clean data or contact Google", async () => {
  for (const settings of [{}, { YOUTUBE_SYNC_ENABLED: "true" }]) {
    const f = fixture({ config: loadYouTubeSyncConfig(settings) });
    assert.equal(await f.worker.pollOnce(), 0);
    assert.equal(await f.worker.pollOnce(), 0);
    assert.deepEqual(f.events, []);
    assert.equal(f.logs.length, 1);
  }
});

test("disabled import with database configuration still runs retention cleanup but no lease or Google work", async () => {
  const f = fixture({ config: loadYouTubeSyncConfig({ SUPABASE_URL: env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY }) });
  assert.equal(await f.worker.pollOnce(), 0);
  assert.deepEqual(f.events, ["cleanup"]);
});

test("disabled or unconfigured import drains one existing revocation job but never claims a sync connection", async () => {
  for (const flag of ["false", "true"]) {
    const maintenance = loadYouTubeSyncConfig({ YOUTUBE_SYNC_ENABLED: flag, YOUTUBE_TOKEN_MASTER_KEY: env.YOUTUBE_TOKEN_MASTER_KEY,
      SUPABASE_URL: env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY });
    const f = fixture({ config: maintenance, repository: { async claimRevocation() {
      return { id: "00000000-0000-4000-8000-000000000004", ownerId: connection.ownerId, channelId, refreshSecret: connection.refreshSecret };
    } } });
    assert.equal(await f.worker.pollOnce(), 1);
    assert.deepEqual(f.events, ["cleanup", "revoke", "revocation-complete"]);
    assert.equal(f.queue.length, 1);
  }
});

test("initial full history reuses the freshly polled head and atomically commits opaque cursors", async () => {
  const f = fixture();
  assert.equal(await f.worker.pollOnce(), 1);
  assert.deepEqual(f.events.filter((event) => event.startsWith("uploads:")), ["uploads:head", "uploads:next-cursor"]);
  assert.deepEqual(f.pages.map((page) => [page.mode, page.expectedCursor, page.nextCursor, page.historyComplete]), [
    ["poll", null, null, false], ["history", null, "next-cursor", false], ["history", "next-cursor", null, true],
  ]);
  assert.deepEqual(f.pages[2]?.videos.map((item) => item.id), [secondId]);
  assert.deepEqual(f.events.slice(0, 4), ["cleanup", "claim", "refresh", "mine"]);
  assert.equal(f.releases[0]?.code, null);
});

test("long backfills still poll latest uploads each visit, then resume the independent history cursor", async () => {
  const f = fixture({ connections: [{ ...connection, historyCursor: "deep-history", pollCursor: "old-poll" }] });
  await f.worker.pollOnce();
  assert.deepEqual(f.events.filter((event) => event.startsWith("uploads:")), ["uploads:head", "uploads:deep-history"]);
  assert.equal(f.pages[0]?.expectedCursor, "old-poll");
  assert.equal(f.pages[0]?.nextCursor, null);
  assert.equal(f.pages[1]?.expectedCursor, "deep-history");
});

test("completed-history incremental scans resume multiple pages and return to head only at the end", async () => {
  const f = fixture({ connections: [{ ...connection, historyComplete: true, pollCursor: "resume" }], provider: {
    async listUploads({ pageToken }) { return { videoIds: [firstId], nextPageToken: pageToken === "resume" ? null : "head-next" }; },
  } });
  await f.worker.pollOnce();
  assert.deepEqual(f.pages.map((page) => [page.mode, page.expectedCursor, page.nextCursor]), [["poll", "resume", "resume"], ["poll", "resume", null]]);
});

test("a large completed-history channel sees a new head upload every poll while preserving and advancing its deep cursor", async () => {
  let latest = firstId;
  const cursors: Array<string | null> = [];
  const f = fixture({ config: { ...config, maxCallsPerPoll: 7 }, connections: [
    { ...connection, historyComplete: true, pollCursor: "page-150" },
    { ...connection, historyComplete: true, pollCursor: "page-151" },
  ], provider: {
    async listUploads({ pageToken }) {
      cursors.push(pageToken ?? null);
      return pageToken ? { videoIds: ["12345678901"], nextPageToken: pageToken === "page-150" ? "page-151" : "page-152" }
        : { videoIds: [latest], nextPageToken: "head-next" };
    },
  } });
  await f.worker.pollOnce();
  latest = secondId;
  f.advance(600_000);
  await f.worker.pollOnce();
  assert.deepEqual(cursors, [null, "page-150", null, "page-151"]);
  assert.deepEqual(f.pages.map((page) => [page.expectedCursor, page.nextCursor]), [
    ["page-150", "page-150"], ["page-150", "page-151"], ["page-151", "page-151"], ["page-151", "page-152"],
  ]);
  assert.equal(f.pages[0]?.videos[0]?.id, firstId);
  assert.equal(f.pages[2]?.videos[0]?.id, secondId);
});

test("a small completed-history channel needs only its head and does not re-fetch or retain a stale deep cursor", async () => {
  let calls = 0;
  const f = fixture({ connections: [{ ...connection, historyComplete: true, pollCursor: "old-large-cursor" }], provider: {
    async listUploads() { calls++; return { videoIds: [firstId], nextPageToken: null }; },
  } });
  await f.worker.pollOnce();
  assert.equal(calls, 1);
  assert.equal(f.pages[0]?.expectedCursor, "old-large-cursor");
  assert.equal(f.pages[0]?.nextCursor, null);
});

test("opting out of history does not accidentally import pre-binding head videos", async () => {
  const f = fixture({ connections: [{ ...connection, historyComplete: true, syncSince: "2026-10-08T00:00:00Z" }] });
  await f.worker.pollOnce();
  assert.ok(f.pages.length);
  assert.ok(f.pages.every((page) => page.videos.length === 0));
});

test("a rotated refresh token is persisted encrypted and bound to the same owner/channel before any next request", async () => {
  let decrypted = "";
  const f = fixture({ provider: { async refreshToken() { return { accessToken: "synthetic-access", refreshToken: "new-synthetic-refresh", expiresIn: 3600, scope: "" }; } },
    repository: { async rotateRefreshSecret(_id, _worker, secret) {
      decrypted = decryptYouTubeSecret(secret, Buffer.from(config.tokenMasterKey, "base64"), connection.ownerId, connection.channelId);
    } },
  });
  await f.worker.pollOnce();
  assert.equal(decrypted, "new-synthetic-refresh");
});

test("leased revoke jobs have priority; provider success completes them and network failure remains retryable", async () => {
  const job = { id: "00000000-0000-4000-8000-000000000004", ownerId: connection.ownerId, channelId, refreshSecret: connection.refreshSecret };
  for (const fail of [false, true]) {
    const actions: string[] = [];
    const f = fixture({ connections: [], provider: { async revokeToken() {
      actions.push("revoke");
      if (fail) throw new YouTubeProviderError("provider_unavailable", true);
    } }, repository: {
      async claimRevocation() { return job; },
      async completeRevocation() { actions.push("complete"); },
      async releaseRevocation(_id, _worker, code, retryAt) { actions.push("retry"); assert.equal(code, "provider_unavailable"); assert.ok(retryAt); },
    } });
    assert.equal(await f.worker.pollOnce(), 1);
    assert.deepEqual(actions, fail ? ["revoke", "retry"] : ["revoke", "complete"]);
    assert.equal(f.events.includes("refresh"), false);
  }
});

test("daily due-video checks remove missing/private public sources only after successful API results", async () => {
  const f = fixture({ connections: [{ ...connection, historyComplete: true, syncEnabled: false }], oldIds: [firstId], provider: {
    async publicVideos() { return []; },
  } });
  await f.worker.pollOnce();
  assert.deepEqual(f.refreshed, [{ videos: [], ids: [firstId] }]);
  assert.deepEqual(f.pages, []);
});

test("temporary API failure and foreign channel data never become deletion or public post evidence", async () => {
  for (const failure of [
    async () => { throw new YouTubeProviderError("provider_unavailable", true); },
    async () => [video(firstId, `UC${"b".repeat(22)}`)],
  ]) {
    const f = fixture({ oldIds: [firstId], provider: { publicVideos: failure } });
    await f.worker.pollOnce();
    assert.deepEqual(f.refreshed, []);
    assert.deepEqual(f.pages, []);
    assert.ok(f.releases[0]?.code);
    assert.equal(f.events.includes("reconnect"), false);
    assert.deepEqual(f.logs, ["youtube_sync_retry_scheduled"]);
  }
});

test("Google project/access 403 or resource 404 is not a revoked grant and cannot erase the binding or posts", async () => {
  for (const code of ["provider_access_unavailable", "oauth_denied", "channel_unavailable"] as const) {
    const f = fixture({ provider: { async ownedChannels() { throw new YouTubeProviderError(code, false); } } });
    await f.worker.pollOnce();
    assert.equal(f.events.includes("reconnect"), false);
    assert.deepEqual(f.pages, []);
    assert.deepEqual(f.refreshed, []);
    assert.equal(f.releases[0]?.code, code);
  }
});

test("revoked grant or missing channel ownership stops sync and invokes immediate authorized-data cleanup", async () => {
  for (const provider of [
    { refreshToken: async () => { throw new YouTubeProviderError("invalid_grant", false); } },
    { ownedChannels: async () => [] },
  ]) {
    const f = fixture({ provider });
    await f.worker.pollOnce();
    assert.equal(f.events.filter((event) => event === "reconnect").length, 1);
    assert.deepEqual(f.pages, []);
    assert.deepEqual(f.refreshed, []);
    assert.equal(f.events.includes("old"), false);
  }
});

test("per-poll Google calls and connection pages stay bounded and no partial details page advances its cursor", async () => {
  const f = fixture({ config: { ...config, maxCallsPerPoll: 7 }, connections: [{ ...connection, historyComplete: true }, { ...connection }], provider: {
    async listUploads({ pageToken }) { return { videoIds: [firstId], nextPageToken: pageToken ? null : "next" }; },
  } });
  assert.equal(await f.worker.pollOnce(), 1);
  const calls = f.events.filter((event) => ["refresh", "mine"].includes(event) || event.startsWith("videos:")).length + 2;
  assert.equal(calls, 6);
  assert.equal(f.pages.length, 2);
  assert.equal(f.queue.length, 1);
  const smaller = fixture({ config: { ...config, batchSize: 10, maxCallsPerPoll: 7 } });
  await smaller.worker.pollOnce();
  assert.equal(smaller.events.some((event) => event.startsWith("uploads:")), false);
  assert.deepEqual(smaller.pages, []);
});

test("invalid mutable-playlist cursors restart without declaring completion or deleting posts", async () => {
  const f = fixture({ connections: [{ ...connection, historyComplete: true, pollCursor: "stale" }], provider: {
    async listUploads({ pageToken }) {
      if (pageToken) throw new YouTubeProviderError("pagination_cursor_invalid", false);
      return { videoIds: [], nextPageToken: "head-next" };
    },
  } });
  await f.worker.pollOnce();
  assert.deepEqual(f.pages, [
    { expectedCursor: "stale", nextCursor: "stale", videos: [], historyComplete: true, mode: "poll" },
    { expectedCursor: "stale", nextCursor: null, videos: [], historyComplete: false, mode: "poll" },
  ]);
  assert.deepEqual(f.refreshed, []);
  assert.equal(f.releases[0]?.code, null);
});

test("quota Retry-After cooldown prevents more Google work but does not stop local stale-data cleanup", async () => {
  const f = fixture({ connections: [{ ...connection }, { ...connection }], provider: {
    async refreshToken() { throw new YouTubeProviderError("quota_exceeded", true, 3600); },
  } });
  await f.worker.pollOnce();
  assert.equal(f.releases[0]?.retryAt, "2026-10-08T01:00:00.000Z");
  assert.equal(await f.worker.pollOnce(), 0);
  assert.equal(f.events.filter((event) => event === "cleanup").length, 2);
  assert.equal(f.events.filter((event) => event === "claim").length, 1);
});

test("bounded exponential retry persists only fixed safe codes and never raw upstream errors", async () => {
  const f = fixture({ connections: [{ ...connection }, { ...connection }, { ...connection }], provider: {
    async refreshToken() { throw new Error("synthetic-access-token private@example.test"); },
  }, config: { ...config, maxCallsPerPoll: 7 } });
  await f.worker.pollOnce();
  assert.equal(f.releases[0]?.code, "youtube_sync_failed");
  assert.doesNotMatch(JSON.stringify(f.logs), /synthetic-|private@/);
  assert.deepEqual(f.releases.map((item) => item.retryAt), ["2026-10-08T00:00:30.000Z"]);
  f.advance(600_000);
  await f.worker.pollOnce();
  assert.equal(f.releases[1]?.retryAt, "2026-10-08T00:11:00.000Z");
});

test("stop does not start another provider request or publish a partially fetched page; lease expiry recovers it", async () => {
  let worker: YouTubeSyncWorker;
  const f = fixture({ provider: { async listUploads() { worker.stop(); return { videoIds: [firstId], nextPageToken: null }; } } });
  worker = f.worker;
  await worker.pollOnce();
  assert.deepEqual(f.pages, []);
  assert.deepEqual(f.releases, []);
  assert.equal(f.events.some((event) => event.startsWith("videos:")), false);
  assert.equal(await worker.pollOnce(), 0);
});

test("slow provider calls cannot burn the entire lease or advance a page with incomplete video details", async () => {
  let advance: (milliseconds: number) => void = () => {};
  const f = fixture({ config: { ...config, batchSize: 2, maxCallsPerPoll: 60 }, provider: {
    async listUploads() { return { videoIds: Array.from({ length: 21 }, (_item, index) => String(index).padStart(11, "0")), nextPageToken: "next" }; },
    async publicVideos(ids) { advance(15_000); return ids.map((id) => video(id)); },
  } });
  advance = f.advance;
  await f.worker.pollOnce();
  assert.deepEqual(f.pages, []);
  assert.equal(f.releases[0]?.code, "youtube_sync_failed");
});

test("overlapping polls share one acquisition chain rather than competing for another lease", async () => {
  let resume: () => void = () => {};
  const gate = new Promise<void>((resolve) => { resume = resolve; });
  let refreshes = 0;
  const f = fixture({ provider: { async refreshToken() { refreshes++; await gate; return { accessToken: "synthetic-access", expiresIn: 3600, scope: "" }; } } });
  const first = f.worker.pollOnce(), second = f.worker.pollOnce();
  resume();
  assert.deepEqual(await Promise.all([first, second]), [1, 1]);
  assert.equal(refreshes, 1);
});
