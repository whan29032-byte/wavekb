import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import type { YouTubeSyncConfig } from "./config.ts";
import type { PublicVideo, SyncConnection, UploadPage, YouTubeProvider, YouTubeRevocation } from "./contracts.ts";
import { decryptYouTubeSecret, encryptYouTubeSecret } from "./crypto.ts";
import { GoogleYouTubeProvider, YouTubeProviderError } from "./provider.ts";
import { YouTubeRepository, type YouTubeSyncRepository } from "./repository.ts";

type Dependencies = {
  provider?: YouTubeProvider;
  repository?: YouTubeSyncRepository;
  decrypt?: (connection: Pick<SyncConnection, "refreshSecret" | "ownerId" | "channelId">) => string;
  workerId?: string;
  log?: (code: string) => void;
  wait?: (milliseconds: number) => Promise<void>;
  now?: () => number;
};
type Budget = { remaining: number; deadline?: number };
type PageResult = { page: UploadPage; videos: PublicVideo[] };

export class YouTubeSyncWorker {
  private readonly config: YouTubeSyncConfig;
  private readonly provider: YouTubeProvider;
  private readonly repository: YouTubeSyncRepository;
  private readonly decrypt: (connection: Pick<SyncConnection, "refreshSecret" | "ownerId" | "channelId">) => string;
  private readonly workerId: string;
  private readonly log: (code: string) => void;
  private readonly wait: (milliseconds: number) => Promise<void>;
  private readonly now: () => number;
  private readonly stopSignal = new AbortController();
  private readonly failures = new Map<string, number>();
  private stopping = false;
  private activePoll: Promise<number> | null = null;
  private idleReported = false;
  private cooldownUntil = 0;

  constructor(config: YouTubeSyncConfig, dependencies: Dependencies = {}) {
    this.config = config;
    this.provider = dependencies.provider ?? new GoogleYouTubeProvider(config);
    this.repository = dependencies.repository ?? new YouTubeRepository(config);
    this.decrypt = dependencies.decrypt ?? ((connection) => decryptYouTubeSecret(connection.refreshSecret,
      Buffer.from(config.tokenMasterKey, "base64"), connection.ownerId, connection.channelId));
    this.workerId = dependencies.workerId ?? randomUUID();
    this.log = dependencies.log ?? (() => {});
    this.now = dependencies.now ?? Date.now;
    this.wait = dependencies.wait ?? (async (milliseconds) => {
      try { await sleep(milliseconds, undefined, { signal: this.stopSignal.signal }); }
      catch { if (!this.stopping) throw new Error("youtube_wait_failed"); }
    });
  }

  stop(): void { this.stopping = true; this.stopSignal.abort(); }

  private async call<T>(budget: Budget, action: () => Promise<T>): Promise<T> {
    if (this.stopping || budget.remaining < 1 || (budget.deadline !== undefined && this.now() + 15_000 > budget.deadline)) {
      throw new Error("youtube_poll_interrupted");
    }
    budget.remaining--;
    return action();
  }

  private matching(videos: PublicVideo[], channelId: string): PublicVideo[] {
    // A mismatched API batch is not evidence of deletion of the correct channel.
    if (videos.some((video) => video.channelId !== channelId || video.privacyStatus !== "public")) {
      throw new YouTubeProviderError("provider_response_invalid", true);
    }
    return videos;
  }

  private async fetchPage(connection: SyncConnection, accessToken: string, cursor: string | null, budget: Budget): Promise<PageResult> {
    const page = await this.call(budget, () => this.provider.listUploads({ accessToken,
      playlistId: connection.uploadsPlaylistId, pageToken: cursor }));
    if (page.nextPageToken && page.nextPageToken === cursor) throw new YouTubeProviderError("provider_response_invalid", true);
    const videos: PublicVideo[] = [];
    for (let offset = 0; offset < page.videoIds.length; offset += this.config.batchSize) {
      const ids = page.videoIds.slice(offset, offset + this.config.batchSize);
      videos.push(...this.matching(await this.call(budget, () => this.provider.publicVideos(ids, accessToken)), connection.channelId));
    }
    return { page, videos };
  }

  private canFetchPage(budget: Budget): boolean {
    // Reserve enough calls for even a full page, so the cursor is never advanced
    // after only part of its video details has been read.
    return !this.stopping && budget.remaining >= 1 + Math.ceil(50 / this.config.batchSize)
      && (budget.deadline === undefined || this.now() + 30_000 <= budget.deadline);
  }

  private async scanPage(connection: SyncConnection, accessToken: string, cursor: string | null,
    mode: "history" | "poll", budget: Budget, forceHead = false): Promise<PageResult | null> {
    try { return await this.fetchPage(connection, accessToken, forceHead ? null : cursor, budget); }
    catch (error) {
      if (error instanceof YouTubeProviderError && error.code === "pagination_cursor_invalid" && cursor) {
        // Uploads playlists are mutable; an invalid opaque cursor restarts the
        // scan without deleting existing posts or marking history complete.
        await this.repository.commitPage(connection.id, this.workerId, { expectedCursor: cursor,
          nextCursor: null, videos: [], historyComplete: false, mode });
        return null;
      }
      throw error;
    }
  }

  private async process(connection: SyncConnection, budget: Budget): Promise<void> {
    // Leave headroom for final database acknowledgement within the 3-minute
    // lease, even when Google requests repeatedly take the full 15-second limit.
    budget.deadline = this.now() + 120_000;
    try {
      let refreshToken: string;
      try { refreshToken = this.decrypt(connection); }
      catch { await this.repository.markReconnect(connection.id, this.workerId); this.log("youtube_secret_unavailable"); return; }
      const tokens = await this.call(budget, () => this.provider.refreshToken(refreshToken));
      if (tokens.refreshToken && tokens.refreshToken !== refreshToken && !this.stopping) {
        await this.repository.rotateRefreshSecret(connection.id, this.workerId, encryptYouTubeSecret(tokens.refreshToken,
          Buffer.from(this.config.tokenMasterKey, "base64"), connection.ownerId, connection.channelId));
      }
      const channels = await this.call(budget, () => this.provider.ownedChannels(tokens.accessToken));
      const owned = channels.find((channel) => channel.id === connection.channelId && channel.uploadsPlaylistId === connection.uploadsPlaylistId);
      if (!owned) {
        await this.repository.markReconnect(connection.id, this.workerId);
        this.log("youtube_owner_changed");
        return;
      }
      if (!this.stopping) await this.repository.updateChannelMetadata(connection.id, this.workerId, owned.title);

      // Refresh one due batch each visit. Missing/private/unlisted results only
      // remove public sources after a successful, correctly matched API response.
      if (!this.stopping && budget.remaining > 0) {
        const ids = await this.repository.oldVideoIds(connection.id, this.workerId, this.config.batchSize);
        if (ids.length) {
          const videos = this.matching(await this.call(budget, () => this.provider.publicVideos(ids, tokens.accessToken)), connection.channelId);
          if (!this.stopping) await this.repository.refreshOldVideos(connection.id, this.workerId, videos, ids);
        }
      }

      let pages = 0;
      let head: PageResult | null = null;
      if (!connection.historyComplete && connection.syncEnabled && this.canFetchPage(budget)) {
        head = await this.scanPage(connection, tokens.accessToken, connection.pollCursor, "poll", budget, true);
        pages++;
        if (head && !this.stopping) {
          await this.repository.commitPage(connection.id, this.workerId, { expectedCursor: connection.pollCursor,
            nextCursor: null, videos: head.videos.filter((video) => Date.parse(video.publishedAt) >= Date.parse(connection.syncSince)), historyComplete: false, mode: "poll" });
          connection.pollCursor = null;
        }
      }

      if (!connection.historyComplete) {
        let cursor = connection.historyCursor;
        if (cursor === null && head && !this.stopping) {
          await this.repository.commitPage(connection.id, this.workerId, { expectedCursor: null,
            nextCursor: head.page.nextPageToken, videos: head.videos,
            historyComplete: head.page.nextPageToken === null, mode: "history" });
          cursor = head.page.nextPageToken;
          connection.historyComplete = cursor === null;
        }
        while (!connection.historyComplete && pages < this.config.maxPagesPerConnection && this.canFetchPage(budget)) {
          const result = await this.scanPage(connection, tokens.accessToken, cursor, "history", budget);
          pages++;
          if (!result || this.stopping) break;
          await this.repository.commitPage(connection.id, this.workerId, { expectedCursor: cursor,
            nextCursor: result.page.nextPageToken, videos: result.videos,
            historyComplete: result.page.nextPageToken === null, mode: "history" });
          cursor = result.page.nextPageToken;
          connection.historyComplete = cursor === null;
        }
      } else if (connection.syncEnabled) {
        let cursor = connection.pollCursor;
        // Even a huge completed-history playlist must inspect the newest head
        // every visit; a durable deep cursor alone can take hours to cycle.
        if (this.canFetchPage(budget)) {
          const result = await this.scanPage(connection, tokens.accessToken, cursor, "poll", budget, true);
          pages++;
          if (result && !this.stopping) {
            const resume = result.page.nextPageToken === null ? null : cursor ?? result.page.nextPageToken;
            await this.repository.commitPage(connection.id, this.workerId, { expectedCursor: cursor,
              nextCursor: resume, videos: result.videos.filter((video) => Date.parse(video.publishedAt) >= Date.parse(connection.syncSince)),
              historyComplete: true, mode: "poll" });
            cursor = resume;
          }
        }
        while (cursor !== null && pages < this.config.maxPagesPerConnection && this.canFetchPage(budget)) {
          const result = await this.scanPage(connection, tokens.accessToken, cursor, "poll", budget);
          pages++;
          if (!result || this.stopping) break;
          await this.repository.commitPage(connection.id, this.workerId, { expectedCursor: cursor,
            nextCursor: result.page.nextPageToken, videos: result.videos.filter((video) => Date.parse(video.publishedAt) >= Date.parse(connection.syncSince)), historyComplete: true, mode: "poll" });
          cursor = result.page.nextPageToken;
          if (cursor === null) break;
        }
      }

      if (!this.stopping) {
        this.failures.delete(connection.id);
        await this.repository.releaseSync(connection.id, this.workerId, null,
          new Date(this.now() + this.config.pollMs).toISOString());
      }
    } catch (error) {
      if (this.stopping) return; // Expiring lease recovers interrupted work.
      if (error instanceof YouTubeProviderError && error.code === "invalid_grant") {
        await this.repository.markReconnect(connection.id, this.workerId);
        this.log("youtube_reconnect_required");
        return;
      }
      const failures = Math.min((this.failures.get(connection.id) ?? 0) + 1, 10);
      this.failures.set(connection.id, failures);
      const code = error instanceof YouTubeProviderError ? error.code : "youtube_sync_failed";
      const exponentialSeconds = Math.min(30 * 2 ** (failures - 1), 21_600);
      const delaySeconds = Math.max(exponentialSeconds, error instanceof YouTubeProviderError ? error.retryAfterSeconds ?? 0 : 0);
      if (error instanceof YouTubeProviderError && ["quota_exceeded", "provider_unavailable", "provider_access_unavailable"].includes(error.code)) {
        this.cooldownUntil = this.now() + Math.max(delaySeconds * 1000, this.config.pollMs);
      }
      await this.repository.releaseSync(connection.id, this.workerId, code,
        new Date(this.now() + delaySeconds * 1000).toISOString());
      this.log("youtube_sync_retry_scheduled");
    } finally {
      delete budget.deadline;
    }
  }

  private async revoke(job: YouTubeRevocation, budget: Budget): Promise<void> {
    budget.deadline = this.now() + 120_000;
    try {
      const token = this.decrypt(job);
      await this.call(budget, () => this.provider.revokeToken(token));
      if (!this.stopping) await this.repository.completeRevocation(job.id, this.workerId);
      this.failures.delete(`revoke:${job.id}`);
    } catch (error) {
      if (this.stopping) return;
      const key = `revoke:${job.id}`;
      const failures = Math.min((this.failures.get(key) ?? 0) + 1, 10);
      this.failures.set(key, failures);
      const code = error instanceof YouTubeProviderError ? error.code : "youtube_revocation_failed";
      const seconds = Math.max(Math.min(30 * 2 ** (failures - 1), 21_600),
        error instanceof YouTubeProviderError ? error.retryAfterSeconds ?? 0 : 0);
      if (error instanceof YouTubeProviderError && ["quota_exceeded", "provider_unavailable"].includes(error.code)) {
        this.cooldownUntil = this.now() + Math.max(seconds * 1000, this.config.pollMs);
      }
      await this.repository.releaseRevocation(job.id, this.workerId, code, new Date(this.now() + seconds * 1000).toISOString());
      this.log("youtube_revocation_retry_scheduled");
    } finally {
      delete budget.deadline;
    }
  }

  async pollOnce(): Promise<number> {
    if (this.activePoll) return this.activePoll;
    if (this.stopping) return 0;
    if (this.config.readiness !== "ready") {
      if (!this.idleReported) {
        this.log(this.config.readiness === "disabled" ? "youtube_sync_disabled" : "youtube_sync_unconfigured");
        this.idleReported = true;
      }
      if (!this.config.supabaseUrl || !this.config.serviceRoleKey) return 0;
    }
    const operation = async () => {
      // Local cleanup still runs during upstream quota/network outages.
      await this.repository.cleanupStaleData();
      if (this.cooldownUntil > this.now()) return 0;
      const budget = { remaining: this.config.maxCallsPerPoll };
      let claimed = 0;
      const revocation = this.config.revocationReady ? await this.repository.claimRevocation(this.workerId) : null;
      if (revocation && !this.stopping) { claimed++; await this.revoke(revocation, budget); }
      if (this.config.readiness !== "ready" || this.cooldownUntil > this.now()) return claimed;
      const connectionBudget = 5 + 2 * Math.ceil(50 / this.config.batchSize);
      // Do not claim a tail connection with enough budget only for its head:
      // preserving its due time gives it priority on the next polling round.
      while (!this.stopping && budget.remaining >= connectionBudget && claimed < this.config.maxCallsPerPoll / 4) {
        const connection = await this.repository.claimSync(this.workerId);
        if (!connection) break;
        claimed++;
        await this.process(connection, budget);
        if (this.cooldownUntil > this.now()) break;
      }
      return claimed;
    };
    this.activePoll = operation();
    try { return await this.activePoll; } finally { this.activePoll = null; }
  }

  async run(): Promise<void> {
    while (!this.stopping) {
      try { await this.pollOnce(); } catch { this.log("youtube_sync_poll_failed"); }
      if (!this.stopping) await this.wait(this.config.pollMs);
    }
  }
}
