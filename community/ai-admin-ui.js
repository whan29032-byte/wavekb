(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ElliottAIAdminUI = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VIEWS = Object.freeze([
    ["overview", "总览"],
    ["providers", "平台备用接口"],
    ["models", "平台路由"],
    ["routes", "任务路由"],
    ["prompts", "提示词"],
    ["knowledge", "知识连接"],
    ["logs", "调用与费用"],
    ["reviews", "审核队列"]
  ]);

  function providerView(provider) {
    const lastFour = String(provider && provider.last_four || "").slice(-4);
    return {
      id: String(provider && provider.id || ""),
      name: String(provider && provider.name || ""),
      adapter: String(provider && provider.adapter || ""),
      baseUrl: String(provider && provider.base_url || ""),
      enabled: provider && provider.enabled !== false,
      secretLabel: lastFour ? `••••${lastFour}` : "尚未设置"
    };
  }

  function aiAdminRouteFromHash(hash) {
    const params = new URLSearchParams(String(hash || "").replace(/^#/, ""));
    const view = params.get("ai-admin");
    if (!view) return null;
    return {
      kind: "ai-admin",
      view: VIEWS.some(item => item[0] === view) ? view : "overview"
    };
  }

  function taskCards() {
    return [
      {
        key: "chart_recognition",
        title: "图表识别",
        description: "读取K线、画线、浪型标记以及价格与时间坐标。"
      },
      {
        key: "wave_analysis",
        title: "波浪分析",
        description: "确认级别与结构，生成主计数、备选计数和失效条件。"
      },
      {
        key: "risk_control",
        title: "风控计算",
        description: "服务器确定性计算仓位、最大亏损和盈亏比。"
      },
      {
        key: "review",
        title: "复盘审核",
        description: "对照实际走势提取错误，等待人工批准后才进入经验库。"
      }
    ];
  }

  function createAIAdminUI(options) {
    const contentHost = options.contentHost;
    const breadcrumbHost = options.breadcrumbHost;
    const auth = options.auth;
    const gatewayUrl = String(options.gatewayUrl || "").replace(/\/$/, "");
    const navigate = options.navigate;
    const doc = contentHost.ownerDocument;

    function element(tag, className, text) {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    function button(text, className = "btn btn-ghost") {
      const node = element("button", className, text);
      node.type = "button";
      return node;
    }

    function field(label, input, hint) {
      const wrapper = element("label", "community-field");
      wrapper.append(element("span", "", label), input);
      if (hint) wrapper.appendChild(element("small", "text-muted", hint));
      return wrapper;
    }

    function setBreadcrumb(view) {
      const list = element("ol", "kb-breadcrumb-list");
      const homeItem = element("li");
      const homeLink = element("a", "", "个人空间");
      homeLink.href = "#space=home";
      homeItem.appendChild(homeLink);
      const centerItem = element("li");
      centerItem.append(doc.createTextNode("› "), element("span", "", "AI 控制中心"));
      const viewItem = element("li");
      viewItem.append(
        doc.createTextNode("› "),
        element("span", "", VIEWS.find(item => item[0] === view)?.[1] || "总览")
      );
      list.append(homeItem, centerItem, viewItem);
      breadcrumbHost.replaceChildren(list);
    }

    function notice(title, message) {
      const panel = element("section", "community-notice");
      panel.append(element("h2", "", title), element("p", "", message));
      return panel;
    }

    function adminActor() {
      const actor = auth.actor();
      return actor && actor.role === "admin" ? actor : null;
    }

    function accessToken() {
      return auth.session() && auth.session().access_token || "";
    }

    async function request(path, requestOptions) {
      if (!gatewayUrl) throw new Error("尚未配置AI网关地址。");
      const response = await fetch(`${gatewayUrl}${path}`, {
        ...requestOptions,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken()}`,
          ...(requestOptions && requestOptions.headers || {})
        }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.message || payload.error || `网关返回 ${response.status}`);
      }
      return payload;
    }

    function navigation(view) {
      const nav = element("nav", "ai-admin-tabs");
      nav.setAttribute("aria-label", "AI控制中心");
      VIEWS.forEach(([key, label]) => {
        const link = element("a", "ai-admin-tab", label);
        link.href = `#ai-admin=${key}`;
        if (key === view) link.setAttribute("aria-current", "page");
        link.addEventListener("click", event => {
          event.preventDefault();
          navigate(link.hash);
        });
        nav.appendChild(link);
      });
      return nav;
    }

    function shell(view, body) {
      const fragment = doc.createDocumentFragment();
      const header = element("header", "ai-admin-hero");
      const copy = element("div");
      copy.append(
        element("p", "member-eyebrow", "SERVER-SIDE AI ORCHESTRATION"),
        element("h1", "", "网站 AI 治理中心"),
        element(
          "p",
          "text-muted",
          "用户自行连接模型；管理员只管理网站知识库、提示词、规则闸门、审计，以及可选的平台备用接口。"
        )
      );
      const status = element("div", "ai-gateway-status");
      status.append(
        element("span", "ai-status-dot"),
        element("span", "", gatewayUrl ? "服务器中转" : "等待配置")
      );
      header.append(copy, status);
      fragment.append(header, navigation(view), body);
      return fragment;
    }

    function metric(label, value, note) {
      const card = element("article", "ai-metric-card");
      card.append(
        element("span", "text-small text-muted", label),
        element("strong", "", value),
        element("span", "text-small text-muted", note)
      );
      return card;
    }

    async function overviewPanel() {
      const panel = element("div", "ai-admin-stack");
      let dashboard = {
        calls_today: 0,
        tokens_today: 0,
        cost_today: 0,
        failed_today: 0,
        review_queue: 0
      };
      let online = false;
      try {
        dashboard = {...dashboard, ...await request("/v1/admin/dashboard")};
        online = true;
      } catch (_) {
        // The control surface stays inspectable while the local gateway is stopped.
      }
      const banner = element("section", online ? "ai-health-banner is-online" : "ai-health-banner");
      banner.append(
        element("strong", "", online ? "AI 网关已连接" : "AI 网关尚未启动"),
        element(
          "p",
          "",
          online
            ? "服务端密钥、路由、日志和预算控制均可用。"
            : "知识库与工作台仍可离线使用；启动服务器网关后才会发生外部模型调用。"
        )
      );
      const metrics = element("section", "ai-metric-grid");
      metrics.append(
        metric("今日调用", String(dashboard.calls_today), "所有任务"),
        metric("今日 Token", Number(dashboard.tokens_today).toLocaleString("zh-CN"), "输入 + 输出"),
        metric("今日费用", `$${Number(dashboard.cost_today).toFixed(2)}`, "服务器账本"),
        metric("失败请求", String(dashboard.failed_today), "可检查故障切换"),
        metric("待人工审核", String(dashboard.review_queue), "不会自动入库")
      );
      const flow = element("section", "ai-flow-panel");
      flow.append(element("h2", "", "分析调用链"));
      [
        ["01", "接收图表", "校验账户、图片大小与每日额度"],
        ["02", "知识检索", "规则优先：第10版原书 → 指南 → 案例 → 私人经验"],
        ["03", "模型分工", "图表识别、波浪分析、风控和复盘独立路由"],
        ["04", "规则闸门", "硬规则淘汰违规方案，程序覆盖风险数字"],
        ["05", "保存与审核", "记录模型、提示词、知识版本、Token与费用"]
      ].forEach(([number, title, copy]) => {
        const item = element("article", "ai-flow-step");
        item.append(
          element("span", "ai-flow-number", number),
          element("strong", "", title),
          element("p", "text-muted", copy)
        );
        flow.appendChild(item);
      });
      panel.append(banner, metrics, flow);
      return panel;
    }

    function providerCard(provider) {
      const view = providerView(provider);
      const card = element("article", "ai-provider-card");
      const top = element("div", "ai-provider-top");
      top.append(
        element("div", "ai-provider-mark", view.name.slice(0, 1).toUpperCase() || "AI"),
        element("div", "", "")
      );
      top.lastChild.append(
        element("h3", "", view.name || "未命名服务商"),
        element("p", "text-small text-muted", view.adapter || "适配器未选择")
      );
      const status = element("span", view.enabled ? "ai-chip is-active" : "ai-chip", view.enabled ? "已启用" : "已停用");
      top.appendChild(status);
      const details = element("dl", "ai-provider-details");
      [["接口", view.baseUrl || "未配置"], ["密钥", view.secretLabel]].forEach(([label, value]) => {
        details.append(element("dt", "", label), element("dd", "", value));
      });
      card.append(top, details);
      return card;
    }

    function providerForm(onSaved) {
      const form = element("form", "ai-provider-form");
      const title = element("input");
      title.required = true;
      title.maxLength = 80;
      title.placeholder = "例如 Kimi 生产接口";
      const adapter = element("select");
      [
        ["openai_compatible", "OpenAI 兼容（含 Kimi / DeepSeek / 本地模型）"],
        ["anthropic", "Anthropic Messages"],
        ["gemini", "Google Gemini"]
      ].forEach(([value, label]) => {
        const option = element("option", "", label);
        option.value = value;
        adapter.appendChild(option);
      });
      const url = element("input");
      url.type = "url";
      url.required = true;
      url.placeholder = "https://api.example.com/v1";
      const secret = element("input");
      secret.type = "password";
      secret.required = true;
      secret.autocomplete = "new-password";
      secret.placeholder = "只写入服务器，不会回显";
      const message = element("p", "text-small text-muted", "保存前将由服务器验证地址和连接；浏览器永远不会读取已保存密钥。");
      const submit = button("测试并保存", "btn btn-primary");
      submit.type = "submit";
      form.append(
        element("h2", "", "连接新的模型服务"),
        field("服务商名称", title),
        field("适配器", adapter),
        field("API 地址", url, "公网地址必须使用 HTTPS；本地地址需要服务器白名单。"),
        field("API Key", secret, "保存后仅显示末四位。"),
        message,
        submit
      );
      form.addEventListener("submit", async event => {
        event.preventDefault();
        submit.disabled = true;
        message.textContent = "正在由服务器测试连接…";
        try {
          await request("/v1/admin/providers", {
            method: "POST",
            body: JSON.stringify({
              name: title.value.trim(),
              adapter: adapter.value,
              base_url: url.value.trim(),
              api_key: secret.value
            })
          });
          secret.value = "";
          message.textContent = "连接成功，密钥已加密保存。";
          await onSaved();
        } catch (error) {
          message.textContent = String(error && error.message || error);
        } finally {
          submit.disabled = false;
        }
      });
      return form;
    }

    async function providersPanel() {
      const layout = element("div", "ai-provider-layout");
      const list = element("section", "ai-admin-stack");
      let providers = [];
      try {
        const payload = await request("/v1/admin/providers");
        providers = payload.providers || [];
      } catch (_) {
        providers = [];
      }
      list.append(
        element("h2", "", "平台备用接口"),
        element("p", "text-muted", "仅在网站明确启用平台兜底时使用；用户的私人接口不会出现在这里。")
      );
      if (providers.length) providers.forEach(item => list.appendChild(providerCard(item)));
      else list.appendChild(notice("暂无服务商", "填写右侧表单，或先启动本地AI网关。"));
      const rerender = async () => contentHost.replaceChildren(shell("providers", await providersPanel()));
      layout.append(list, providerForm(rerender));
      return layout;
    }

    function taskPanel() {
      const panel = element("section", "ai-admin-stack");
      panel.append(
        element("h2", "", "平台任务治理"),
        element("p", "text-muted", "工作台优先使用用户选择的模型；这里管理提示词、超时、格式校验和平台备用策略。")
      );
      const grid = element("div", "ai-task-grid");
      taskCards().forEach(item => {
        const card = element("article", "ai-task-card");
        card.append(
          element("span", "ai-chip", item.key),
          element("h3", "", item.title),
          element("p", "text-muted", item.description),
          element("button", "btn btn-ghost", "配置路由")
        );
        grid.appendChild(card);
      });
      panel.appendChild(grid);
      return panel;
    }

    function infoPanel(view) {
      const definitions = {
        routes: ["工作台调用顺序", "图表识别 → 级别确认 → 结构判断 → 规则检查 → 风控计算 → 保存分析 → 复盘审核。"],
        prompts: ["提示词版本管理", "系统、规则、级别、回撤、方案、风控、复盘与图表识别提示词分别版本化；测试和正式环境可独立发布与回滚。"],
        knowledge: ["知识库连接", "检索强制保留知识ID、来源版本与原书PDF页；第10版硬规则始终排在指南、案例和私人经验之前。"],
        logs: ["成本与故障日志", "按用户、功能、模型记录Token、费用、延迟与错误类型；主模型失败后显示实际切换到的备用模型。"],
        reviews: ["人工审核队列", "AI复盘只能进入待审核区；管理员确认结构和实际结果后，才允许发布为正式经验。"]
      };
      const [title, copy] = definitions[view] || definitions.routes;
      const panel = element("section", "ai-admin-stack");
      panel.append(element("h2", "", title), element("p", "text-muted", copy));
      const checklist = element("div", "ai-policy-list");
      [
        "密钥仅服务器端 AES-256-GCM 加密保存",
        "用户额度、IP限流、图片大小与请求长度前置检查",
        "输出先做结构校验，再进入第10版规则闸门",
        "确定性计算覆盖模型生成的仓位与风险数字",
        "每次调用保留幂等键、实际模型、提示词和知识版本"
      ].forEach(item => {
        const row = element("div", "ai-policy-item");
        row.append(element("span", "ai-policy-check", "✓"), element("span", "", item));
        checklist.appendChild(row);
      });
      panel.appendChild(checklist);
      return panel;
    }

    async function render(route) {
      const view = route && route.view || "overview";
      setBreadcrumb(view);
      if (!adminActor()) {
        contentHost.replaceChildren(notice(
          "仅管理员可访问",
          "网站提示词、知识库治理、平台备用接口、费用审计和审核队列不会向普通用户开放；用户只管理自己的接口。"
        ));
        return;
      }
      contentHost.replaceChildren(notice("正在打开", "正在读取AI控制中心。"));
      let body;
      if (view === "overview") body = await overviewPanel();
      else if (view === "providers") body = await providersPanel();
      else if (view === "models") body = taskPanel();
      else body = infoPanel(view);
      contentHost.replaceChildren(shell(view, body));
    }

    return {render};
  }

  return {
    VIEWS,
    providerView,
    aiAdminRouteFromHash,
    taskCards,
    createAIAdminUI
  };
});
