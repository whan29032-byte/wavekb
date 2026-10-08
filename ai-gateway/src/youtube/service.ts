import { createHash, randomBytes } from "node:crypto";
import type { YouTubeSyncConfig } from "./config.ts";
import { YouTubeError, type YouTubeProvider } from "./contracts.ts";
import { decryptYouTubeSecret, encryptYouTubeSecret } from "./crypto.ts";
import { YouTubeRepository, type YouTubeServiceRepository } from "./repository.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class YouTubeService {
  private readonly repository: YouTubeServiceRepository;
  private readonly provider: YouTubeProvider;
  private readonly config: YouTubeSyncConfig;
  constructor(config: YouTubeSyncConfig, dependencies: { provider: YouTubeProvider; repository?: YouTubeServiceRepository }) {
    this.config = config;
    this.repository = dependencies.repository ?? new YouTubeRepository(config);
    this.provider = dependencies.provider;
  }
  private owner(ownerId: string) { if (!UUID.test(ownerId)) throw new YouTubeError("authentication_required", 401); }
  private ready() { if (this.config.readiness !== "ready") throw new YouTubeError("youtube_not_configured", 503); }
  private key() { return Buffer.from(this.config.tokenMasterKey, "base64"); }
  private databaseConfigured() { return Boolean(this.config.supabaseUrl && this.config.serviceRoleKey); }
  async getConnection(ownerId: string) {
    this.owner(ownerId);
    if (!this.databaseConfigured()) return { configured: false, connection: null };
    return { configured: this.config.readiness === "ready", connection: await this.repository.getConnection(ownerId) };
  }
  async authorize(ownerId: string, input: { importHistory: boolean; autoSync: boolean }) {
    this.ready(); this.owner(ownerId);
    if (typeof input.importHistory !== "boolean" || typeof input.autoSync !== "boolean") throw new YouTubeError("youtube_options_invalid");
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    const authorizationUrl = this.provider.authorizationUrl({ state, codeChallenge: createHash("sha256").update(verifier).digest("base64url") });
    await this.repository.beginOAuth(ownerId, createHash("sha256").update(state).digest("hex"), encryptYouTubeSecret(verifier, this.key(), ownerId, "oauth-state"), input);
    return { authorizationUrl, state };
  }
  async callback(ownerId: string, input: { code: string; state: string }) {
    this.ready(); this.owner(ownerId);
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(input.state) || !input.code || input.code.length > 4096 || /\s/.test(input.code)) throw new YouTubeError("youtube_state_invalid");
    const state = await this.repository.consumeOAuth(ownerId, createHash("sha256").update(input.state).digest("hex"));
    const codeVerifier = decryptYouTubeSecret(state.verifierSecret, this.key(), ownerId, "oauth-state");
    const tokens = await this.provider.exchangeCode({ code: input.code, codeVerifier, redirectUri: this.config.redirectUri });
    if (!tokens.scope.split(/\s+/).includes("https://www.googleapis.com/auth/youtube.readonly")) throw new YouTubeError("youtube_scope_missing", 403);
    if (!tokens.refreshToken) throw new YouTubeError("youtube_refresh_token_missing", 409);
    const channels = await this.provider.ownedChannels(tokens.accessToken);
    if (!channels.length) throw new YouTubeError("youtube_channel_missing", 409);
    if (channels.length !== 1) throw new YouTubeError("youtube_channel_selection_required", 409);
    const channel = channels[0]!;
    const refreshSecret = encryptYouTubeSecret(tokens.refreshToken, this.key(), ownerId, channel.id);
    return { connection: await this.repository.completeOAuth(ownerId, state.id, channel, refreshSecret) };
  }
  async settings(ownerId: string, input: { syncEnabled: boolean }) {
    this.ready(); this.owner(ownerId);
    if (typeof input.syncEnabled !== "boolean") throw new YouTubeError("youtube_options_invalid");
    return { connection: await this.repository.settings(ownerId, input.syncEnabled) };
  }
  async importHistory(ownerId: string) {
    this.ready(); this.owner(ownerId);
    const current = await this.repository.getConnection(ownerId);
    if (!current) throw new YouTubeError("youtube_not_connected", 409);
    return { connection: await this.repository.settings(ownerId, current.syncEnabled, true) };
  }
  async disconnect(ownerId: string, input: { confirmRemoveSyncedPosts: true }) {
    this.owner(ownerId);
    if (!this.databaseConfigured()) throw new YouTubeError("youtube_not_configured", 503);
    if (input.confirmRemoveSyncedPosts !== true) throw new YouTubeError("youtube_disconnect_confirmation_required");
    // Atomically snapshot the latest encrypted token into a leased revocation job
    // before deleting local API data. Only the worker contacts Google, preventing
    // stale-token races with refresh rotation or concurrent disconnect requests.
    const result = await this.repository.disconnect(ownerId, true);
    return { disconnected: true as const, removedPosts: result.removedPosts, remoteRevocationPending: result.remoteRevocationPending };
  }
}
