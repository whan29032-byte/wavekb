(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.ElliottMentorCore = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function routeFromHash(hash) {
    const params = new URLSearchParams(String(hash || "").replace(/^#/, ""));
    if (params.get("mentors") === "catalog") return {kind: "mentor-catalog"};
    if (params.get("mentor")) {
      return {kind: "mentor-detail", mentorId: params.get("mentor")};
    }
    if (params.get("tutoring") === "thread" && params.get("id")) {
      return {kind: "mentor-thread", threadId: params.get("id")};
    }
    if (params.get("mentors") === "success") {
      return {
        kind: "mentor-payment-success",
        orderId: params.get("order") || ""
      };
    }
    return null;
  }

  function hashForRoute(route) {
    if (route.kind === "mentor-detail") {
      return `#mentor=${encodeURIComponent(route.mentorId)}`;
    }
    if (route.kind === "mentor-thread") {
      return `#tutoring=thread&id=${encodeURIComponent(route.threadId)}`;
    }
    if (route.kind === "mentor-payment-success") {
      return `#mentors=success&order=${encodeURIComponent(route.orderId || "")}`;
    }
    return "#mentors=catalog";
  }

  function formatPrice(cents, currency) {
    const amount = Number(cents || 0) / 100;
    const code = String(currency || "USDT").toUpperCase();
    if (code === "USDT") {
      return `${new Intl.NumberFormat("zh-CN", {
        minimumFractionDigits: amount % 1 ? 2 : 0,
        maximumFractionDigits: 2
      }).format(amount)} USDT`;
    }
    return new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency: code,
      minimumFractionDigits: amount % 1 ? 2 : 0
    }).format(amount);
  }

  function remainingQuota(access) {
    return Math.max(
      0,
      Number(access && access.weekly_question_limit || 0)
        - Number(access && access.questions_used || 0)
    );
  }

  function validateQuestion(value) {
    const body = String(value || "").trim();
    if (body.length < 5) {
      return {ok: false, message: "问题至少需要 5 个字符。", value: body};
    }
    if (body.length > 5000) {
      return {ok: false, message: "单次提问不能超过 5000 个字符。", value: body};
    }
    return {ok: true, value: body};
  }

  return {
    routeFromHash,
    hashForRoute,
    formatPrice,
    remainingQuota,
    validateQuestion
  };
});
