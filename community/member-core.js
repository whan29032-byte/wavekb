(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.ElliottMemberCore = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ENTRY_KINDS = new Set(["review", "journal", "draft"]);
  const PUBLIC_BOARDS = new Set([
    "public_viewpoint",
    "idea_sharing",
    "case_submission",
    "question_answers",
    "review_answers"
  ]);

  function cleanList(values, limit) {
    return Array.from(values || [])
      .map(value => String(value || "").trim())
      .filter(Boolean)
      .slice(0, limit);
  }

  function validateProfile(input) {
    const value = {
      displayName: String(input.displayName || "").trim(),
      bio: String(input.bio || "").trim(),
      markets: cleanList(input.markets, 8),
      timeframes: cleanList(input.timeframes, 8),
      coverUrl: String(input.coverUrl || "").trim(),
      coverStyle: String(input.coverStyle || "chart-dark").trim()
    };
    const errors = {};
    if (value.displayName.length < 2 || value.displayName.length > 32) {
      errors.displayName = "昵称需要 2—32 个字符。";
    }
    if (value.bio.length > 200) {
      errors.bio = "个性签名不能超过 200 个字符。";
    }
    if (Array.from(input.markets || []).length > 8) {
      errors.markets = "最多选择 8 个关注市场。";
    }
    if (Array.from(input.timeframes || []).length > 8) {
      errors.timeframes = "最多选择 8 个常用周期。";
    }
    return {ok: Object.keys(errors).length === 0, errors, value};
  }

  function validatePrivateEntry(input) {
    const value = {
      kind: String(input.kind || ""),
      title: String(input.title || "").trim(),
      body: String(input.body || "").trim(),
      instrument: String(input.instrument || "").trim(),
      market: String(input.market || "").trim(),
      timeframe: String(input.timeframe || "").trim(),
      tags: cleanList(input.tags, 20),
      knowledge_ids: cleanList(input.knowledge_ids, 40),
      review_data: {...(input.review_data || {})}
    };
    const errors = {};
    if (!ENTRY_KINDS.has(value.kind)) errors.kind = "请选择记录类型。";
    if (!value.title || value.title.length > 120) {
      errors.title = "标题需要 1—120 个字符。";
    }
    if (value.body.length > 50000) {
      errors.body = "正文不能超过 50000 个字符。";
    }
    return {ok: Object.keys(errors).length === 0, errors, value};
  }

  function createPublicSnapshot(entry, publishInput) {
    const source = publishInput || {};
    const snapshot = {
      board: "public_viewpoint",
      title: String(source.title || entry.title || "").trim(),
      body: String(source.body || entry.body || "").trim(),
      summary: String(source.summary || "").trim(),
      tags: cleanList(source.tags || entry.tags, 12),
      knowledge_ids: cleanList(
        source.knowledge_ids || entry.knowledge_ids,
        24
      ),
      comments_enabled: source.comments_enabled !== false
    };
    if (source.external_url) {
      snapshot.external_url = String(source.external_url).trim();
      snapshot.external_kind = String(source.external_kind || "").trim();
    }
    if (PUBLIC_BOARDS.has(source.board)) {
      snapshot.board = source.board;
    }
    return snapshot;
  }

  function memberRouteFromHash(hash) {
    const params = new URLSearchParams(String(hash || "").replace(/^#/, ""));
    if (params.get("space") === "entry" && params.get("entry")) {
      return {kind: "member-entry", entryId: params.get("entry")};
    }
    if (params.get("space") === "profile") {
      return {kind: "member", view: "profile"};
    }
    if (params.get("space")) {
      return {
        kind: "member",
        view: params.get("space") || "home",
        uid: params.get("uid") || "",
        conversationId: params.get("conversation") || "",
        peerId: params.get("peer") || "",
        mentorThreadId: params.get("student") || ""
      };
    }
    if (params.get("community") === "feed") {
      return {kind: "community-feed"};
    }
    if (params.get("viewpoint")) {
      return {kind: "public-viewpoint", postId: params.get("viewpoint")};
    }
    if (params.get("author")) {
      return {kind: "public-author", authorId: params.get("author")};
    }
    return null;
  }

  function hashForMemberRoute(route) {
    if (route.kind === "member-entry") {
      return `#space=entry&entry=${encodeURIComponent(route.entryId)}`;
    }
    if (route.kind === "member") {
      const params = new URLSearchParams();
      params.set("space", route.view || "home");
      if (route.uid) params.set("uid", route.uid);
      if (route.conversationId) params.set("conversation", route.conversationId);
      if (route.peerId) params.set("peer", route.peerId);
      if (route.mentorThreadId) params.set("student", route.mentorThreadId);
      return `#${params.toString()}`;
    }
    if (route.kind === "community-feed") return "#community=feed";
    if (route.kind === "public-viewpoint") {
      return `#viewpoint=${encodeURIComponent(route.postId)}`;
    }
    if (route.kind === "public-author") {
      return `#author=${encodeURIComponent(route.authorId)}`;
    }
    return "#space=home";
  }

  return {
    ENTRY_KINDS,
    PUBLIC_BOARDS,
    validateProfile,
    validatePrivateEntry,
    createPublicSnapshot,
    memberRouteFromHash,
    hashForMemberRoute
  };
});
