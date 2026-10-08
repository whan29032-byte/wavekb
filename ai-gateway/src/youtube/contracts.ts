export type OAuthTokens = { accessToken: string; refreshToken?: string; expiresIn: number; scope: string };
export type OwnedChannel = { id: string; title: string; uploadsPlaylistId: string };
export type UploadPage = { videoIds: string[]; nextPageToken: string | null };
export type PublicVideo = { id: string; channelId: string; title: string; description: string; publishedAt: string; privacyStatus: string; embeddable: boolean };
export type YouTubeProvider = {
  authorizationUrl(input: { state: string; codeChallenge: string }): string;
  exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<OAuthTokens>;
  refreshToken(refreshToken: string): Promise<OAuthTokens>;
  revokeToken(token: string): Promise<void>;
  ownedChannels(accessToken: string): Promise<OwnedChannel[]>;
  listUploads(input: { accessToken: string; playlistId: string; pageToken?: string | null }): Promise<UploadPage>;
  publicVideos(videoIds: string[], accessToken?: string): Promise<PublicVideo[]>;
};
export type YouTubeSecret = { ciphertext: string; iv: string; auth_tag: string; key_version: number };
export type YouTubeConnectionView = {
  id: string; channelId: string; channelTitle: string; syncEnabled: boolean; importHistory: boolean;
  historyStatus: "pending" | "running" | "complete"; historyImported: number;
  status: "connected" | "reconnect_required" | "revocation_pending"; lastSyncedAt: string | null; lastErrorCode: string | null;
};
export type SyncConnection = {
  id: string; ownerId: string; channelId: string; uploadsPlaylistId: string; refreshSecret: YouTubeSecret;
  historyCursor: string | null; pollCursor: string | null; historyComplete: boolean; syncEnabled: boolean;
  syncSince: string; lastSyncedAt: string | null; leaseWorkerId: string;
};
export type YouTubeRevocation = { id: string; ownerId: string; channelId: string; refreshSecret: YouTubeSecret };
export class YouTubeError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 400) { super(code); this.code = code; this.status = status; }
}
