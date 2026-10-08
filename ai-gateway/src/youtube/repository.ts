import type { YouTubeSyncConfig } from "./config.ts";
import { YouTubeError, type PublicVideo, type SyncConnection, type YouTubeConnectionView, type YouTubeSecret, type YouTubeRevocation } from "./contracts.ts";

export type YouTubeDatabase = { request(path: string, options?: { method?: string; body?: unknown; headers?: Record<string, string> }): Promise<any> };
export type CommitYouTubePage = { expectedCursor: string | null; nextCursor: string | null; videos: PublicVideo[]; historyComplete: boolean; mode: "history" | "poll" };
export interface YouTubeSyncRepository {
  claimSync(workerId: string): Promise<SyncConnection | null>;
  commitPage(connectionId: string, workerId: string, page: CommitYouTubePage): Promise<{ imported: number }>;
  releaseSync(connectionId: string, workerId: string, errorCode?: string | null, retryAt?: string | null): Promise<void>;
  markReconnect(connectionId: string, workerId: string): Promise<void>;
  oldVideoIds(connectionId: string, workerId: string, limit: number): Promise<string[]>;
  refreshOldVideos(connectionId: string, workerId: string, videos: PublicVideo[], checkedIds: string[]): Promise<void>;
  cleanupStaleData(): Promise<void>;
  claimRevocation(workerId: string): Promise<YouTubeRevocation | null>;
  completeRevocation(jobId: string, workerId?: string | null): Promise<void>;
  releaseRevocation(jobId: string, workerId: string, errorCode?: string | null, retryAt?: string | null): Promise<void>;
  rotateRefreshSecret(connectionId: string, workerId: string, secret: YouTubeSecret): Promise<void>;
  updateChannelMetadata(connectionId: string, workerId: string, title: string): Promise<void>;
}
export type YouTubeServiceRepository = Pick<YouTubeRepository, "getConnection" | "beginOAuth" | "consumeOAuth" | "completeOAuth" | "settings" | "disconnect">;

const SAFE_ERRORS = new Set(["youtube_account_ineligible", "youtube_state_invalid", "youtube_channel_invalid", "youtube_already_connected", "youtube_channel_already_bound", "youtube_not_connected", "youtube_reconnect_required", "youtube_revocation_pending", "youtube_disconnect_confirmation_required", "youtube_worker_invalid", "youtube_lease_lost", "youtube_page_invalid", "youtube_cursor_conflict", "youtube_sync_disabled", "youtube_channel_mismatch", "youtube_video_invalid"]);

export class YouTubeRestDatabase implements YouTubeDatabase {
  private readonly config: YouTubeSyncConfig;
  private readonly fetchImpl: typeof fetch;
  constructor(config: YouTubeSyncConfig, fetchImpl: typeof fetch = fetch) { this.config = config; this.fetchImpl = fetchImpl; }
  async request(path: string, options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<any> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.supabaseUrl}${path}`, {
        method: options.method ?? "GET", redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { apikey: this.config.serviceRoleKey, authorization: `Bearer ${this.config.serviceRoleKey}`, "content-type": "application/json", ...options.headers },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
    } catch { throw new YouTubeError("youtube_unavailable", 503); }
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    if (!response.ok) {
      const code = SAFE_ERRORS.has(payload?.message ?? "") ? payload!.message! : "youtube_unavailable";
      throw new YouTubeError(code, code === "youtube_unavailable" ? 503 : code === "youtube_account_ineligible" ? 403 : 409);
    }
    return payload;
  }
}

export class YouTubeRepository implements YouTubeSyncRepository {
  private readonly database: YouTubeDatabase;
  constructor(config: YouTubeSyncConfig, database?: YouTubeDatabase) { this.database = database ?? new YouTubeRestDatabase(config); }
  private rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
    return this.database.request(`/rest/v1/rpc/${name}`, { method: "POST", body }) as Promise<T>;
  }
  getConnection(ownerId: string): Promise<YouTubeConnectionView | null> { return this.rpc("youtube_get_connection", { p_owner_id: ownerId }); }
  beginOAuth(ownerId: string, stateHash: string, verifierSecret: YouTubeSecret, options: { importHistory: boolean; autoSync: boolean }): Promise<string> {
    return this.rpc("youtube_begin_oauth", { p_owner_id: ownerId, p_state_hash: stateHash, p_verifier_secret: verifierSecret, p_import_history: options.importHistory, p_auto_sync: options.autoSync });
  }
  consumeOAuth(ownerId: string, stateHash: string): Promise<{ id: string; verifierSecret: YouTubeSecret }> {
    return this.rpc("youtube_consume_oauth", { p_owner_id: ownerId, p_state_hash: stateHash });
  }
  completeOAuth(ownerId: string, stateId: string, channel: { id: string; title: string; uploadsPlaylistId: string }, refreshSecret: YouTubeSecret): Promise<YouTubeConnectionView> {
    return this.rpc("youtube_complete_oauth", { p_owner_id: ownerId, p_state_id: stateId, p_channel_id: channel.id, p_channel_title: channel.title, p_uploads_playlist_id: channel.uploadsPlaylistId, p_refresh_secret: refreshSecret });
  }
  settings(ownerId: string, syncEnabled: boolean, restartHistory = false): Promise<YouTubeConnectionView> {
    return this.rpc("youtube_settings", { p_owner_id: ownerId, p_sync_enabled: syncEnabled, p_restart_history: restartHistory });
  }
  disconnect(ownerId: string, confirmRemove: boolean): Promise<{ disconnected: true; removedPosts: number; remoteRevocationPending: boolean; revocationId?: string | null }> {
    return this.rpc("youtube_disconnect", { p_owner_id: ownerId, p_confirm_remove: confirmRemove });
  }
  async getOwnerSecret(ownerId: string): Promise<{ channelId: string; refreshSecret: YouTubeSecret } | null> {
    const rows = await this.database.request(`/rest/v1/youtube_connections?owner_id=eq.${encodeURIComponent(ownerId)}&select=channel_id,youtube_connection_secrets(ciphertext,iv,auth_tag,key_version)&limit=1`);
    const row = rows?.[0];
    const secret = Array.isArray(row?.youtube_connection_secrets) ? row.youtube_connection_secrets[0] : row?.youtube_connection_secrets;
    return row?.channel_id && secret ? { channelId: row.channel_id, refreshSecret: secret } : null;
  }
  claimSync(workerId: string): Promise<SyncConnection | null> { return this.rpc("youtube_claim_sync", { p_worker_id: workerId }); }
  commitPage(connectionId: string, workerId: string, page: CommitYouTubePage): Promise<{ imported: number }> {
    return this.rpc("youtube_commit_page", { p_connection_id: connectionId, p_worker_id: workerId, p_expected_cursor: page.expectedCursor, p_next_cursor: page.nextCursor, p_videos: page.videos, p_history_complete: page.historyComplete, p_mode: page.mode });
  }
  releaseSync(connectionId: string, workerId: string, errorCode: string | null = null, retryAt: string | null = null): Promise<void> {
    // Only fixed error codes are persisted, never upstream response text or URLs.
    const safeCode = errorCode && /^[a-z_]{1,80}$/.test(errorCode) ? errorCode : errorCode ? "youtube_unavailable" : null;
    return this.rpc("youtube_release_sync", { p_connection_id: connectionId, p_worker_id: workerId, p_error_code: safeCode, p_retry_at: retryAt });
  }
  markReconnect(connectionId: string, workerId: string): Promise<void> { return this.rpc("youtube_mark_reconnect", { p_connection_id: connectionId, p_worker_id: workerId }); }
  oldVideoIds(connectionId: string, workerId: string, limit: number): Promise<string[]> { return this.rpc("youtube_old_video_ids", { p_connection_id: connectionId, p_worker_id: workerId, p_limit: limit }); }
  refreshOldVideos(connectionId: string, workerId: string, videos: PublicVideo[], checkedIds: string[]): Promise<void> {
    return this.rpc("youtube_refresh_videos", { p_connection_id: connectionId, p_worker_id: workerId, p_videos: videos, p_checked_ids: checkedIds });
  }
  cleanupStaleData(): Promise<void> { return this.rpc("youtube_cleanup_stale_data", {}); }
  claimRevocation(workerId: string): Promise<YouTubeRevocation | null> { return this.rpc("youtube_claim_revocation", { p_worker_id: workerId }); }
  completeRevocation(jobId: string, workerId: string | null = null): Promise<void> { return this.rpc("youtube_complete_revocation", { p_job_id: jobId, p_worker_id: workerId }); }
  releaseRevocation(jobId: string, workerId: string, _errorCode: string | null = null, retryAt: string | null = null): Promise<void> { return this.rpc("youtube_release_revocation", { p_job_id: jobId, p_worker_id: workerId, p_retry_at: retryAt }); }
  rotateRefreshSecret(connectionId: string, workerId: string, secret: YouTubeSecret): Promise<void> { return this.rpc("youtube_rotate_secret", { p_connection_id: connectionId, p_worker_id: workerId, p_refresh_secret: secret }); }
  updateChannelMetadata(connectionId: string, workerId: string, title: string): Promise<void> { return this.rpc("youtube_update_channel", { p_connection_id: connectionId, p_worker_id: workerId, p_channel_title: title }); }
}
