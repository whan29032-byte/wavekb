export type YoutubeConnection = {
  id: string;
  channelId: string;
  channelTitle: string;
  syncEnabled: boolean;
  importHistory: boolean;
  historyStatus: "pending" | "running" | "complete";
  historyImported: number;
  status: "connected" | "reconnect_required" | "revocation_pending";
  lastSyncedAt: string | null;
  lastErrorCode: string | null;
};
export type YoutubeConnectionStatus = { configured: boolean; connection: YoutubeConnection | null };
export const youtubeReadonlyScope = "https://www.googleapis.com/auth/youtube.readonly";
export const youtubeStatePattern = /^[A-Za-z0-9_-]{32,256}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const publicErrorCodes = new Set(["youtube_not_configured", "authentication_required", "youtube_options_invalid", "youtube_state_invalid", "youtube_scope_missing", "youtube_refresh_token_missing", "youtube_channel_missing", "youtube_channel_selection_required", "youtube_not_connected", "youtube_account_ineligible", "youtube_reconnect_required", "youtube_disconnect_confirmation_required", "youtube_unavailable", "youtube_channel_already_bound", "youtube_quota_exceeded", "youtube_oauth_denied", "youtube_oauth_failed", "youtube_history_running", "youtube_revocation_pending", "youtube_manual_revocation_required"]);

export function sanitizeYoutubeErrorCode(error: unknown) {
  return typeof error === "string" && publicErrorCodes.has(error) ? error : "youtube_request_failed";
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

// Explicit public fields only: provider credentials can never be propagated by
// an accidental extra property on the gateway's response.
export function parseYoutubeConnection(value: unknown): YoutubeConnection {
  if (!record(value) || !uuid.test(String(value.id ?? ""))
    || typeof value.channelId !== "string" || !(/^UC[A-Za-z0-9_-]{22}$/.test(value.channelId) || value.channelId === "" && value.status !== "connected")
    || typeof value.channelTitle !== "string" || value.channelTitle.length > 300
    || typeof value.syncEnabled !== "boolean" || typeof value.importHistory !== "boolean"
    || !["pending", "running", "complete"].includes(String(value.historyStatus))
    || !Number.isSafeInteger(value.historyImported) || Number(value.historyImported) < 0
    || !["connected", "reconnect_required", "revocation_pending"].includes(String(value.status))
    || !(value.lastSyncedAt === null || typeof value.lastSyncedAt === "string" && Number.isFinite(Date.parse(value.lastSyncedAt)))
    || !(value.lastErrorCode === null || typeof value.lastErrorCode === "string" && /^[a-z0-9_]{1,100}$/.test(value.lastErrorCode))) {
    throw new Error("youtube_response_invalid");
  }
  return {
    id: value.id as string, channelId: value.channelId, channelTitle: value.channelTitle,
    syncEnabled: value.syncEnabled, importHistory: value.importHistory,
    historyStatus: value.historyStatus as YoutubeConnection["historyStatus"], historyImported: Number(value.historyImported),
    status: value.status as YoutubeConnection["status"], lastSyncedAt: value.lastSyncedAt as string | null,
    lastErrorCode: value.lastErrorCode as string | null,
  };
}

export function parseYoutubeStatus(value: unknown): YoutubeConnectionStatus {
  if (!record(value) || typeof value.configured !== "boolean" || !("connection" in value)) throw new Error("youtube_response_invalid");
  const connection = value.connection === null ? null : parseYoutubeConnection(value.connection);
  return { configured: value.configured, connection };
}

export function isGoogleYoutubeAuthorization(url: unknown, state?: string, redirectOrigin?: string): url is string {
  if (typeof url !== "string" || url.length > 8192) return false;
  try {
    const parsed = new URL(url);
    return parsed.origin === "https://accounts.google.com" && !parsed.username && !parsed.password && !parsed.hash
      && ["/o/oauth2/v2/auth", "/o/oauth2/auth"].includes(parsed.pathname)
      && parsed.searchParams.getAll("scope").length === 1 && parsed.searchParams.get("scope") === youtubeReadonlyScope
      && parsed.searchParams.getAll("state").length === 1 && youtubeStatePattern.test(parsed.searchParams.get("state") ?? "")
      && (!state || parsed.searchParams.get("state") === state)
      && parsed.searchParams.get("response_type") === "code"
      && (!redirectOrigin || parsed.searchParams.get("redirect_uri") === `${redirectOrigin}/api/youtube/callback`);
  } catch { return false; }
}

export function youtubeErrorMessage(code: string) {
  return ({
    youtube_not_configured: "Google 授权尚未配置，当前不会绑定频道或同步视频。请联系管理员完成配置。",
    authentication_required: "登录已失效，请重新登录后再连接 YouTube。",
    youtube_reconnect_required: "Google 授权已失效，请重新授权；暂停期间不会自动发帖。",
    youtube_channel_missing: "授权账号没有可读取的 YouTube 频道，请检查 Google 账号后重新授权。",
    youtube_multiple_channels: "当前账号返回了多个频道。本版本仅支持一个频道，请使用对应频道的 Google 账号授权。",
    youtube_channel_selection_required: "Google 返回了多个频道。本版本仅支持一个频道，请在 Google 授权时选择对应频道，不能自动代选。",
    youtube_channel_already_bound: "此频道已经绑定其他站内账号。请先核对原绑定账号，不能覆盖他人的连接。",
    youtube_scope_missing: "Google 没有授予所需的 YouTube 只读权限，请重新授权并确认读取频道的权限。",
    youtube_refresh_token_missing: "Google 没有提供后台续期授权，未建立持续同步连接。请重新授权。",
    youtube_options_invalid: "授权选项未提交完整，请重新确认历史导入与自动同步选项。",
    youtube_not_connected: "还没有绑定 YouTube 频道，请先完成 Google 只读授权。",
    youtube_account_ineligible: "当前站内账号不能建立连接，请先完成账号激活或联系管理员。",
    youtube_unavailable: "YouTube 服务暂时不可用，请稍后刷新状态或重试。",
    youtube_disconnect_confirmation_required: "解绑前需要确认移除该连接生成的帖子，手工帖子不会被删除。",
    youtube_revocation_pending: "站内已解除，Google 授权撤销处理中；可在 Google 安全页检查。当前不会继续同步或重新绑定。",
    youtube_manual_revocation_required: "站内同步已停止。Google 授权的自动撤销期限已结束，请在 Google 安全页手动移除 WaveKB 的授权。",
    youtube_quota_exceeded: "YouTube 配额暂时不足，请稍后刷新同步状态。",
    quota_exceeded: "YouTube 配额暂时不足，后台已安排退避重试；已有连接不会因临时限流被解除。",
    provider_unavailable: "YouTube 网络或服务暂时不可用，后台会退避重试；不会把临时网络错误当作视频删除或授权撤销。",
    provider_response_invalid: "YouTube 数据响应不完整，本轮未确认导入或删除，后台将重试。",
    youtube_sync_failed: "同步暂时未完成，后台已安排重试；可稍后刷新连接状态和导入进度。",
    youtube_gateway_unavailable: "YouTube 连接服务暂时不可用，请稍后重试。",
    youtube_state_invalid: "授权会话已失效，请从本页重新开始 Google 授权。",
    youtube_oauth_denied: "Google 授权已取消，没有建立新的频道连接。",
  } as Record<string, string>)[code] || "操作尚未完成，请刷新状态后重试；不会显示未经确认的绑定结果。";
}
