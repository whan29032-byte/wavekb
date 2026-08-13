(function (root, factory) {
  const core = typeof module === "object" && module.exports
    ? require("./user-ai-core.js")
    : root.ElliottUserAICore;
  const api = factory(core);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ElliottUserAIUI = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (core) {
  "use strict";

  function createUserAIUI(options) {
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

    function notice(title, message) {
      const panel = element("section", "community-notice");
      panel.append(element("h2", "", title), element("p", "", message));
      return panel;
    }

    function setBreadcrumb(route = {}) {
      const list = element("ol", "kb-breadcrumb-list");
      const home = element("a", "kb-knowledge-link", route.embeddedInWorkbench ? "交易工作台" : "个人空间");
      home.href = route.embeddedInWorkbench ? "#workbench=new&step=0" : "#space=home";
      home.addEventListener("click", event => {
        event.preventDefault();
        navigate(home.hash);
      });
      const first = element("li");
      first.appendChild(home);
      const second = element("li");
      second.append(doc.createTextNode("› AI 控制中心"));
      list.append(first, second);
      breadcrumbHost.replaceChildren(list);
    }

    function workbenchNav() {
      const nav = element("nav", "workbench-section-nav");
      nav.setAttribute("aria-label", "交易工作台区域");
      [
        ["#workbench=new&step=0", "分析流程"],
        ["#workbench=new&step=0&panel=records&records=all", "复盘与记录"],
        ["#workbench=new&step=0&panel=ai", "AI 模型"]
      ].forEach(([hash, label], index) => {
        const link = element("a", "workbench-section-link", label);
        link.href = hash;
        if (index === 2) link.setAttribute("aria-current", "page");
        link.addEventListener("click", event => {
          event.preventDefault();
          navigate(link.hash);
        });
        nav.appendChild(link);
      });
      return nav;
    }

    async function request(path, init = {}) {
      const session = auth.session();
      const token = session && session.access_token;
      if (!token) throw new Error("登录会话已失效，请重新登录。");
      const response = await fetch(`${gatewayUrl}${path}`, {
        ...init,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          ...(init.headers || {})
        }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const labels = {
          authentication_required: "请重新登录。",
          request_failed: "保存失败，请检查接口地址和参数。"
        };
        throw new Error(labels[payload.error] || payload.error || `请求失败：${response.status}`);
      }
      return payload;
    }

    function field(label, input, wide = false) {
      const wrapper = element("label", `community-field${wide ? " community-field-wide" : ""}`);
      wrapper.append(element("span", "", label), input);
      return wrapper;
    }

    function renderConnectionCard(connection, reload) {
      const summary = core.connectionSummary(connection);
      const card = element("article", "user-ai-card");
      const head = element("div", "user-ai-card-head");
      head.append(
        element("strong", "", summary.title),
        element("span", "user-ai-status", summary.status)
      );
      const actions = element("div", "user-ai-card-actions");
      const secret = element("span", "text-small text-muted", `密钥 ${summary.secret}`);
      actions.appendChild(secret);
      if (!connection.is_default && connection.enabled !== false) {
        const use = button("设为默认");
        use.addEventListener("click", async () => {
          use.disabled = true;
          try {
            await request(
              `/v1/user/ai-connections/${encodeURIComponent(connection.id)}/default`,
              {method: "POST"}
            );
            await reload();
          } catch (error) {
            use.textContent = String(error.message || error);
            use.disabled = false;
          }
        });
        actions.appendChild(use);
      }
      const rotate = button("更换密钥");
      const rotateForm = element("form", "user-ai-rotate");
      rotateForm.hidden = true;
      const replacement = element("input");
      replacement.type = "password";
      replacement.autocomplete = "new-password";
      replacement.placeholder = "输入新的 API Key";
      const rotateStatus = element("span", "text-small text-muted");
      const rotateSubmit = button("加密保存", "btn btn-primary");
      rotateSubmit.type = "submit";
      rotateForm.append(replacement, rotateSubmit, rotateStatus);
      rotate.addEventListener("click", () => {
        rotateForm.hidden = !rotateForm.hidden;
        if (!rotateForm.hidden) replacement.focus();
      });
      rotateForm.addEventListener("submit", async event => {
        event.preventDefault();
        if (!replacement.value.trim()) {
          rotateStatus.textContent = "请填写新密钥。";
          return;
        }
        rotateSubmit.disabled = true;
        rotateStatus.textContent = "正在轮换…";
        try {
          await request(
            `/v1/user/ai-connections/${encodeURIComponent(connection.id)}/rotate-key`,
            {
              method: "POST",
              body: JSON.stringify({api_key: replacement.value})
            }
          );
          replacement.value = "";
          await reload();
        } catch (error) {
          rotateStatus.textContent = String(error.message || error);
          rotateSubmit.disabled = false;
        }
      });
      actions.appendChild(rotate);
      card.append(
        head,
        element("p", "user-ai-model", summary.model),
        element("p", "text-small text-muted", `${summary.adapter} · ${connection.base_url}`),
        actions,
        rotateForm
      );
      return card;
    }

    function renderForm(reload) {
      const form = element("form", "user-ai-form");
      form.append(
        element("p", "member-eyebrow", "用户自带模型 · BYOK"),
        element("h2", "", "添加我的 AI 接口"),
        element(
          "p",
          "text-muted",
          "你决定调用哪个模型；本站只负责检索知识库、注入规则、校验结果并保存分析记录。"
        )
      );
      const grid = element("div", "user-ai-form-grid");
      const label = element("input");
      label.placeholder = "例如：我的 Kimi";
      label.maxLength = 60;
      const providers = core.PROVIDER_PRESETS || core.ADAPTERS;
      const adapter = element("select");
      Object.entries(providers).forEach(([value, meta]) => {
        const option = element("option", "", meta.label);
        option.value = value;
        adapter.appendChild(option);
      });
      const baseUrl = element("input");
      baseUrl.type = "url";
      baseUrl.value = providers.openai_compatible.baseUrl;
      const model = element("input");
      model.placeholder = "填写服务商提供的模型名称";
      const providerHint = element("p", "text-small text-muted user-ai-provider-hint");
      const key = element("input");
      key.type = "password";
      key.autocomplete = "new-password";
      key.placeholder = "只在保存时发送，不会再次显示";
      const output = element("input");
      output.type = "number";
      output.min = "1";
      output.max = "262144";
      output.value = "4096";
      const temperature = element("input");
      temperature.type = "number";
      temperature.min = "0";
      temperature.max = "2";
      temperature.step = "0.05";
      temperature.value = "0.2";
      function selectedProvider() {
        return providers[adapter.value] || providers.openai_compatible;
      }
      function paintProviderHint() {
        const meta = selectedProvider();
        providerHint.textContent = meta.hint || "填写服务商提供的接口配置。";
      }
      adapter.addEventListener("change", () => {
        const previousDefault = Object.values(providers)
          .some(item => item.baseUrl === baseUrl.value);
        const previousModelDefault = Object.values(providers)
          .some(item => item.modelName && item.modelName === model.value);
        const meta = selectedProvider();
        if (previousDefault) baseUrl.value = meta.baseUrl;
        if (!model.value || previousModelDefault) model.value = meta.modelName || "";
        label.placeholder = adapter.value === "deepseek"
          ? "例如：我的 DeepSeek"
          : "例如：我的 Kimi";
        paintProviderHint();
      });
      paintProviderHint();
      grid.append(
        field("接口名称", label),
        field("API 服务商", adapter),
        providerHint,
        field("API 地址", baseUrl, true),
        field("模型名称", model),
        field("最大输出长度", output),
        field("温度参数", temperature),
        field("API Key", key, true)
      );
      const security = element("div", "user-ai-security");
      security.append(
        element("strong", "", "模型来自你，知识来自本站"),
        element(
          "p",
          "text-small",
          "密钥仅发送到本站服务器并加密保存；浏览器和其他用户都无法读取。分析时，服务器从网站内的第10版知识库检索相关规则，再把必要片段交给你选择的模型。"
        )
      );
      const status = element("p", "text-small text-muted");
      const submit = button("保存并加密", "btn btn-primary");
      submit.type = "submit";
      form.append(grid, security, submit, status);
      form.addEventListener("submit", async event => {
        event.preventDefault();
        const providerMeta = selectedProvider();
        const result = core.validateConnection({
          label: label.value,
          adapter: providerMeta.adapter || adapter.value,
          base_url: baseUrl.value,
          model_name: model.value,
          api_key: key.value,
          max_output_tokens: output.value,
          temperature: temperature.value
        });
        if (!result.ok) {
          status.textContent = Object.values(result.errors).join(" ");
          return;
        }
        submit.disabled = true;
        status.textContent = "正在由服务器加密保存…";
        try {
          await request("/v1/user/ai-connections", {
            method: "POST",
            body: JSON.stringify(result.value)
          });
          key.value = "";
          status.textContent = "接口已保存。API Key 不会在网页中回显。";
          await reload();
        } catch (error) {
          status.textContent = String(error.message || error);
        } finally {
          submit.disabled = false;
        }
      });
      return form;
    }

    async function render(route = {}) {
      setBreadcrumb(route);
      const actor = auth.actor();
      if (!actor) {
        contentHost.replaceChildren(notice("登录后设置 AI 接口", "请先使用右上角登录。"));
        return;
      }
      if (!gatewayUrl) {
        contentHost.replaceChildren(notice("AI 网关尚未连接", "网站知识库仍可使用；连接服务器后即可保存个人接口。"));
        return;
      }
      contentHost.replaceChildren(notice("正在读取", "正在读取你的私有接口配置。"));
      const load = async () => {
        const payload = await request("/v1/user/ai-connections");
        const connections = payload.connections || [];
        const fragment = doc.createDocumentFragment();
        const hero = element("section", "user-ai-hero");
        const copy = element("div");
        copy.append(
          element("p", "member-eyebrow", "AI 控制中心"),
          element("h1", "", "连接你想使用的模型"),
          element("p", "text-muted", "模型选择权归你；知识、规则和核验流程留在本站。")
        );
        const heroActions = element("div", "user-ai-hero-actions");
        const workbench = element("a", "btn btn-primary", "进入交易工作台");
        workbench.href = "#workbench=new&step=0";
        workbench.addEventListener("click", event => {
          event.preventDefault();
          navigate(workbench.hash);
        });
        heroActions.appendChild(workbench);
        if (actor.role === "admin") {
          const adminSettings = element("a", "btn btn-ghost member-ai-admin-shortcut", "管理员模型配置");
          adminSettings.href = "#ai-admin=overview";
          adminSettings.addEventListener("click", event => {
            event.preventDefault();
            navigate(adminSettings.hash);
          });
          heroActions.appendChild(adminSettings);
        }
        hero.append(copy, heroActions);
        const boundary = element("section", "user-ai-boundary");
        const modelSide = element("div");
        modelSide.append(
          element("strong", "", "你的模型接口"),
          element("p", "text-small text-muted", "API 地址、模型与费用由你选择和承担。")
        );
        const knowledgeSide = element("div");
        knowledgeSide.append(
          element("strong", "", "网站内置知识库"),
          element("p", "text-small text-muted", "第10版规则、指南、图示与核验记录由网站统一检索。")
        );
        boundary.append(modelSide, knowledgeSide);
        const grid = element("section", "user-ai-grid");
        if (connections.length) {
          connections.forEach(item => grid.appendChild(renderConnectionCard(item, load)));
        } else {
          grid.appendChild(notice("尚未连接模型", "添加一个接口后，交易工作台即可提交 AI 分析。"));
        }
        if (route.embeddedInWorkbench) fragment.appendChild(workbenchNav());
        fragment.append(hero, boundary, grid, renderForm(load));
        contentHost.replaceChildren(fragment);
      };
      try {
        await load();
      } catch (error) {
        contentHost.replaceChildren(notice("无法读取接口配置", String(error.message || error)));
      }
    }

    return {render};
  }

  return {createUserAIUI};
});
