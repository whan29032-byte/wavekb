(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.ElliottCommunityCore = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const BOARDS = Object.freeze({
    case_submission: Object.freeze({
      title: "提交案例",
      description: "分享行情图、浪型标注与案例分析。"
    }),
    idea_sharing: Object.freeze({
      title: "思路分享",
      description: "分享理论理解、判断思路与复盘总结。"
    }),
    public_viewpoint: Object.freeze({
      title: "公开观点",
      description: "发布可讨论、可追踪并可在个人主页沉淀的市场观点。"
    }),
    question_answers: Object.freeze({
      title: "问题解答",
      description: "把一个明确的波浪问题交给社区，收到基于规则和证据的回答。"
    }),
    review_answers: Object.freeze({
      title: "复盘解答",
      description: "围绕已完成的复盘核验计数、规则和执行偏差。"
    })
  });
  const COMPOSER_TEMPLATES = Object.freeze({
    case_submission: "分析标的与周期：\n\n当前浪级与位置：\n\n首选计数：\n\n备选计数：\n\n支持规则与指南：\n\n失效条件：\n\n需要讨论的问题：\n",
    idea_sharing: "主题：\n\n我的理解：\n\n依据的规则或指南：\n\n可能的例外与边界：\n\n实际应用：\n",
    public_viewpoint: "核心观点：\n\n分析标的与周期：\n\n结构依据：\n\n成立条件：\n\n失效条件：\n\n后续观察：\n",
    question_answers: "问题：\n\n分析标的与周期：\n\n我的当前计数：\n\n已核对的规则：\n\n希望得到的回答：\n",
    review_answers: "复盘对象与周期：\n\n原始计数：\n\n最终走势：\n\n规则核验：\n\n仍未解决的问题：\n"
  });
  const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
  const MAX_IMAGES = 9;
  const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
  const EXTERNAL_KINDS = new Set(["", "youtube", "x"]);

  function externalReference(rawUrl) {
    const value = String(rawUrl || "").trim();
    if (!value) return {ok: true, kind: "", url: ""};
    let parsed;
    try {
      parsed = new URL(value);
    } catch (_) {
      return {ok: false, error: "外部引用需要填写完整的 https 链接。"};
    }
    if (parsed.protocol !== "https:") {
      return {ok: false, error: "外部引用只支持 https 链接。"};
    }
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (["youtube.com", "youtu.be", "m.youtube.com"].includes(host)) {
      return {ok: true, kind: "youtube", url: parsed.toString()};
    }
    if (["x.com", "twitter.com", "mobile.twitter.com"].includes(host)) {
      return {ok: true, kind: "x", url: parsed.toString()};
    }
    return {ok: false, error: "目前只支持引用 YouTube 视频或 X 帖子。"};
  }

  function routeFromHash(hash) {
    const params = new URLSearchParams(String(hash || "").replace(/^#/, ""));
    if (params.has("post")) {
      return {kind: "post", postId: params.get("post")};
    }
    if (BOARDS[params.get("compose")]) {
      const route = {kind: "compose", board: params.get("compose")};
      if (params.get("edit")) {
        route.postId = params.get("edit");
      }
      return route;
    }
    if (BOARDS[params.get("board")]) {
      return {kind: "board", board: params.get("board")};
    }
    return {kind: "knowledge", pageId: params.get("page")};
  }

  function hashForRoute(route) {
    if (route.kind === "post") {
      return `#post=${encodeURIComponent(route.postId)}`;
    }
    if (route.kind === "compose") {
      const hash = `#compose=${encodeURIComponent(route.board)}`;
      return route.postId
        ? `${hash}&edit=${encodeURIComponent(route.postId)}`
        : hash;
    }
    if (route.kind === "board") {
      return `#board=${encodeURIComponent(route.board)}`;
    }
    return `#page=${encodeURIComponent(route.pageId || "")}`;
  }

  function validatePost(input) {
    const fields = {};
    const title = String(input.title || "").trim();
    const body = String(input.body || "").trim();
    if (!BOARDS[input.board]) {
      fields.board = "请选择有效板块。";
    }
    if (title.length < 5 || title.length > 120) {
      fields.title = "标题需要 5—120 个字符。";
    }
    const simpleWithImages = input.mode === "simple" && Number(input.imageCount || 0) > 0;
    const minimumBodyLength = simpleWithImages ? 2 : 20;
    if (body.length < minimumBodyLength || body.length > 20000) {
      fields.body = simpleWithImages
        ? "简易发布附图时，正文至少需要 2 个字符。"
        : "正文需要 20—20000 个字符。";
    }
    const external = externalReference(input.externalUrl);
    if (!external.ok) fields.externalUrl = external.error;
    return {
      ok: Object.keys(fields).length === 0,
      fields,
      value: {
        board: input.board,
        title,
        body,
        externalUrl: external.ok ? external.url : "",
        externalKind: external.ok ? external.kind : ""
      }
    };
  }

  function validateImages(files) {
    const items = Array.from(files || []);
    if (items.length > MAX_IMAGES) {
      return {ok: false, error: "每篇帖子最多上传 9 张图片。"};
    }
    if (items.some(file => !IMAGE_TYPES.has(file.type))) {
      return {ok: false, error: "图片只支持 JPG、PNG 或 WebP。"};
    }
    if (items.some(file => file.size > MAX_IMAGE_BYTES)) {
      return {ok: false, error: "单张图片不能超过 10 MiB。"};
    }
    return {ok: true, error: ""};
  }

  function plainTextExcerpt(text, limit) {
    const normalized = String(text || "").replace(/\s+/g, " ").trim();
    if (normalized.length <= limit) {
      return normalized;
    }
    return `${normalized.slice(0, Math.max(0, limit - 1))}…`;
  }

  function authRedirectUrl(locationLike) {
    return `${locationLike.origin}${locationLike.pathname}`;
  }

  function validateLoginIdentifier(input) {
    const value = String(input || "").trim();
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    const isUid = /^[1-9]\d{4,5}$/.test(value);
    return {
      ok: isEmail || isUid,
      value,
      error: isEmail || isUid ? "" : "请输入有效邮箱或 5—6 位 UID。"
    };
  }

  function validateRegistration(input) {
    const fields = {};
    const displayName = String(input.displayName || "").trim();
    const email = String(input.email || "").trim();
    const verificationCode = String(input.verificationCode || "").trim();
    const password = String(input.password || "");
    const confirmPassword = String(input.confirmPassword || "");
    if (displayName.length < 2 || displayName.length > 32) {
      fields.displayName = "昵称需要 2—32 个字符。";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      fields.email = "请输入有效邮箱。";
    }
    if (password.length < 10) {
      fields.password = "密码至少需要 10 个字符。";
    }
    if (
      Object.prototype.hasOwnProperty.call(input, "confirmPassword")
      && confirmPassword !== password
    ) {
      fields.confirmPassword = "两次输入的密码不一致。";
    }
    return {
      ok: Object.keys(fields).length === 0,
      fields,
      value: {displayName, email, verificationCode, password}
    };
  }

  function composerTemplate(board) {
    return COMPOSER_TEMPLATES[board] || "";
  }

  return {
    BOARDS,
    MAX_IMAGES,
    MAX_IMAGE_BYTES,
    routeFromHash,
    hashForRoute,
    validatePost,
    validateImages,
    plainTextExcerpt,
    authRedirectUrl,
    validateLoginIdentifier,
    validateRegistration,
    composerTemplate,
    externalReference,
    EXTERNAL_KINDS
  };
});
