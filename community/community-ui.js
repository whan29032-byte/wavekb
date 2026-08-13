(function (root, factory) {
  const core = typeof module === "object" && module.exports
    ? require("./community-core.js")
    : root.ElliottCommunityCore;
  const catalog = typeof module === "object" && module.exports
    ? require("./research-catalog.js")
    : root.ElliottResearchCatalog;
  const tv = typeof module === "object" && module.exports
    ? require("./tv-review.js")
    : root.ElliottTVReview;
  const imageAttachments = typeof module === "object" && module.exports
    ? require("./image-attachments.js")
    : root.WaveKBImageAttachments;
  const api = factory(core, catalog, tv, imageAttachments);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.ElliottCommunityUI = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (core, catalog, tv, imageAttachments) {
  "use strict";

  function formatDate(value, locale = "zh-CN", timeZone) {
    if (!value) return "时间未知";
    const options = {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    };
    if (timeZone) options.timeZone = timeZone;
    return new Intl.DateTimeFormat(locale, options).format(new Date(value));
  }

  function profileOf(post) {
    if (Array.isArray(post.profiles)) return post.profiles[0] || {};
    return post.profiles || {};
  }

  function postCardModel(post) {
    const profile = profileOf(post);
    return {
      id: post.id,
      title: String(post.title || ""),
      excerpt: core.plainTextExcerpt(post.body, 140),
      author: profile.display_name || "匿名用户",
      ...(profile.public_uid == null ? {} : {publicUid: Number(profile.public_uid)}),
      imageCount: Array.isArray(post.post_images) ? post.post_images.length : 0,
      createdAt: post.created_at
    };
  }

  function isFiveDigitUid(value) {
    return /^\d{5}$/.test(String(value || ""));
  }

  const AUTH_MODE_PRESENTATIONS = Object.freeze({
    login: Object.freeze({
      eyebrow: "账号访问",
      title: "欢迎回来",
      description: "登录后可提交案例、分享思路并管理自己的内容。",
      submitLabel: "登录"
    }),
    register: Object.freeze({
      eyebrow: "创建账号",
      title: "加入知识库",
      description: "注册后请前往邮箱完成验证，再登录并发布内容。",
      submitLabel: "注册并发送验证邮件"
    }),
    reset: Object.freeze({
      eyebrow: "找回密码",
      title: "重置密码",
      description: "输入注册邮箱，我们会发送密码重置链接。",
      submitLabel: "发送重置链接"
    }),
    recovery: Object.freeze({
      eyebrow: "账号安全",
      title: "设置新密码",
      description: "重置链接已验证，请设置一个新的登录密码。",
      submitLabel: "保存新密码"
    }),
    resend: Object.freeze({
      eyebrow: "邮箱验证",
      title: "重新发送验证邮件",
      description: "没有收到邮件？输入注册邮箱后重新发送验证链接。",
      submitLabel: "发送验证邮件"
    })
  });

  function authModePresentation(mode) {
    return AUTH_MODE_PRESENTATIONS[mode] || AUTH_MODE_PRESENTATIONS.login;
  }

  function authModeSwitch(mode) {
    if (mode === "login") {
      return {label: "没有账号？立即注册", target: "register"};
    }
    if (mode === "register") {
      return {label: "已有账号？返回登录", target: "login"};
    }
    return null;
  }

  const EMPTY_BOARD_GUIDANCE = Object.freeze({
    case_submission: Object.freeze({
      title: "提交第一份结构化案例",
      description: "把图表判断写成可核验的首选、备选与失效条件。",
      points: Object.freeze([
        "说明分析标的、周期和当前浪级",
        "同时保留首选计数与备选计数",
        "列出支持规则、指南和失效条件"
      ])
    }),
    idea_sharing: Object.freeze({
      title: "分享第一篇判断思路",
      description: "把你的理解、依据和可能的例外写清楚，方便共同讨论。",
      points: Object.freeze([
        "先说明核心观点与适用场景",
        "链接或写明依据的规则与指南",
        "保留可能的例外、边界和反例"
      ])
    }),
    public_viewpoint: Object.freeze({
      title: "发布第一篇公开观点",
      description: "写清结论、依据和失效条件，让观点可以被追踪和复盘。",
      points: Object.freeze([
        "说明标的、周期与分析级别",
        "区分成立条件和失效条件",
        "需要时引用 YouTube 视频或 X 帖子"
      ])
    }),
    question_answers: Object.freeze({
      title: "提出第一个可回答的问题",
      description: "把问题收敛到一个浪级、规则或失效条件，方便研究者直接回答。",
      points: Object.freeze([
        "先写品种、周期和当前计数",
        "说明已经核对过的规则与指南",
        "把希望得到的回答写成一个具体问题"
      ])
    }),
    review_answers: Object.freeze({
      title: "提交第一份复盘解答",
      description: "把原始判断与实际走势放在一起，邀请他人核验计数与执行偏差。",
      points: Object.freeze([
        "保留当时的主计数与备选计数",
        "区分规则错误、执行错误和证据不足",
        "列出下一次需要改进的观察点"
      ])
    })
  });

  function emptyBoardGuidance(board) {
    return EMPTY_BOARD_GUIDANCE[board] || null;
  }

  function friendlyError(error) {
    const message = String(error && error.message ? error.message : error || "");
    if (/invalid_credentials|invalid login credentials/i.test(message)) return "邮箱、UID 或密码不正确。";
    if (/account_banned/i.test(message)) return "该账号已被封禁，如需申诉请联系网站管理员。";
    if (/email_confirmation_required|email not confirmed/i.test(message)) return "请先完成邮箱验证。";
    if (/authentication_required/i.test(message)) return "登录状态已失效，请重新登录。";
    if (/invalid_request/i.test(message)) return "请输入有效邮箱或 5—6 位 UID。";
    if (/uid_refresh_exhausted/i.test(message)) return "可刷新次数已经用完，请从现有 UID 中选择。";
    if (/uid_selection_expired/i.test(message)) return "本轮 UID 选择已过期，请重新开始。";
    if (/uid_unavailable/i.test(message)) return "这个 UID 刚被占用，请换一个候选号码。";
    if (/unexpected_failure|error sending recovery email|could not send email/i.test(message)) {
      return "重置邮件暂时无法发送，请稍后重试；如持续失败请联系网站管理员。";
    }
    if (/service_unavailable/i.test(message)) return "账号服务暂时不可用，请稍后重试。";
    if (/user already registered/i.test(message)) return "该邮箱已注册，请直接登录或重置密码。";
    if (/rate limit|too many/i.test(message)) return "操作过于频繁，请稍后再试。";
    if (/network|fetch|timeout/i.test(message)) return "网络连接失败，请检查网络后重试。";
    return message || "操作失败，请重试。";
  }

  function createCommunityUI(options) {
    const contentHost = options.contentHost;
    const breadcrumbHost = options.breadcrumbHost;
    const accountHost = options.accountHost;
    const repository = options.repository;
    const auth = options.auth;
    const configured = Boolean(options.configured);
    const navigate = options.navigate;
    const doc = contentHost.ownerDocument;
    const view = doc.defaultView || (typeof window !== "undefined" ? window : null);
    const draftKey = "elliott-community-draft";
    let renderSequence = 0;
    let dirty = false;
    let authDialog = null;
    let pendingComposeRoute = null;
    let uidAssignmentInFlight = false;

    function element(tag, className, text) {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    function button(label, className = "btn btn-ghost") {
      const node = element("button", className, label);
      node.type = "button";
      return node;
    }

    function profileNameplateTheme(profile) {
      const supported = new Set([
        "classic",
        "blackgold",
        "platinum",
        "purplegold",
        "rainbow",
        "newyear"
      ]);
      const pretty = isFiveDigitUid(profile && profile.public_uid);
      const requested = String(profile && profile.nameplate_style || "classic");
      const style = supported.has(requested) ? requested : "classic";
      return {
        pretty,
        style: style === "classic" && pretty ? "blackgold" : style,
        premium: style !== "classic" || pretty
      };
    }

    function profileUidNameplate(profile) {
      if (!profile || !profile.public_uid) return null;
      const {pretty, style, premium} = profileNameplateTheme(profile);
      const plate = element(
        "span",
        `member-uid-nameplate is-${style}${pretty ? " is-pretty" : ""}${premium ? " is-premium" : ""}`
      );
      plate.setAttribute("aria-label", premium
        ? `炫彩铭牌 UID ${profile.public_uid}`
        : `UID ${profile.public_uid}`);
      if (premium) plate.appendChild(element("span", "member-liang-icon", "靓"));
      plate.appendChild(element("span", "member-uid-number", String(profile.public_uid)));
      return plate;
    }

    function authorIdentity(profile, dateText) {
      const row = element("div", "community-author-identity");
      let authorAvatar;
      if (profile.avatar_url) {
        authorAvatar = element("img", "community-author-avatar");
        authorAvatar.src = profile.avatar_url;
        authorAvatar.alt = `${profile.display_name || "研究者"}的头像`;
      } else {
        authorAvatar = element(
          "span",
          "community-author-avatar is-fallback",
          String(profile.display_name || "研").slice(0, 1)
        );
      }
      const copy = element("div", "community-author-copy");
      const name = element("div", "community-author-name");
      const theme = profileNameplateTheme(profile);
      name.appendChild(element(
        "strong",
        `member-display-name is-${theme.style}${theme.pretty ? " is-pretty" : ""}`,
        profile.display_name || "匿名用户"
      ));
      if (profile.display_title) {
        name.appendChild(element("span", "member-title-chip", profile.display_title));
      }
      if (profile.public_uid) {
        name.appendChild(profileUidNameplate(profile));
      }
      copy.append(name, element("span", "text-small text-muted", dateText || ""));
      row.append(authorAvatar, copy);
      return row;
    }

    function youtubeEmbedUrl(rawUrl) {
      try {
        const url = new URL(rawUrl);
        let id = "";
        if (url.hostname.replace(/^www\./, "") === "youtu.be") {
          id = url.pathname.split("/").filter(Boolean)[0] || "";
        } else if (url.pathname.startsWith("/shorts/")) {
          id = url.pathname.split("/")[2] || "";
        } else {
          id = url.searchParams.get("v") || "";
        }
        return /^[A-Za-z0-9_-]{6,20}$/.test(id)
          ? `https://www.youtube-nocookie.com/embed/${id}`
          : "";
      } catch (_) {
        return "";
      }
    }

    function externalReferenceCard(post) {
      if (!post.external_url || !post.external_kind) return null;
      const card = element("aside", `community-external-card is-${post.external_kind}`);
      if (post.external_kind === "youtube") {
        const embedUrl = youtubeEmbedUrl(post.external_url);
        if (embedUrl) {
          const frame = element("iframe", "community-video-frame");
          frame.src = embedUrl;
          frame.title = `YouTube：${post.title}`;
          frame.loading = "lazy";
          frame.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
          frame.referrerPolicy = "strict-origin-when-cross-origin";
          frame.allowFullscreen = true;
          card.appendChild(frame);
        }
      }
      const link = element("a", "community-external-link");
      link.href = post.external_url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.append(
        element("span", "community-external-mark", post.external_kind === "x" ? "𝕏" : "▶"),
        element("span", "", post.external_kind === "x" ? "查看引用的 X 帖子" : "在 YouTube 打开视频"),
        element("span", "community-external-arrow", "↗")
      );
      card.appendChild(link);
      return card;
    }

    function linkFor(route, label, className) {
      const link = element("a", className || "kb-knowledge-link", label);
      link.href = core.hashForRoute(route);
      link.addEventListener("click", event => {
        event.preventDefault();
        navigate(link.getAttribute("href"));
      });
      return link;
    }

    function replaceContent(node) {
      contentHost.replaceChildren(node);
    }

    function setBreadcrumb(items) {
      if (!items.length) {
        breadcrumbHost.replaceChildren();
        return;
      }
      const list = element("ol", "kb-breadcrumb-list");
      items.forEach((item, index) => {
        const li = element("li");
        if (index) li.appendChild(doc.createTextNode("› "));
        if (item.route) {
          li.appendChild(linkFor(item.route, item.label));
        } else {
          li.appendChild(doc.createTextNode(item.label));
        }
        list.appendChild(li);
      });
      breadcrumbHost.replaceChildren(list);
    }

    function notice(title, message, action) {
      const panel = element("section", "community-notice");
      panel.append(element("h2", "", title), element("p", "", message));
      if (action) panel.appendChild(action);
      return panel;
    }

    function renderNotConfigured() {
      setBreadcrumb([{label: "社区"}]);
      replaceContent(notice(
        "社区服务尚未配置",
        "知识库可以继续正常浏览；完成 Supabase 项目配置后即可注册、登录和发帖。"
      ));
    }

    function renderLoading(label) {
      replaceContent(notice("正在加载", label || "正在读取内容，请稍候。"));
    }

    function renderFailure(error, retry) {
      const retryButton = button("重新加载", "btn btn-primary");
      retryButton.addEventListener("click", retry);
      replaceContent(notice("加载失败", friendlyError(error), retryButton));
    }

    function renderAccount() {
      accountHost.replaceChildren();
      if (!configured) {
        accountHost.appendChild(element("span", "text-small text-muted", "社区未配置"));
        return;
      }
      const actor = auth.actor();
      if (!actor) {
        const login = button("登录");
        const register = button("注册", "btn btn-primary");
        login.addEventListener("click", () => openAuth("login"));
        register.addEventListener("click", () => openAuth("register"));
        accountHost.append(login, register);
        return;
      }
      accountHost.appendChild(element("span", "community-account-name", actor.displayName));
      if (actor.publicUid) {
        accountHost.appendChild(profileUidNameplate({
          public_uid: actor.publicUid,
          nameplate_style: actor.nameplateStyle || "classic"
        }));
      } else if (auth.needsUidActivation()) {
        const activate = button("正在随机生成 UID…", "btn btn-primary");
        activate.disabled = true;
        accountHost.appendChild(activate);
        if (!uidAssignmentInFlight) {
          uidAssignmentInFlight = true;
          Promise.resolve()
            .then(() => auth.assignRandomUid())
            .then(() => renderAccount())
            .catch(error => {
              uidAssignmentInFlight = false;
              activate.disabled = false;
              activate.textContent = "重试生成 UID";
              activate.title = friendlyError(error);
              activate.addEventListener("click", () => renderAccount(), {once: true});
            });
        }
      }
      const signOut = button("退出登录");
      signOut.addEventListener("click", async () => {
        signOut.disabled = true;
        try {
          await auth.signOut();
        } catch (error) {
          signOut.disabled = false;
          signOut.title = friendlyError(error);
        }
      });
      accountHost.appendChild(signOut);
      consumePendingCompose();
    }

    async function openUidActivation() {
      if (!configured || !auth.needsUidActivation()) return;
      closeAuthDialog({clearPending: false});
      authDialog = element("dialog", "community-auth-dialog community-uid-dialog");
      authDialog.setAttribute("aria-labelledby", "community-uid-title");
      const shell = element("section", "community-uid-activation");
      const header = element("header", "community-auth-header");
      const headerCopy = element("div", "community-auth-header-copy");
      headerCopy.append(
        element("p", "community-auth-eyebrow", "账号激活"),
        element("h2", "", "选择你的 UID"),
        element(
          "p",
          "community-auth-description",
          "UID 是公开账号编号，可与邮箱一样用于登录。确认后不可更改。"
        )
      );
      headerCopy.querySelector("h2").id = "community-uid-title";
      const close = button("×", "community-auth-close");
      close.setAttribute("aria-label", "稍后选择 UID");
      close.addEventListener("click", () => closeAuthDialog({clearPending: false}));
      header.append(headerCopy, close);
      const content = element("div", "community-uid-content");
      content.appendChild(element("p", "text-muted", "正在生成安全候选号码…"));
      shell.append(header, content);
      authDialog.appendChild(shell);
      authDialog.addEventListener("cancel", event => {
        event.preventDefault();
        closeAuthDialog({clearPending: false});
      });
      doc.body.appendChild(authDialog);
      if (typeof authDialog.showModal === "function") authDialog.showModal();
      else authDialog.setAttribute("open", "");

      async function initialState() {
        try {
          return await auth.uidSelectionState();
        } catch (error) {
          if (/uid_selection_invalid|uid_selection_expired/.test(String(error.message || error))) {
            return auth.startUidSelection();
          }
          throw error;
        }
      }

      function paint(state) {
        content.replaceChildren();
        const selectedUid = Number(state.selectedUid || state.candidateUids[0]);
        const grid = element("div", "community-uid-grid");
        (state.candidateUids || []).forEach(value => {
          const uid = Number(value);
          const choice = button(
            String(uid),
            `community-uid-option${uid === selectedUid ? " is-selected" : ""}`
          );
          choice.setAttribute("aria-pressed", String(uid === selectedUid));
          choice.addEventListener("click", async () => {
            grid.querySelectorAll("button").forEach(node => { node.disabled = true; });
            try {
              paint(await auth.selectUid(uid));
            } catch (error) {
              showError(error);
            }
          });
          grid.appendChild(choice);
        });
        const hint = element(
          "p",
          "community-field-hint",
          "可保留之前出现过的候选号码；刷新只会增加新候选。"
        );
        const controls = element("div", "community-uid-actions");
        const refresh = button(
          `刷新 UID · 剩余 ${state.refreshesRemaining}`,
          "btn"
        );
        refresh.disabled = Number(state.refreshesRemaining) <= 0;
        refresh.addEventListener("click", async () => {
          refresh.disabled = true;
          confirm.disabled = true;
          try {
            paint(await auth.refreshUidSelection());
          } catch (error) {
            showError(error);
          }
        });
        const confirm = button(`确认 UID ${selectedUid}`, "btn btn-primary");
        confirm.addEventListener("click", async () => {
          refresh.disabled = true;
          confirm.disabled = true;
          confirm.textContent = "正在激活…";
          try {
            await auth.completeUidSelection();
            closeAuthDialog({clearPending: false});
            renderAccount();
            consumePendingCompose();
          } catch (error) {
            showError(error);
          }
        });
        controls.append(refresh, confirm);
        content.append(grid, hint, controls);
      }

      function showError(error) {
        content.replaceChildren(notice(
          "UID 激活未完成",
          friendlyError(error),
          button("重新尝试", "btn btn-primary")
        ));
        content.querySelector("button").addEventListener("click", async () => {
          content.replaceChildren(element("p", "text-muted", "正在重新读取…"));
          try {
            paint(await initialState());
          } catch (nextError) {
            showError(nextError);
          }
        });
      }

      try {
        paint(await initialState());
      } catch (error) {
        showError(error);
      }
    }

    function closeAuthDialog(options = {}) {
      if (options.clearPending !== false) pendingComposeRoute = null;
      if (authDialog) {
        if (typeof authDialog.close === "function") authDialog.close();
        authDialog.remove();
        authDialog = null;
      }
    }

    function consumePendingCompose() {
      const route = pendingComposeRoute;
      if (!route || !auth.actor() || !auth.canPost()) return false;
      pendingComposeRoute = null;
      closeAuthDialog({clearPending: false});
      navigate(core.hashForRoute({kind: "compose", board: route.board}));
      return true;
    }

    function openAuth(mode = "login", options = {}) {
      if (!configured) return;
      if (options.pendingComposeRoute) {
        pendingComposeRoute = options.pendingComposeRoute;
      } else if (!authDialog && !options.preservePending) {
        pendingComposeRoute = null;
      }
      closeAuthDialog({clearPending: false});
      const basePresentation = authModePresentation(mode);
      const presentation = mode === "register"
        ? {
            ...basePresentation,
            description: "先获取邮箱验证码，再设置密码并完成账号创建。",
            submitLabel: "验证并完成注册"
          }
        : basePresentation;
      authDialog = element("dialog", "community-auth-dialog");
      authDialog.setAttribute("aria-labelledby", "community-auth-title");
      const form = element("form", "community-form community-auth-form");
      form.method = "dialog";

      const header = element("header", "community-auth-header");
      const headerCopy = element("div", "community-auth-header-copy");
      const eyebrow = element("p", "community-auth-eyebrow", presentation.eyebrow);
      const title = element("h2", "", presentation.title);
      title.id = "community-auth-title";
      const description = element(
        "p",
        "community-auth-description",
        presentation.description
      );
      headerCopy.append(eyebrow, title, description);
      const close = button("×", "community-auth-close");
      close.setAttribute("aria-label", "关闭账号窗口");
      close.title = "关闭";
      close.addEventListener("click", closeAuthDialog);
      header.append(headerCopy, close);
      form.appendChild(header);

      const feedback = element("p", "community-form-message");
      feedback.setAttribute("role", "status");
      feedback.dataset.state = "idle";

      let displayNameInput = null;
      if (mode === "register") {
        const label = element("label", "community-field community-auth-field");
        label.appendChild(element("span", "community-field-label", "昵称"));
        displayNameInput = element("input", "community-auth-input");
        displayNameInput.name = "displayName";
        displayNameInput.autocomplete = "nickname";
        displayNameInput.placeholder = "例如：波浪学习者";
        displayNameInput.required = true;
        label.appendChild(displayNameInput);
        form.appendChild(label);
      }

      let emailInput = null;
      if (mode !== "recovery") {
        const emailLabel = element("label", "community-field community-auth-field");
        emailLabel.appendChild(element(
          "span",
          "community-field-label",
          mode === "login" ? "邮箱或 UID" : "邮箱"
        ));
        emailInput = element("input", "community-auth-input");
        emailInput.type = mode === "login" ? "text" : "email";
        emailInput.name = mode === "login" ? "identifier" : "email";
        emailInput.autocomplete = mode === "login" ? "username" : "email";
        emailInput.inputMode = mode === "login" ? "text" : "email";
        emailInput.placeholder = mode === "login" ? "邮箱或 5—6 位 UID" : "name@example.com";
        emailInput.required = true;
        emailInput.value = String(options.email || "");
        emailLabel.appendChild(emailInput);
        form.appendChild(emailLabel);
      }

      let verificationCodeInput = null;
      if (mode === "register") {
        const verificationLabel = element("label", "community-field community-auth-field");
        verificationLabel.appendChild(element("span", "community-field-label", "邮箱验证码"));
        const verificationWrap = element("div", "community-password-wrap");
        verificationCodeInput = element("input", "community-auth-input");
        verificationCodeInput.name = "verificationCode";
        verificationCodeInput.autocomplete = "one-time-code";
        verificationCodeInput.inputMode = "numeric";
        verificationCodeInput.pattern = "[0-9]{6}";
        verificationCodeInput.maxLength = 6;
        verificationCodeInput.placeholder = "输入 6 位验证码";
        verificationCodeInput.required = true;
        const requestCode = button("获取验证码", "btn");
        requestCode.addEventListener("click", async () => {
          requestCode.disabled = true;
          feedback.dataset.state = "loading";
          feedback.textContent = "正在发送验证码…";
          try {
            await auth.requestRegistrationCode({
              displayName: displayNameInput.value,
              email: emailInput.value
            });
            feedback.dataset.state = "success";
            feedback.textContent = "验证码已发送，请查看邮箱。";
            requestCode.textContent = "重新获取";
          } catch (error) {
            feedback.dataset.state = "error";
            feedback.textContent = friendlyError(error);
          } finally {
            requestCode.disabled = false;
          }
        });
        verificationWrap.append(verificationCodeInput, requestCode);
        verificationLabel.appendChild(verificationWrap);
        form.appendChild(verificationLabel);
      }

      let passwordInput = null;
      let confirmPasswordInput = null;
      if (mode === "login" || mode === "register" || mode === "recovery") {
        const passwordLabel = element("label", "community-field community-auth-field");
        passwordLabel.appendChild(element("span", "community-field-label", "密码"));
        const passwordWrap = element("div", "community-password-wrap");
        passwordInput = element("input", "community-auth-input");
        passwordInput.type = "password";
        passwordInput.name = "password";
        passwordInput.autocomplete = mode === "login" ? "current-password" : "new-password";
        passwordInput.minLength = mode === "login" ? 1 : 10;
        passwordInput.placeholder = mode === "login" ? "输入密码" : "至少 10 位";
        passwordInput.required = true;
        const passwordToggle = button("显示", "community-password-toggle");
        passwordToggle.setAttribute("aria-pressed", "false");
        passwordToggle.addEventListener("click", () => {
          const visible = passwordInput.type === "password";
          passwordInput.type = visible ? "text" : "password";
          passwordToggle.textContent = visible ? "隐藏" : "显示";
          passwordToggle.setAttribute("aria-pressed", String(visible));
          passwordInput.focus();
        });
        passwordWrap.append(passwordInput, passwordToggle);
        passwordLabel.appendChild(passwordWrap);
        if (mode === "register" || mode === "recovery") {
          passwordLabel.appendChild(element(
            "span",
            "community-field-hint",
            "使用至少 10 位、仅自己知道的密码。"
          ));
        }
        form.appendChild(passwordLabel);
        if (mode === "register" || mode === "recovery") {
          const confirmLabel = element("label", "community-field community-auth-field");
          confirmLabel.appendChild(element("span", "community-field-label", "确认密码"));
          confirmPasswordInput = element("input", "community-auth-input");
          confirmPasswordInput.type = "password";
          confirmPasswordInput.name = "confirmPassword";
          confirmPasswordInput.autocomplete = "new-password";
          confirmPasswordInput.minLength = 10;
          confirmPasswordInput.placeholder = "再次输入密码";
          confirmPasswordInput.required = true;
          confirmLabel.appendChild(confirmPasswordInput);
          form.appendChild(confirmLabel);
        }
      }

      form.appendChild(feedback);
      const actions = element("div", "community-form-actions");
      const submit = element(
        "button",
        "btn btn-primary community-auth-primary",
        presentation.submitLabel
      );
      submit.type = "submit";
      actions.appendChild(submit);
      form.appendChild(actions);

      const secondary = element("div", "community-auth-secondary");
      const modeSwitch = authModeSwitch(mode);
      if (modeSwitch) {
        const switchMode = button(modeSwitch.label, "community-auth-link");
        switchMode.addEventListener("click", () => openAuth(modeSwitch.target, {
          email: emailInput ? emailInput.value : "",
          preservePending: true
        }));
        secondary.appendChild(switchMode);
      }
      if (mode === "login") {
        const reset = button("忘记密码？", "community-auth-link");
        reset.addEventListener("click", () => openAuth("reset", {
          email: emailInput ? emailInput.value : "",
          preservePending: true
        }));
        secondary.append(reset);
      } else if (mode === "reset" || mode === "resend") {
        const backToLogin = button("返回登录", "community-auth-link");
        backToLogin.addEventListener("click", () => openAuth("login", {
          email: emailInput.value,
          preservePending: true
        }));
        secondary.appendChild(backToLogin);
      }
      if (secondary.childNodes.length) form.appendChild(secondary);

      form.addEventListener("submit", async event => {
        event.preventDefault();
        submit.disabled = true;
        feedback.dataset.state = "loading";
        feedback.textContent = "正在处理…";
        try {
          const email = emailInput ? emailInput.value : "";
          if (mode === "register") {
            await auth.completeRegistration({
              displayName: displayNameInput.value,
              email,
              verificationCode: verificationCodeInput.value,
              password: passwordInput.value,
              confirmPassword: confirmPasswordInput.value
            });
            feedback.dataset.state = "success";
            feedback.textContent = "注册完成，系统已随机生成你的 UID。";
            submit.remove();
            if (view) {
              view.setTimeout(() => closeAuthDialog({clearPending: false}), 600);
            }
            return;
          }
          if (mode === "reset") {
            await auth.resetPassword(email);
            feedback.dataset.state = "success";
            feedback.textContent = "密码重置邮件已发送。";
            submit.remove();
            return;
          }
          if (mode === "recovery") {
            await auth.updatePassword({
              password: passwordInput.value,
              confirmPassword: confirmPasswordInput.value
            });
            feedback.dataset.state = "success";
            feedback.textContent = "新密码已保存，你现在已经登录。";
            submit.remove();
            return;
          }
          if (mode === "resend") {
            await auth.resendVerification(email);
            feedback.dataset.state = "success";
            feedback.textContent = "验证邮件已重新发送。";
            submit.remove();
            return;
          }
          await auth.login({identifier: email, password: passwordInput.value});
          if (!consumePendingCompose()) {
            closeAuthDialog({clearPending: false});
          }
        } catch (error) {
          feedback.dataset.state = "error";
          feedback.textContent = friendlyError(error);
          submit.disabled = false;
        }
      });

      authDialog.appendChild(form);
      authDialog.addEventListener("cancel", event => {
        event.preventDefault();
        closeAuthDialog();
      });
      doc.body.appendChild(authDialog);
      if (typeof authDialog.showModal === "function") authDialog.showModal();
      else authDialog.setAttribute("open", "");
      (displayNameInput || emailInput || passwordInput).focus();
    }

    function requirePostingActor(route) {
      const actor = auth.actor();
      if (!actor) {
        openAuth("login", {pendingComposeRoute: route});
        navigate(core.hashForRoute({kind: "board", board: route.board}));
        return null;
      }
      if (!auth.canPost()) {
        if (auth.needsUidActivation()) renderAccount();
        else openAuth("resend");
        return null;
      }
      return actor;
    }

    function startCompose(route) {
      if (requirePostingActor(route)) {
        navigate(core.hashForRoute({kind: "compose", board: route.board}));
      }
    }

    function emptyBoardState(route) {
      const guidance = emptyBoardGuidance(route.board);
      const actionLabel = route.board === "case_submission"
        ? (auth.actor() ? "提交首个案例" : "登录并提交首个案例")
        : route.board === "question_answers"
          ? (auth.actor() ? "提出第一个问题" : "登录并提出问题")
          : route.board === "review_answers"
            ? (auth.actor() ? "提交第一份复盘解答" : "登录并提交复盘解答")
            : (auth.actor() ? "发布第一篇思路" : "登录并发布第一篇思路");
      const panel = element("section", "community-empty-state");
      panel.append(
        element("p", "community-empty-eyebrow", "从第一篇开始"),
        element("h2", "", guidance.title),
        element("p", "text-muted", guidance.description)
      );
      const points = element("ul", "community-empty-points");
      guidance.points.forEach(point => points.appendChild(element("li", "", point)));
      const action = button(actionLabel, "btn btn-primary community-empty-action");
      action.addEventListener("click", () => startCompose(route));
      panel.append(points, action);
      return panel;
    }

    function postCard(post) {
      const model = postCardModel(post);
      const profile = profileOf(post);
      const article = element("article", "community-post-card");
      const title = element("h3");
      title.appendChild(linkFor({kind: "post", postId: model.id}, model.title));
      const identity = authorIdentity(
        profile,
        `${formatDate(model.createdAt)}${model.imageCount ? ` · ${model.imageCount} 张图` : ""}`
      );
      article.append(identity, title, element("p", "community-post-excerpt", model.excerpt));
      return article;
    }

    async function renderBoard(route, token) {
      const board = core.BOARDS[route.board];
      setBreadcrumb([]);
      const section = element("section", "community-board");
      const headingRow = element("div", "community-heading-row");
      const heading = element("div");
      heading.append(element("h1", "", board.title), element("p", "text-muted", board.description));
      const publishLabel = route.board === "case_submission"
        ? "提交案例"
        : route.board === "question_answers"
          ? "提出问题"
          : route.board === "review_answers"
            ? "提交复盘解答"
            : "发布思路";
      const publish = button(publishLabel, "btn btn-primary");
      publish.addEventListener("click", () => startCompose(route));
      headingRow.append(heading, publish);
      const list = element("div", "community-post-list");
      list.appendChild(element("p", "text-muted", "正在读取帖子…"));
      section.append(headingRow, list);
      replaceContent(section);

      const posts = await repository.listPosts(route.board, 0, 20);
      if (token !== renderSequence) return;
      list.replaceChildren();
      if (!posts.length) {
        list.appendChild(emptyBoardState(route));
        return;
      }
      posts.forEach(post => list.appendChild(postCard(post)));
      if (posts.length === 20) {
        let page = 1;
        const more = button("加载更多");
        more.addEventListener("click", async () => {
          more.disabled = true;
          try {
            const next = await repository.listPosts(route.board, page, 20);
            next.forEach(post => list.insertBefore(postCard(post), more));
            page += 1;
            if (next.length < 20) more.remove();
            else more.disabled = false;
          } catch (error) {
            more.textContent = friendlyError(error);
            more.disabled = false;
          }
        });
        list.appendChild(more);
      }
    }

    function orderedImages(post) {
      return [...(post.post_images || [])].sort((a, b) => a.sort_order - b.sort_order);
    }

    async function renderPost(route, token) {
      renderLoading("正在读取帖子详情。" );
      const post = await repository.getPost(route.postId);
      if (token !== renderSequence) return;
      const board = core.BOARDS[post.board];
      setBreadcrumb([
        {label: board.title, route: {kind: "board", board: post.board}},
        {label: post.title}
      ]);
      const article = element("article", "community-post-detail");
      const profile = profileOf(post);
      article.append(
        element("h2", "", post.title),
        authorIdentity(
          profile,
          `${formatDate(post.created_at)}${post.updated_at !== post.created_at ? ` · 更新于 ${formatDate(post.updated_at)}` : ""}`
        ),
        element("p", "community-post-body", post.body)
      );
      const externalCard = externalReferenceCard(post);
      if (externalCard) article.appendChild(externalCard);
      const images = orderedImages(post);
      if (images.length) {
        const grid = element("div", "community-image-grid");
        images.forEach((image, index) => {
          const link = element("a", "community-image-link");
          link.href = repository.imageUrl(image.storage_path);
          link.target = "_blank";
          link.rel = "noopener";
          const img = element("img");
          img.src = link.href;
          img.alt = `${post.title}，图片 ${index + 1}`;
          img.loading = "lazy";
          link.appendChild(img);
          grid.appendChild(link);
        });
        article.appendChild(grid);
      }

      const actor = auth.actor();
      const isOwner = actor && actor.id === post.author_id;
      const isAdmin = actor && actor.role === "admin";
      if (isOwner || isAdmin) {
        const actions = element("div", "community-post-actions");
        if (isOwner && post.status !== "hidden") {
          const edit = button("编辑");
          edit.addEventListener("click", () => navigate(core.hashForRoute({
            kind: "compose",
            board: post.board,
            postId: post.id
          })));
          actions.appendChild(edit);
        }
        if (isAdmin && !isOwner && post.status !== "hidden") {
          const hide = button("隐藏帖子");
          hide.addEventListener("click", async () => {
            hide.disabled = true;
            try {
              await repository.hidePost(post.id);
              navigate(core.hashForRoute({kind: "board", board: post.board}));
            } catch (error) {
              hide.textContent = friendlyError(error);
              hide.disabled = false;
            }
          });
          actions.appendChild(hide);
        }
        const remove = button("删除帖子", "btn community-danger-button");
        remove.addEventListener("click", async () => {
          if (view && !view.confirm("确定删除这篇帖子吗？此操作无法撤销。")) return;
          remove.disabled = true;
          try {
            await repository.deletePost(post);
            navigate(core.hashForRoute({kind: "board", board: post.board}));
          } catch (error) {
            remove.textContent = friendlyError(error);
            remove.disabled = false;
          }
        });
        actions.appendChild(remove);
        article.appendChild(actions);
      }
      replaceContent(article);
    }

    function readDraft() {
      if (!view || !view.sessionStorage) return null;
      try {
        return JSON.parse(view.sessionStorage.getItem(draftKey) || "null");
      } catch (_) {
        return null;
      }
    }

    function writeDraft(value) {
      if (!view || !view.sessionStorage) return;
      view.sessionStorage.setItem(draftKey, JSON.stringify(value));
    }

    function clearDraft() {
      if (view && view.sessionStorage) view.sessionStorage.removeItem(draftKey);
      dirty = false;
    }

    function field(labelText, control) {
      const label = element("label", "community-field", labelText);
      label.appendChild(control);
      return label;
    }

    function createPublicTVPanel(initialValue, instrumentInput, timeframeInput, marketInput) {
      const panel = element("section", "community-tv-editor research-editor-section");
      const chartUrl = element("input");
      chartUrl.autocomplete = "off";
      chartUrl.placeholder = "TradingView 分享链接或 BINANCE:BTCUSDT";
      const symbol = element("input");
      symbol.placeholder = "例如 BINANCE:BTCUSDT";
      const interval = element("input");
      interval.placeholder = "例如 4小时、D、60";
      const theme = optionSelect([
        {value: "auto", label: "跟随网站与分享图表"},
        {value: "dark", label: "深色图表"},
        {value: "light", label: "浅色图表"}
      ], tv && tv.normalizeTheme(initialValue && initialValue.theme));
      const status = element("p", "text-small text-muted");
      const preview = element("div", "community-tv-widget is-editor-preview");
      let chartPackage = initialValue && initialValue.provider === "tradingview"
        ? {...initialValue}
        : null;
      let timer = 0;

      function setInputs(value) {
        if (!value) return;
        chartUrl.value = value.chart_url || "";
        symbol.value = value.symbol || "";
        interval.value = value.interval || "";
        theme.value = tv.normalizeTheme(value.theme);
      }

      function rebuild(renderPreview) {
        try {
          const parsed = tv.parseChartUrl(chartUrl.value);
          if (parsed.symbol) symbol.value = parsed.symbol;
          if (parsed.interval) interval.value = tv.intervalLabel(parsed.interval);
          chartPackage = tv.buildPackage({
            chartUrl: chartUrl.value,
            symbol: symbol.value,
            interval: interval.value,
            theme: theme.value,
            layout: chartPackage && chartPackage.layout
          });
          if (chartPackage) {
            setInputs(chartPackage);
            if (chartPackage.symbol) instrumentInput.value = chartPackage.symbol;
            const label = tv.intervalLabel(chartPackage.interval);
            if (Array.from(timeframeInput.options || []).some(option => option.value === label)) {
              timeframeInput.value = label;
            }
            const group = tv.marketGroupForSymbol(chartPackage.symbol);
            if (group) {
              marketInput.value = group;
              marketInput.dispatchEvent(new view.Event("change", {bubbles: true}));
            }
            status.textContent = `已识别 ${chartPackage.symbol || "图表"} · ${label}。`;
            if (renderPreview && chartPackage.symbol) tv.mountWidget(preview, chartPackage);
          } else {
            status.textContent = "可不附图表；粘贴公开分享链接后会自动识别品种与周期。";
            preview.replaceChildren();
          }
        } catch (error) {
          status.textContent = String(error && error.message || error);
          if (renderPreview) preview.replaceChildren();
        }
        return chartPackage;
      }

      function schedule() {
        if (timer && view) view.clearTimeout(timer);
        timer = view.setTimeout(() => rebuild(true), 520);
      }
      [chartUrl, symbol, interval].forEach(input => input.addEventListener("input", schedule));
      theme.addEventListener("change", () => rebuild(true));
      const actions = element("div", "member-tv-actions");
      const previewButton = button("识别并预览", "btn btn-secondary");
      previewButton.addEventListener("click", () => rebuild(true));
      actions.appendChild(previewButton);

      const connection = element("details", "member-tv-account");
      const tvIdentity = element("input");
      const saved = tv.readConnection(view);
      tvIdentity.value = saved && (saved.username || saved.profile_url) || "";
      tvIdentity.placeholder = "TradingView 用户名或公开资料链接";
      const connectionStatus = element("p", "text-small text-muted", saved
        ? "已在本设备连接 TradingView 公开资料。"
        : "本站不会读取或保存 TradingView 密码；私人布局需公开分享或导出。"
      );
      const connect = button("保存连接", "btn btn-ghost");
      connect.addEventListener("click", () => {
        try {
          tv.saveConnection(view, {username: tvIdentity.value, profileUrl: tvIdentity.value, theme: theme.value});
          connectionStatus.textContent = "连接已保存。登录仍在 TradingView 官方网站完成。";
        } catch (error) {
          connectionStatus.textContent = String(error && error.message || error);
        }
      });
      const officialLogin = element("a", "btn btn-ghost", "打开官方登录");
      officialLogin.href = "https://www.tradingview.com/accounts/signin/";
      officialLogin.target = "_blank";
      officialLogin.rel = "noopener noreferrer";
      const connectionActions = element("div", "member-tv-actions");
      connectionActions.append(officialLogin, connect);
      connection.append(
        element("summary", "", "连接 TradingView 账号资料"),
        field("用户名或公开资料链接", tvIdentity),
        connectionActions,
        connectionStatus
      );

      setInputs(chartPackage);
      panel.append(
        element("h3", "", "TradingView 图表"),
        element("p", "text-small text-muted", "公开观点、案例与思路使用同一套图表识别；第三方图表只在你点击预览或读者点击加载时请求。"),
        field("图表链接或品种代码", chartUrl),
        element("div", "research-context-grid")
      );
      panel.lastChild.append(field("品种代码", symbol), field("图表周期", interval), field("显示主题", theme));
      panel.append(actions, connection, status, preview);
      if (chartPackage) view.setTimeout(() => rebuild(true), 0);
      return {node: panel, value: () => rebuild(false)};
    }

    function optionSelect(values, selected = "") {
      const select = element("select");
      values.forEach(item => {
        const value = typeof item === "object" ? item.value : item;
        const label = typeof item === "object" ? item.label : item;
        const option = element("option", "", label);
        option.value = value;
        option.selected = value === selected;
        select.appendChild(option);
      });
      return select;
    }

    function composerTextarea(label, rows = 4, placeholder = "") {
      const input = element("textarea");
      input.rows = rows;
      input.maxLength = 12000;
      input.placeholder = placeholder;
      return {input, node: field(label, input)};
    }

    async function renderComposer(route, token) {
      const actor = requirePostingActor(route);
      if (!actor) return;
      let post = null;
      if (route.postId) {
        renderLoading("正在读取需要编辑的帖子。" );
        post = await repository.getPost(route.postId);
        if (token !== renderSequence) return;
        if (post.author_id !== actor.id || post.status === "hidden") {
          throw new Error("你不能编辑这篇帖子。");
        }
      }

      const board = core.BOARDS[route.board];
      setBreadcrumb([
        {label: board.title, route: {kind: "board", board: route.board}},
        {label: post ? "编辑帖子" : "发布内容"}
      ]);
      const form = element("form", "community-form community-composer research-composer");
      const composerHeading = element("header", "research-composer-heading");
      composerHeading.append(
        element(
          "p",
          "member-eyebrow",
          route.board === "case_submission"
            ? "结构化案例"
            : route.board === "question_answers"
              ? "问题解答"
              : route.board === "review_answers"
                ? "复盘解答"
                : "研究观点"
        ),
        element("h2", "", post ? "编辑研究内容" : `发布到「${board.title}」`),
        element("p", "text-muted", "固定分析对象和浪型，再把依据、边界与失效条件写清楚。")
      );
      form.appendChild(composerHeading);
      const draft = post ? null : readDraft();
      const sameBoardDraft = draft && draft.board === route.board ? draft : null;
      let editorMode = post
        ? (post.chart_package ? "professional" : "simple")
        : (sameBoardDraft && sameBoardDraft.mode === "professional" ? "professional" : "simple");
      const modeSwitch = element("div", "composer-mode-switch");
      modeSwitch.setAttribute("role", "tablist");
      modeSwitch.setAttribute("aria-label", "发布模式");
      const simpleModeButton = button("简易发布", "composer-mode-button");
      const professionalModeButton = button("专业分析", "composer-mode-button");
      simpleModeButton.setAttribute("role", "tab");
      professionalModeButton.setAttribute("role", "tab");
      modeSwitch.append(simpleModeButton, professionalModeButton);
      form.appendChild(modeSwitch);
      const title = element("input");
      title.name = "title";
      title.maxLength = 120;
      title.required = true;
      title.value = post ? post.title : (sameBoardDraft ? sameBoardDraft.title : "");
      const body = element("textarea");
      body.name = "body";
      body.maxLength = 20000;
      body.rows = 12;
      body.required = false;
      body.value = post
        ? post.body
        : (sameBoardDraft ? sameBoardDraft.body : "");
      const externalUrl = element("input");
      externalUrl.type = "url";
      externalUrl.inputMode = "url";
      externalUrl.placeholder = "https://www.youtube.com/watch?v=… 或 https://x.com/…/status/…";
      externalUrl.value = post
        ? (post.external_url || "")
        : (sameBoardDraft ? (sameBoardDraft.externalUrl || "") : "");
      const structuredDraft = sameBoardDraft && sameBoardDraft.structured || {};
      const market = optionSelect(catalog.MARKET_GROUPS, structuredDraft.market || "crypto");
      const instrument = element("input");
      instrument.value = structuredDraft.instrument || "";
      instrument.placeholder = "搜索或输入品种，例如 BTC、黄金、标普500";
      const datalist = element("datalist");
      datalist.id = `composer-instruments-${Math.random().toString(36).slice(2)}`;
      instrument.setAttribute("list", datalist.id);
      const timeframe = optionSelect(catalog.TIMEFRAMES, structuredDraft.timeframe || "4小时");
      const pattern = optionSelect(catalog.WAVE_PATTERNS, structuredDraft.pattern || "unknown");
      const position = optionSelect(catalog.WAVE_POSITIONS, structuredDraft.position || "unknown");
      const direction = optionSelect(catalog.DIRECTIONS, structuredDraft.direction || "unknown");
      function refreshInstruments() {
        datalist.replaceChildren(...catalog.instrumentsFor(market.value).map(name => {
          const option = element("option");
          option.value = name;
          return option;
        }));
      }
      market.addEventListener("change", refreshInstruments);
      refreshInstruments();
      const imagePicker = imageAttachments.createPicker({
        document: doc,
        window: view,
        maxImages: core.MAX_IMAGES,
        initialItems: post ? orderedImages(post).map((image, index) => ({
          id: image.id,
          url: repository.imageUrl(image.storage_path),
          name: `现有图片 ${index + 1}`
        })) : [],
        onChange: () => captureDraft()
      });
      imagePicker.bindPasteTarget(form);

      const thesis = composerTextarea(
        route.board === "case_submission"
          ? "分析背景与核心判断"
          : route.board === "question_answers"
            ? "问题与当前判断"
            : route.board === "review_answers"
              ? "复盘对象与原始判断"
              : "核心观点",
        4,
        route.board === "question_answers"
          ? "先把一个具体问题写清楚，再补充你当前的计数"
          : route.board === "review_answers"
            ? "说明当时怎么数、为什么这样数"
            : "先写结论，再说明它适用的浪级与场景"
      );
      const evidence = composerTextarea("规则与指南依据", 4, "引用硬规则、指南、比例、通道或结构证据");
      const invalidation = composerTextarea(
        route.board === "case_submission"
          ? "失效条件"
          : route.board === "review_answers"
            ? "最终走势与偏差"
            : "适用边界与反例",
        3,
        route.board === "review_answers"
          ? "写清实际走势与原始判断的差异"
          : "什么发生后必须放弃或降低该判断"
      );
      const question = composerTextarea(
        route.board === "question_answers" || route.board === "review_answers"
          ? "希望得到的回答"
          : "希望讨论的问题",
        3,
        "把需要其他研究者核验的关键问题写成一句话"
      );
      const primaryCount = composerTextarea("首选计数", 4, "当前主计数及其成立路径");
      const alternateCount = composerTextarea("备选计数", 4, "至少保留一个可切换的备选结构");
      const confirmation = composerTextarea("成立与确认条件", 3, "结构或价格达到什么条件后提高置信度");
      const application = composerTextarea("实际应用", 3, "这套判断如何用于观察、学习或复盘");
      const structuredFields = {
        thesis, evidence, invalidation, question,
        primaryCount, alternateCount, confirmation, application
      };
      Object.entries(structuredFields).forEach(([key, item]) => {
        item.input.value = structuredDraft[key] || "";
      });

      const contextSection = element("section", "research-editor-section");
      const contextGrid = element("div", "research-context-grid");
      contextGrid.append(
        field("市场分类", market),
        field("品种（可搜索）", instrument),
        datalist,
        field("周期", timeframe),
        field("浪型", pattern),
        field("当前子浪", position),
        field("方向", direction)
      );
      contextSection.append(
        element("h3", "", "分析坐标"),
        element("p", "text-small text-muted", "先锁定市场、品种和周期，发布后读者能更快理解你的计数上下文。"),
        contextGrid
      );
      const analysisSection = element("section", "research-editor-section");
      analysisSection.append(thesis.node, evidence.node);
      if (route.board === "case_submission") {
        analysisSection.append(
          primaryCount.node,
          alternateCount.node,
          confirmation.node,
          invalidation.node,
          question.node
        );
      } else {
        analysisSection.append(invalidation.node, application.node, question.node);
      }
      const preview = element("section", "research-live-preview");
      preview.append(
        element("p", "member-eyebrow", "发布预览"),
        element("h3", "", "结构化正文"),
        element("div", "research-preview-body")
      );
      const bodyField = field("正文", body);
      form.append(
        field("标题（5—120个字符）", title),
        contextSection,
        analysisSection,
        bodyField,
        imagePicker.node,
        field("外部引用（可选：YouTube 或 X）", externalUrl),
        preview
      );
      const feedback = element("p", "community-form-message");
      feedback.setAttribute("role", "status");
      const actions = element("div", "community-form-actions");
      const cancel = button("取消");
      const submit = element("button", "btn btn-primary", post ? "保存修改" : "发布内容");
      submit.type = "submit";
      cancel.addEventListener("click", () => {
        if (!dirty || !view || view.confirm("放弃尚未发布的内容吗？")) {
          clearDraft();
          navigate(core.hashForRoute({kind: "board", board: route.board}));
        }
      });
      actions.append(cancel, submit);
      form.append(feedback, actions);

      function structuredValue() {
        return {
          market: market.value,
          instrument: instrument.value.trim(),
          timeframe: timeframe.value,
          pattern: pattern.value,
          position: position.value,
          direction: direction.value,
          thesis: thesis.input.value,
          evidence: evidence.input.value,
          invalidation: invalidation.input.value,
          question: question.input.value,
          primaryCount: primaryCount.input.value,
          alternateCount: alternateCount.input.value,
          confirmation: confirmation.input.value,
          application: application.input.value,
          notes: body.value
        };
      }

      function compiledBody() {
        return editorMode === "simple"
          ? body.value.trim()
          : catalog.compileStructuredPost(structuredValue(), route.board);
      }

      function syncComposerMode() {
        const isSimple = editorMode === "simple";
        simpleModeButton.classList.toggle("is-active", isSimple);
        professionalModeButton.classList.toggle("is-active", !isSimple);
        simpleModeButton.setAttribute("aria-selected", String(isSimple));
        professionalModeButton.setAttribute("aria-selected", String(!isSimple));
        contextSection.hidden = isSimple;
        analysisSection.hidden = isSimple;
        preview.hidden = isSimple;
        body.rows = isSimple ? 14 : 7;
        if (bodyField.firstChild && bodyField.firstChild.nodeType === 3) {
          bodyField.firstChild.nodeValue = isSimple ? "正文或问题说明" : "补充说明";
        }
        composerHeading.querySelector(".text-muted").textContent = isSimple
          ? "直接写下问题或观点，再选择、拖入或粘贴多张图片。"
          : "固定分析对象和浪型，再把依据、边界与失效条件写清楚。";
      }

      simpleModeButton.addEventListener("click", () => {
        editorMode = "simple";
        syncComposerMode();
        captureDraft();
      });
      professionalModeButton.addEventListener("click", () => {
        editorMode = "professional";
        syncComposerMode();
        captureDraft();
      });

      function updatePreview() {
        preview.querySelector(".research-preview-body").textContent =
          compiledBody() || "填写分析内容后，这里会显示最终发布结构。";
      }

      function captureDraft() {
        dirty = Boolean(
          title.value.trim()
          || compiledBody()
          || externalUrl.value.trim()
          || imagePicker.count()
        );
        if (!post) writeDraft({
          board: route.board,
          mode: editorMode,
          title: title.value,
          body: body.value,
          externalUrl: externalUrl.value,
          structured: structuredValue()
        });
        updatePreview();
      }
      [title, body, externalUrl, market, instrument, timeframe, pattern, position, direction]
        .forEach(input => input.addEventListener("input", captureDraft));
      Object.values(structuredFields).forEach(item => {
        item.input.addEventListener("input", captureDraft);
      });
      syncComposerMode();
      updatePreview();

      form.addEventListener("submit", async event => {
        event.preventDefault();
        const validated = core.validatePost({
          board: route.board,
          title: title.value,
          body: compiledBody(),
          externalUrl: externalUrl.value,
          mode: editorMode,
          imageCount: imagePicker.count()
        });
        const newFiles = imagePicker.files();
        const keptImageIds = imagePicker.keptIds();
        const imageValidation = core.validateImages(newFiles);
        if (!validated.ok) {
          feedback.textContent = Object.values(validated.fields).join(" ");
          return;
        }
        if (!imageValidation.ok) {
          feedback.textContent = imageValidation.error;
          return;
        }
        submit.disabled = true;
        feedback.textContent = "正在上传并保存，请勿重复提交…";
        try {
          if (post) {
            const result = await repository.updatePost(post, {
              userId: actor.id,
              title: validated.value.title,
              body: validated.value.body,
              externalUrl: validated.value.externalUrl,
              externalKind: validated.value.externalKind,
              keptImageIds,
              files: newFiles
            });
            if (result.cleanupPending) {
              feedback.textContent = "帖子已保存，部分旧图片将在稍后清理。";
            }
            clearDraft();
            navigate(core.hashForRoute({kind: "post", postId: post.id}));
            return;
          }
          const postId = await repository.createPost({
            userId: actor.id,
            board: route.board,
            title: validated.value.title,
            body: validated.value.body,
            externalUrl: validated.value.externalUrl,
            externalKind: validated.value.externalKind,
            files: newFiles
          });
          clearDraft();
          navigate(core.hashForRoute({kind: "post", postId}));
        } catch (error) {
          feedback.textContent = friendlyError(error);
          submit.disabled = false;
          captureDraft();
        }
      });

      replaceContent(form);
      title.focus();
    }

    async function render(route) {
      const token = ++renderSequence;
      if (!configured) {
        renderNotConfigured();
        return;
      }
      try {
        if (route.kind === "board") await renderBoard(route, token);
        else if (route.kind === "post") await renderPost(route, token);
        else if (route.kind === "compose") await renderComposer(route, token);
      } catch (error) {
        if (token !== renderSequence) return;
        renderFailure(error, () => render(route));
      }
    }

    function beforeUnload(event) {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    }

    if (view) view.addEventListener("beforeunload", beforeUnload);

    return {
      render,
      renderAccount,
      openAuth,
      dispose() {
        closeAuthDialog();
        if (view) view.removeEventListener("beforeunload", beforeUnload);
      }
    };
  }

  return {
    formatDate,
    postCardModel,
    friendlyError,
    authModePresentation,
    authModeSwitch,
    createCommunityUI
  };
});
