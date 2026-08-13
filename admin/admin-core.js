(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ElliottAdminCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ACTION_LABELS = Object.freeze({
    ban: "封禁账号",
    unban: "解除封禁",
    mute: "设置禁言",
    unmute: "解除禁言",
    grant_admin: "授予管理员",
    revoke_admin: "撤销管理员",
    set_uid: "修改 UID"
  });

  function validateUid(value) {
    const text = String(value == null ? "" : value).trim();
    if (!/^\d{5,6}$/.test(text)) {
      return {ok: false, message: "UID 必须是 5—6 位数字。"};
    }
    const uid = Number(text);
    return uid >= 10000 && uid <= 999999
      ? {ok: true, value: uid}
      : {ok: false, message: "UID 必须介于 10000—999999。"};
  }

  function isMuted(user, now) {
    if (!user || !user.muted_until) return false;
    const current = now == null ? Date.now() : Number(now);
    return new Date(user.muted_until).getTime() > current;
  }

  function statusLabel(user, now) {
    if (user && user.account_status === "banned") return "已封禁";
    if (isMuted(user, now)) return "禁言中";
    return "正常";
  }

  function statusTone(user, now) {
    if (user && user.account_status === "banned") return "danger";
    if (isMuted(user, now)) return "warning";
    return "success";
  }

  function formatDate(value, fallback) {
    if (!value) return fallback || "—";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return fallback || "—";
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date);
  }

  function muteUntil(hours, now) {
    const amount = Number(hours);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return new Date((now == null ? Date.now() : Number(now)) + amount * 3600000).toISOString();
  }

  function errorMessage(error) {
    const code = String(error && error.message || error || "");
    const messages = {
      admin_required: "当前账号没有管理员权限。",
      user_not_found: "没有找到该用户。",
      invalid_uid: "UID 必须是 5—6 位数字。",
      uid_unavailable: "这个 UID 已被占用或已为其他用户预留。",
      cannot_ban_self: "不能封禁自己的管理员账号。",
      cannot_mute_self: "不能禁言自己的管理员账号。",
      cannot_change_own_role: "不能修改自己的管理员权限。",
      user_is_banned: "账号已封禁，无需再设置禁言。",
      account_banned: "该账号已被封禁。",
      invalid_mute_until: "禁言时间无效，最长可设置一年。",
      invalid_platform: "请选择 X 博主或 Discord 社区。",
      invalid_resource_url: "请输入有效的 X 个人主页或 Discord 链接。",
      invalid_avatar_url: "头像链接无效，请使用受支持的 HTTPS 图片地址。",
      invalid_resource_name: "请填写推荐名称。",
      invalid_sort_order: "首页顺序必须是 0—100000 之间的整数。",
      resource_not_found: "这条推荐已经不存在，请刷新后台。",
      directory_failed: "推荐链接保存失败，可能已存在相同链接。",
      authentication_required: "登录已失效，请重新登录。",
      administration_unavailable: "用户管理服务尚未启用。",
      administration_failed: "管理操作暂时失败，请稍后重试。"
    };
    return messages[code] || "操作没有完成，请稍后重试。";
  }

  return Object.freeze({
    ACTION_LABELS,
    validateUid,
    isMuted,
    statusLabel,
    statusTone,
    formatDate,
    muteUntil,
    errorMessage
  });
});
