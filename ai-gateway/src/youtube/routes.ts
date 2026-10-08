export type YouTubeRouteApi = {
  getConnection(ownerId: string): Promise<object>;
  authorize(ownerId: string, input: { importHistory: boolean; autoSync: boolean }): Promise<object>;
  callback(ownerId: string, input: { code: string; state: string }): Promise<object>;
  settings(ownerId: string, input: { syncEnabled: boolean }): Promise<object>;
  importHistory(ownerId: string): Promise<object>;
  disconnect(ownerId: string, input: { confirmRemoveSyncedPosts: true }): Promise<object>;
};

type Result = { statusCode: number; body: object; headers: Record<string, string> };
const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
const knownErrors = new Set([
  "youtube_unconfigured", "invalid_request", "confirmation_required",
  "authentication_required", "youtube_not_configured", "youtube_options_invalid",
  "youtube_state_invalid", "youtube_scope_missing", "youtube_refresh_token_missing",
  "youtube_channel_missing", "youtube_channel_selection_required", "youtube_not_connected",
  "youtube_account_ineligible", "youtube_reconnect_required", "youtube_disconnect_confirmation_required",
  "youtube_unavailable", "youtube_channel_already_bound", "youtube_channel_invalid",
  "youtube_already_connected", "youtube_worker_invalid", "youtube_lease_lost", "youtube_page_invalid",
  "youtube_cursor_conflict", "youtube_sync_disabled", "youtube_channel_mismatch", "youtube_video_invalid",
  "youtube_manual_revocation_required", "youtube_revocation_pending",
]);
const providerErrors: Record<string, { code: string; status: number }> = {
  invalid_grant: { code: "youtube_reconnect_required", status: 409 },
  oauth_configuration_invalid: { code: "youtube_not_configured", status: 503 },
  oauth_denied: { code: "youtube_oauth_denied", status: 403 },
  quota_exceeded: { code: "youtube_quota_exceeded", status: 429 },
  provider_unavailable: { code: "youtube_unavailable", status: 503 },
  provider_access_unavailable: { code: "youtube_unavailable", status: 503 },
  provider_response_invalid: { code: "youtube_unavailable", status: 503 },
  channel_unavailable: { code: "youtube_channel_missing", status: 409 },
};

// Called only after Gateway authentication. No owner ID, channel ID or remote
// destination supplied in a request body is ever used as posting authority.
export async function youtubeRoute(api: YouTubeRouteApi | undefined, ownerId: string, method: string, path: string, payload: unknown): Promise<Result> {
  const result = (statusCode: number, body: object): Result => ({ statusCode, body, headers });
  if (!api) return result(503, { error: "youtube_unconfigured" });
  const input = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown> : {};
  try {
    if (method === "GET" && path === "/v1/youtube/connection") return result(200, await api.getConnection(ownerId));
    if (method === "POST" && path === "/v1/youtube/authorize") {
      if (typeof input.importHistory !== "boolean" || typeof input.autoSync !== "boolean") return result(400, { error: "invalid_request" });
      return result(200, await api.authorize(ownerId, { importHistory: input.importHistory, autoSync: input.autoSync }));
    }
    if (method === "POST" && path === "/v1/youtube/callback") {
      if (typeof input.code !== "string" || !input.code || input.code.length > 2048
        || typeof input.state !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(input.state)) return result(400, { error: "invalid_request" });
      return result(200, await api.callback(ownerId, { code: input.code, state: input.state }));
    }
    if (method === "POST" && path === "/v1/youtube/settings") {
      if (typeof input.syncEnabled !== "boolean") return result(400, { error: "invalid_request" });
      return result(200, await api.settings(ownerId, { syncEnabled: input.syncEnabled }));
    }
    if (method === "POST" && path === "/v1/youtube/import-history") return result(202, await api.importHistory(ownerId));
    if (method === "POST" && path === "/v1/youtube/disconnect") {
      if (input.confirmRemoveSyncedPosts !== true) return result(400, { error: "confirmation_required" });
      return result(200, await api.disconnect(ownerId, { confirmRemoveSyncedPosts: true }));
    }
    return result(404, { error: "not_found" });
  } catch (error) {
    const candidate = error as { code?: string; message?: string; status?: number; statusCode?: number };
    const code = String(candidate.code || candidate.message || "");
    const provider = Object.hasOwn(providerErrors, code) ? providerErrors[code] : undefined;
    if (provider) return result(provider.status, { error: provider.code });
    const status = candidate.statusCode ?? candidate.status ?? 503;
    return result(status >= 400 && status <= 599 ? status : 503, { error: knownErrors.has(code) ? code : "youtube_service_unavailable" });
  }
}
