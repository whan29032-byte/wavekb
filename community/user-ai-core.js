(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.ElliottUserAICore = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ADAPTERS = Object.freeze({
    openai_compatible: {
      label: "OpenAI 兼容接口",
      hint: "适用于 OpenAI、Kimi、本地模型和自建兼容接口",
      baseUrl: "https://api.openai.com/v1"
    },
    anthropic: {
      label: "Claude / Anthropic",
      hint: "使用 Anthropic Messages API",
      baseUrl: "https://api.anthropic.com"
    },
    gemini: {
      label: "Gemini",
      hint: "使用 Google Generative Language API",
      baseUrl: "https://generativelanguage.googleapis.com"
    }
  });

  const PROVIDER_PRESETS = Object.freeze({
    openai_compatible: {
      label: "OpenAI 兼容接口",
      hint: "适用于 OpenAI、Kimi、本地模型和自建兼容接口",
      adapter: "openai_compatible",
      baseUrl: "https://api.openai.com/v1",
      modelName: ""
    },
    deepseek: {
      label: "DeepSeek",
      hint: "使用 DeepSeek 官方 OpenAI 兼容接口，API Key 由用户自行提供",
      adapter: "openai_compatible",
      baseUrl: "https://api.deepseek.com",
      modelName: "deepseek-v4-flash"
    },
    anthropic: {
      label: "Claude / Anthropic",
      hint: "使用 Anthropic Messages API",
      adapter: "anthropic",
      baseUrl: "https://api.anthropic.com",
      modelName: ""
    },
    gemini: {
      label: "Gemini",
      hint: "使用 Google Generative Language API",
      adapter: "gemini",
      baseUrl: "https://generativelanguage.googleapis.com",
      modelName: ""
    }
  });

  function routeFromHash(hash) {
    const params = new URLSearchParams(String(hash || "").replace(/^#/, ""));
    if (params.has("workbench") && params.get("panel") === "ai") {
      return {kind: "user-ai-settings", embeddedInWorkbench: true};
    }
    return params.get("space") === "ai-settings"
      ? {kind: "user-ai-settings", embeddedInWorkbench: false}
      : null;
  }

  function validateConnection(input) {
    const value = {
      label: String(input.label || "").trim(),
      adapter: String(input.adapter || ""),
      base_url: String(input.base_url || "").trim(),
      model_name: String(input.model_name || "").trim(),
      api_key: String(input.api_key || "").trim(),
      max_output_tokens: Number(input.max_output_tokens || 4096),
      context_tokens: Number(input.context_tokens || 32768),
      temperature: Number(input.temperature ?? 0.2),
      timeout_ms: Number(input.timeout_ms || 60000),
      is_default: input.is_default !== false
    };
    const errors = {};
    if (value.label.length < 2 || value.label.length > 60) {
      errors.label = "名称需要 2—60 个字符。";
    }
    if (!Object.prototype.hasOwnProperty.call(ADAPTERS, value.adapter)) {
      errors.adapter = "请选择接口类型。";
    }
    try {
      const url = new URL(value.base_url);
      if (!["https:", "http:"].includes(url.protocol)) throw new Error("protocol");
    } catch (_) {
      errors.base_url = "请输入完整的接口地址。";
    }
    if (!value.model_name || value.model_name.length > 120) {
      errors.model_name = "请填写模型名称。";
    }
    if (!value.api_key) errors.api_key = "请填写 API Key。";
    if (
      !Number.isInteger(value.max_output_tokens)
      || value.max_output_tokens < 1
      || value.max_output_tokens > 262144
    ) {
      errors.max_output_tokens = "最大输出长度不在允许范围内。";
    }
    if (value.temperature < 0 || value.temperature > 2) {
      errors.temperature = "温度参数需要在 0—2 之间。";
    }
    return {ok: Object.keys(errors).length === 0, errors, value};
  }

  function connectionSummary(connection) {
    const isDeepSeek = /^https:\/\/api\.deepseek\.com(?:\/|$)/i.test(
      String(connection.base_url || "").trim()
    );
    return {
      title: connection.label || "未命名接口",
      model: connection.model_name || "未选择模型",
      adapter: isDeepSeek
        ? "DeepSeek"
        : ADAPTERS[connection.adapter]?.label || connection.adapter,
      secret: connection.secret_mask || "未设置",
      status: connection.enabled === false
        ? "已停用"
        : connection.is_default
          ? "当前使用"
          : "可选"
    };
  }

  return {
    ADAPTERS,
    PROVIDER_PRESETS,
    routeFromHash,
    validateConnection,
    connectionSummary
  };
});
