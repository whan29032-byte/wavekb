import type { YouTubeSyncConfig } from "./config.ts";
import type { OAuthTokens, OwnedChannel, PublicVideo, UploadPage } from "./contracts.ts";

export const YOUTUBE_READONLY_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
export type YouTubeProviderCode = "invalid_grant" | "oauth_configuration_invalid" | "oauth_denied"
  | "quota_exceeded" | "provider_unavailable" | "provider_response_invalid" | "provider_access_unavailable"
  | "channel_unavailable" | "pagination_cursor_invalid";

export class YouTubeProviderError extends Error {
  readonly code: YouTubeProviderCode;
  readonly retryable: boolean;
  readonly retryAfterSeconds: number | null;
  constructor(code: YouTubeProviderCode, retryable: boolean, retryAfterSeconds: number | null = null) {
    super(code);
    this.name = "YouTubeProviderError";
    this.code = code;
    this.retryable = retryable;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface YouTubeProvider {
  authorizationUrl(input: { state: string; codeChallenge: string }): string;
  exchangeCode(input: { code: string; codeVerifier: string; redirectUri?: string }): Promise<OAuthTokens>;
  refreshToken(refreshToken: string): Promise<OAuthTokens>;
  revokeToken(token: string): Promise<void>;
  ownedChannels(accessToken: string): Promise<OwnedChannel[]>;
  listUploads(input: { accessToken: string; playlistId: string; pageToken?: string | null }): Promise<UploadPage>;
  publicVideos(videoIds: string[], accessToken?: string): Promise<PublicVideo[]>;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new YouTubeProviderError("provider_response_invalid", true);
  return value as Record<string, unknown>;
}
function boundedString(value: unknown, min: number, max: number): string {
  if (typeof value !== "string" || value.length < min || value.length > max || /\u0000/.test(value)) {
    throw new YouTubeProviderError("provider_response_invalid", true);
  }
  return value;
}
function opaqueToken(value: unknown): string {
  const token = boundedString(value, 1, 8192);
  if (/\s/.test(token)) throw new YouTubeProviderError("provider_response_invalid", true);
  return token;
}
function metadataTitle(value: unknown): string {
  const title = boundedString(value, 1, 200);
  if (Array.from(title).length > 100) throw new YouTubeProviderError("provider_response_invalid", true);
  return title;
}
function metadataDescription(value: unknown): string {
  const description = boundedString(value, 0, 5000);
  if (Buffer.byteLength(description, "utf8") > 5000) throw new YouTubeProviderError("provider_response_invalid", true);
  return description;
}
function channelId(value: unknown): string {
  const id = boundedString(value, 24, 24);
  if (!/^UC[A-Za-z0-9_-]{22}$/.test(id)) throw new YouTubeProviderError("provider_response_invalid", true);
  return id;
}
function videoId(value: unknown): string {
  const id = boundedString(value, 11, 11);
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) throw new YouTubeProviderError("provider_response_invalid", true);
  return id;
}
function retryAfter(value: string | null): number | null {
  if (!value) return null;
  const delay = /^\d+$/.test(value) ? Number(value) : Math.ceil((Date.parse(value) - Date.now()) / 1000);
  return Number.isFinite(delay) && delay >= 0 ? Math.min(delay, 3600) : null;
}

export class GoogleYouTubeProvider implements YouTubeProvider {
  private readonly config: YouTubeSyncConfig;
  private readonly fetchImpl: typeof fetch;
  constructor(config: YouTubeSyncConfig, fetchImpl: typeof fetch = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  private ready(): void {
    if (this.config.readiness !== "ready") throw new YouTubeProviderError("oauth_configuration_invalid", false);
  }

  authorizationUrl({ state, codeChallenge }: { state: string; codeChallenge: string }): string {
    this.ready();
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
      throw new YouTubeProviderError("oauth_configuration_invalid", false);
    }
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: this.config.clientId, redirect_uri: this.config.redirectUri,
      response_type: "code", scope: YOUTUBE_READONLY_SCOPE, access_type: "offline",
      state, code_challenge: codeChallenge, code_challenge_method: "S256", prompt: "consent",
    }).toString();
    return url.href;
  }

  private async request(url: URL, options: RequestInit, oauth = false, revocationOnly = false): Promise<unknown> {
    if (revocationOnly) {
      if (!this.config.revocationReady || url.href !== "https://oauth2.googleapis.com/revoke" || options.method !== "POST") {
        throw new YouTubeProviderError("oauth_configuration_invalid", false);
      }
    } else this.ready();
    if (!(["https://oauth2.googleapis.com", "https://www.googleapis.com"] as string[]).includes(url.origin)) {
      throw new YouTubeProviderError("oauth_configuration_invalid", false);
    }
    let response: Response;
    try {
      response = await this.fetchImpl(url, { ...options, redirect: "error", signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new YouTubeProviderError("provider_unavailable", true);
    }
    // Error bodies can contain tokens/user details: read only allowlisted codes.
    let body: unknown = null;
    try { body = await response.json(); } catch { /* Normalized below. */ }
    if (response.ok) return body;
    const raw = body && typeof body === "object" ? body as Record<string, unknown> : {};
    if (oauth && raw.error === "invalid_grant") throw new YouTubeProviderError("invalid_grant", false);
    if (oauth && (raw.error === "invalid_client" || raw.error === "unauthorized_client")) {
      throw new YouTubeProviderError("oauth_configuration_invalid", false);
    }
    const apiError = raw.error && typeof raw.error === "object" ? raw.error as Record<string, unknown> : {};
    const errors = Array.isArray(apiError.errors) ? apiError.errors : [];
    if (errors.some((value) => value && typeof value === "object"
      && (value as Record<string, unknown>).reason === "invalidPageToken")) {
      throw new YouTubeProviderError("pagination_cursor_invalid", false);
    }
    if (response.status === 429 || errors.some((value) => value && typeof value === "object"
      && ["quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded", "userRateLimitExceeded"].includes(String((value as Record<string, unknown>).reason)))) {
      throw new YouTubeProviderError("quota_exceeded", true, retryAfter(response.headers.get("retry-after")));
    }
    if (response.status === 408 || response.status === 425 || response.status >= 500) {
      throw new YouTubeProviderError("provider_unavailable", true, retryAfter(response.headers.get("retry-after")));
    }
    if (response.status === 401 || response.status === 403) {
      // A disabled Google API/project or forbidden resource is not evidence that
      // the user's refresh grant was revoked. Do not destroy local bindings.
      throw new YouTubeProviderError(oauth ? "oauth_denied" : "provider_access_unavailable", !oauth);
    }
    if (response.status === 404) throw new YouTubeProviderError("channel_unavailable", false);
    throw new YouTubeProviderError("provider_response_invalid", false);
  }

  private tokens(value: unknown, requireScope: boolean): OAuthTokens {
    const body = record(value);
    const accessToken = opaqueToken(body.access_token);
    if (!Number.isInteger(body.expires_in) || Number(body.expires_in) < 1 || Number(body.expires_in) > 86_400
      || body.token_type !== "Bearer") throw new YouTubeProviderError("provider_response_invalid", true);
    const scope = typeof body.scope === "string" ? boundedString(body.scope, 0, 2048) : "";
    if ((requireScope || scope) && !scope.split(/\s+/).includes(YOUTUBE_READONLY_SCOPE)) {
      throw new YouTubeProviderError("oauth_denied", false);
    }
    const result: OAuthTokens = { accessToken, expiresIn: Number(body.expires_in), scope };
    if (body.refresh_token !== undefined) result.refreshToken = opaqueToken(body.refresh_token);
    return result;
  }

  async exchangeCode({ code, codeVerifier, redirectUri }: { code: string; codeVerifier: string; redirectUri?: string }): Promise<OAuthTokens> {
    if (code.length < 1 || code.length > 4096 || /[\r\n\u0000]/.test(code)
      || !/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)
      || (redirectUri !== undefined && redirectUri !== this.config.redirectUri)) throw new YouTubeProviderError("oauth_denied", false);
    return this.tokens(await this.request(new URL("https://oauth2.googleapis.com/token"), {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, code_verifier: codeVerifier, client_id: this.config.clientId,
        client_secret: this.config.clientSecret, redirect_uri: this.config.redirectUri, grant_type: "authorization_code" }).toString(),
    }, true), true);
  }

  async refreshToken(refreshToken: string): Promise<OAuthTokens> {
    opaqueToken(refreshToken);
    return this.tokens(await this.request(new URL("https://oauth2.googleapis.com/token"), {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ refresh_token: refreshToken, client_id: this.config.clientId,
        client_secret: this.config.clientSecret, grant_type: "refresh_token" }).toString(),
    }, true), false);
  }

  async revokeToken(token: string): Promise<void> {
    opaqueToken(token);
    await this.request(new URL("https://oauth2.googleapis.com/revoke"), {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    }, true, true);
  }

  private async data(path: "channels" | "playlistItems" | "videos", params: Record<string, string>, accessToken?: string): Promise<Record<string, unknown>> {
    if (!accessToken) throw new YouTubeProviderError("oauth_denied", false);
    opaqueToken(accessToken);
    const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
    url.search = new URLSearchParams(params).toString();
    return record(await this.request(url, { headers: { authorization: `Bearer ${accessToken}` } }));
  }

  async ownedChannels(accessToken: string): Promise<OwnedChannel[]> {
    const response = await this.data("channels", { part: "id,snippet,contentDetails", mine: "true", maxResults: "50" }, accessToken);
    if (!Array.isArray(response.items) || response.items.length > 50 || response.nextPageToken) {
      throw new YouTubeProviderError("provider_response_invalid", true);
    }
    return response.items.map((value) => {
      const item = record(value), snippet = record(item.snippet), details = record(item.contentDetails);
      const playlists = record(details.relatedPlaylists);
      const playlistId = boundedString(playlists.uploads, 2, 80);
      if (!/^[A-Za-z0-9_-]+$/.test(playlistId)) throw new YouTubeProviderError("provider_response_invalid", true);
      return { id: channelId(item.id), title: metadataTitle(snippet.title), uploadsPlaylistId: playlistId };
    });
  }

  async listUploads({ accessToken, playlistId, pageToken }: { accessToken: string; playlistId: string; pageToken?: string | null }): Promise<UploadPage> {
    if (!/^[A-Za-z0-9_-]{2,80}$/.test(playlistId)) throw new YouTubeProviderError("channel_unavailable", false);
    const params: Record<string, string> = { part: "contentDetails", playlistId, maxResults: "50" };
    if (pageToken) params.pageToken = boundedString(pageToken, 1, 2048);
    const response = await this.data("playlistItems", params, accessToken);
    if (!Array.isArray(response.items) || response.items.length > 50) throw new YouTubeProviderError("provider_response_invalid", true);
    const ids = response.items.map((value) => videoId(record(record(value).contentDetails).videoId));
    return { videoIds: [...new Set(ids)], nextPageToken: response.nextPageToken === undefined ? null : boundedString(response.nextPageToken, 1, 2048) };
  }

  async publicVideos(videoIds: string[], accessToken?: string): Promise<PublicVideo[]> {
    if (!videoIds.length) return [];
    if (videoIds.length > 50) throw new YouTubeProviderError("provider_response_invalid", false);
    const requested = new Set(videoIds.map(videoId));
    const response = await this.data("videos", { part: "snippet,status", id: [...requested].join(",") }, accessToken);
    if (!Array.isArray(response.items) || response.items.length > requested.size) throw new YouTubeProviderError("provider_response_invalid", true);
    const seen = new Set<string>();
    return response.items.map((value) => {
      const item = record(value), snippet = record(item.snippet), status = record(item.status);
      const id = videoId(item.id);
      if (!requested.has(id) || seen.has(id) || !["public", "private", "unlisted"].includes(String(status.privacyStatus))
        || typeof status.embeddable !== "boolean") throw new YouTubeProviderError("provider_response_invalid", true);
      seen.add(id);
      const publishedAt = boundedString(snippet.publishedAt, 10, 40);
      if (!Number.isFinite(Date.parse(publishedAt))) throw new YouTubeProviderError("provider_response_invalid", true);
      return { id, channelId: channelId(snippet.channelId), title: metadataTitle(snippet.title),
        description: metadataDescription(snippet.description), publishedAt,
        privacyStatus: String(status.privacyStatus), embeddable: status.embeddable };
    }).filter((video) => video.privacyStatus === "public");
  }
}
