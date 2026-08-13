(function (root, factory) {
  const core = typeof module === "object" && module.exports
    ? require("./member-core.js")
    : root.ElliottMemberCore;
  const avatar = typeof module === "object" && module.exports
    ? require("./avatar-editor.js")
    : root.ElliottAvatarEditor;
  const tv = typeof module === "object" && module.exports
    ? require("./tv-review.js")
    : root.ElliottTVReview;
  const catalog = typeof module === "object" && module.exports
    ? require("./research-catalog.js")
    : root.ElliottResearchCatalog;
  const imageAttachments = typeof module === "object" && module.exports
    ? require("./image-attachments.js")
    : root.WaveKBImageAttachments;
  const api = factory(core, avatar, tv, catalog, imageAttachments);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.ElliottMemberUI = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (core, avatar, tv, catalog, imageAttachments) {
  "use strict";

  function privateHomeCopy() {
    return {
      privacy: "复盘、日记与草稿已统一收进交易工作台，默认仅自己可见。",
      primaryAction: "交易工作台",
      publishAction: "整理后公开发布"
    };
  }

  function entryKindLabels() {
    return {review: "复盘", journal: "日记", draft: "草稿"};
  }

  function publicBoardLabels() {
    return {
      public_viewpoint: "公开观点",
      idea_sharing: "思路分享",
      case_submission: "案例提交",
      question_answers: "问题解答",
      review_answers: "复盘解答"
    };
  }

  const customStickerMimeTypes = new Set([
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp"
  ]);

  function resolvedCustomStickerMime(file) {
    const declared = String(file && file.type || "").toLowerCase();
    if (customStickerMimeTypes.has(declared)) return declared;
    const extension = String(file && file.name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
    return ({png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp"})[
      extension && extension[1]
    ] || "";
  }

  function validateCustomStickerFile(file) {
    if (!file || !resolvedCustomStickerMime(file)) {
      return {ok: false, error: "请选择 PNG、JPEG、GIF 或 WebP 图片。"};
    }
    if (!Number.isFinite(file.size) || file.size < 1 || file.size > 12 * 1024 * 1024) {
      return {ok: false, error: "表情图片不能超过 12 MB。"};
    }
    return {ok: true};
  }

  function customStickerToken(sticker) {
    const path = String(sticker && sticker.storage_path || "").trim();
    const label = String(sticker && sticker.label || "自定义表情").trim().slice(0, 40);
    return `[[custom-sticker:${encodeURIComponent(path)}|${encodeURIComponent(label)}]]`;
  }

  function customStickerFromBody(body) {
    const match = /^\[\[custom-sticker:([^|\]]+)\|([^\]]*)\]\]$/.exec(String(body || "").trim());
    if (!match) return null;
    try {
      const storagePath = decodeURIComponent(match[1]);
      const label = decodeURIComponent(match[2]) || "自定义表情";
      if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:png|jpg|gif|webp)$/i.test(storagePath)) {
        return null;
      }
      return {storage_path: storagePath, label: label.slice(0, 40)};
    } catch (_) {
      return null;
    }
  }

  function createMemberUI(options) {
    const contentHost = options.contentHost;
    const breadcrumbHost = options.breadcrumbHost;
    const repository = options.repository;
    const auth = options.auth;
    const configured = Boolean(options.configured);
    const navigate = options.navigate;
    const doc = contentHost.ownerDocument;
    const win = doc.defaultView;
    let renderSequence = 0;
    let activeSocialCleanup = () => {};
    let socialAudioContext = null;
    let messengerReturnHash = "#space=home";
    let messengerHasBackground = false;
    let messengerDesktopLayer = null;
    let messengerTaskbar = null;
    let messengerFriendTaskButton = null;
    let messengerZIndex = 12000;
    let floatingMessengerSequence = 0;
    let floatingMessengerCleanup = () => {};
    let messengerFriendWindow = null;
    const messengerChatWindows = new Map();
    // v4 drops the compact prototype geometry and stores the desktop-window layout.
    const messengerWindowStorageKey = "wavekb:messenger-window-state:v4";
    const socialSoundStorageKey = "wavekb:social-sound";
    const stickerCatalog = [
      {id: "wave", glyph: "🌊", label: "波浪"},
      {id: "chart-up", glyph: "📈", label: "上涨"},
      {id: "chart-down", glyph: "📉", label: "下跌"},
      {id: "target", glyph: "🎯", label: "目标"},
      {id: "fire", glyph: "🔥", label: "精彩"},
      {id: "thinking", glyph: "🤔", label: "思考"},
      {id: "agree", glyph: "🤝", label: "赞同"},
      {id: "check", glyph: "✅", label: "确认"},
      {id: "diamond", glyph: "💎", label: "高质量"},
      {id: "laugh", glyph: "😂", label: "开心"}
    ];

    function stickerFromBody(body) {
      const match = /^\[\[sticker:([a-z0-9-]+)\]\]$/.exec(String(body || "").trim());
      return match ? stickerCatalog.find(item => item.id === match[1]) || null : null;
    }

    function socialSoundEnabled() {
      try {
        return !win || win.localStorage.getItem(socialSoundStorageKey) !== "off";
      } catch (_) {
        return true;
      }
    }

    function setSocialSoundEnabled(enabled) {
      try {
        if (win) win.localStorage.setItem(socialSoundStorageKey, enabled ? "on" : "off");
      } catch (_) {}
    }

    function playSocialSound(kind, allowUnlock = false) {
      if (!win || !socialSoundEnabled()) return;
      const AudioContext = win.AudioContext || win.webkitAudioContext;
      if (!AudioContext) return;
      try {
        if (!socialAudioContext) socialAudioContext = new AudioContext();
        if (socialAudioContext.state === "suspended") {
          if (!allowUnlock) return;
          socialAudioContext.resume();
        }
        const patterns = {
          friend: [[620, 0], [820, .085]],
          sent: [[520, 0], [690, .065]],
          received: [[760, 0], [610, .09]]
        };
        const notes = patterns[kind] || patterns.sent;
        const start = socialAudioContext.currentTime + .012;
        notes.forEach(([frequency, offset], index) => {
          const oscillator = socialAudioContext.createOscillator();
          const gain = socialAudioContext.createGain();
          const noteStart = start + offset;
          oscillator.type = "sine";
          oscillator.frequency.setValueAtTime(frequency, noteStart);
          gain.gain.setValueAtTime(.0001, noteStart);
          gain.gain.exponentialRampToValueAtTime(index ? .035 : .028, noteStart + .012);
          gain.gain.exponentialRampToValueAtTime(.0001, noteStart + .115);
          oscillator.connect(gain);
          gain.connect(socialAudioContext.destination);
          oscillator.start(noteStart);
          oscillator.stop(noteStart + .13);
        });
      } catch (_) {}
    }

    function readMessengerWindowStates() {
      try {
        const value = win && win.localStorage.getItem(messengerWindowStorageKey);
        const parsed = value ? JSON.parse(value) : {};
        return parsed && typeof parsed === "object" ? parsed : {};
      } catch (_) {
        return {};
      }
    }

    function saveMessengerWindowState(id, value) {
      try {
        if (!win) return;
        const states = readMessengerWindowStates();
        states[id] = {...states[id], ...value};
        win.localStorage.setItem(messengerWindowStorageKey, JSON.stringify(states));
      } catch (_) {}
    }

    function ensureMessengerDesktop() {
      if (messengerDesktopLayer && messengerDesktopLayer.isConnected) return messengerDesktopLayer;
      const host = contentHost.closest("#elliott-kb-inline") || doc.body;
      messengerDesktopLayer = element("div", "wavekb-messenger-desktop");
      messengerDesktopLayer.setAttribute("aria-live", "polite");
      messengerTaskbar = element("div", "wavekb-messenger-taskbar");
      messengerDesktopLayer.appendChild(messengerTaskbar);
      host.appendChild(messengerDesktopLayer);
      return messengerDesktopLayer;
    }

    function bringMessengerWindowToFront(panel) {
      if (!panel) return;
      messengerZIndex += 1;
      panel.style.zIndex = String(messengerZIndex);
    }

    function clampMessengerPosition(panel, x, y) {
      if (!win) return {x, y};
      const margin = win.innerWidth <= 700 ? 8 : 20;
      const width = Math.min(panel.offsetWidth || 560, win.innerWidth - margin * 2);
      const height = Math.min(panel.offsetHeight || 720, win.innerHeight - margin * 2);
      return {
        x: Math.max(margin, Math.min(x, win.innerWidth - width - margin)),
        y: Math.max(margin, Math.min(y, win.innerHeight - height - margin))
      };
    }

    function installMessengerWindow(panel, options = {}) {
      if (!panel || panel.dataset.windowReady === "true") return () => {};
      panel.dataset.windowReady = "true";
      const id = String(options.id || "messenger");
      const kind = options.kind || "chat";
      const states = readMessengerWindowStates();
      const saved = states[id] || {};
      const viewportWidth = win ? win.innerWidth : 1440;
      const viewportHeight = win ? win.innerHeight : 900;
      const viewportMargin = viewportWidth <= 700 ? 8 : 20;
      const viewportMaxWidth = Math.max(280, viewportWidth - viewportMargin * 2);
      const viewportMaxHeight = Math.max(360, viewportHeight - viewportMargin * 2);
      const defaultWidth = Number(options.width || (kind === "directory" ? 560 : 960));
      const defaultHeight = Number(options.height || (kind === "directory" ? 720 : 780));
      const defaultX = Number(options.x ?? Math.max(viewportMargin, viewportWidth - defaultWidth - 32));
      const defaultY = Number(options.y ?? Math.max(viewportMargin, 56));
      const maxWidth = Math.min(kind === "directory" ? 580 : 1050, viewportMaxWidth);
      const minWidth = Math.min(kind === "directory" ? 540 : 720, maxWidth);
      const maxHeight = Math.min(kind === "directory" ? Math.round(viewportHeight * .88) : 850, viewportMaxHeight);
      const minHeight = Math.min(kind === "directory" ? 520 : 560, maxHeight);
      const restoredWidth = Number(saved.width || defaultWidth);
      const restoredHeight = Number(saved.height || defaultHeight);
      panel.style.width = `${Math.max(minWidth, Math.min(maxWidth, restoredWidth))}px`;
      panel.style.height = `${Math.max(minHeight, Math.min(maxHeight, restoredHeight))}px`;
      const initial = clampMessengerPosition(panel, Number(saved.x ?? defaultX), Number(saved.y ?? defaultY));
      panel.style.left = `${initial.x}px`;
      panel.style.top = `${initial.y}px`;
      panel.dataset.dock = saved.dock || "";
      panel.classList.toggle("is-pinned", saved.pinned !== false);
      panel.classList.toggle("is-minimized", Boolean(saved.minimized));
      panel.classList.toggle("is-maximized", kind === "chat" && Boolean(saved.maximized));
      bringMessengerWindowToFront(panel);

      const titlebar = panel.querySelector(".member-messenger-windowbar, .wavekb-chat-windowbar");
      let dragging = null;
      let hideTimer = 0;
      function persist(extra = {}) {
        const rect = panel.getBoundingClientRect();
        saveMessengerWindowState(id, {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          dock: panel.dataset.dock || "",
          pinned: panel.classList.contains("is-pinned"),
          minimized: panel.classList.contains("is-minimized"),
          maximized: panel.classList.contains("is-maximized"),
          ...extra
        });
      }
      function setDock(dock) {
        panel.dataset.dock = dock || "";
        panel.classList.toggle("is-docked", Boolean(dock));
        panel.classList.remove("is-auto-hidden");
        persist({dock: dock || ""});
      }
      function scheduleAutoHide() {
        if (hideTimer && win) win.clearTimeout(hideTimer);
        if (!win || panel.classList.contains("is-pinned") || !panel.dataset.dock || panel.classList.contains("is-minimized")) return;
        hideTimer = win.setTimeout(() => panel.classList.add("is-auto-hidden"), 520);
      }
      function reveal() {
        if (hideTimer && win) win.clearTimeout(hideTimer);
        panel.classList.remove("is-auto-hidden");
      }
      function endDrag(event) {
        if (!dragging) return;
        const dx = event.clientX - dragging.clientX;
        const dy = event.clientY - dragging.clientY;
        const next = clampMessengerPosition(panel, dragging.left + dx, dragging.top + dy);
        panel.style.left = `${next.x}px`;
        panel.style.top = `${next.y}px`;
        panel.classList.remove("is-dragging");
        dragging = null;
        const rect = panel.getBoundingClientRect();
        const threshold = 24;
        let dock = "";
        if (rect.left <= threshold) dock = "left";
        else if (win && win.innerWidth - rect.right <= threshold) dock = "right";
        else if (rect.top <= threshold) dock = "top";
        else if (win && win.innerHeight - rect.bottom <= threshold) dock = "bottom";
        setDock(dock);
        scheduleAutoHide();
        if (titlebar && titlebar.releasePointerCapture && titlebar.hasPointerCapture(event.pointerId)) {
          titlebar.releasePointerCapture(event.pointerId);
        }
      }
      function moveDrag(event) {
        if (!dragging) return;
        const next = clampMessengerPosition(
          panel,
          dragging.left + event.clientX - dragging.clientX,
          dragging.top + event.clientY - dragging.clientY
        );
        panel.style.left = `${next.x}px`;
        panel.style.top = `${next.y}px`;
      }
      if (titlebar) {
        titlebar.addEventListener("pointerdown", event => {
          if (event.button !== 0 || event.target.closest("button, a, input")) return;
          const rect = panel.getBoundingClientRect();
          dragging = {clientX: event.clientX, clientY: event.clientY, left: rect.left, top: rect.top};
          panel.classList.add("is-dragging");
          panel.classList.remove("is-auto-hidden");
          setDock("");
          bringMessengerWindowToFront(panel);
          if (titlebar.setPointerCapture) titlebar.setPointerCapture(event.pointerId);
        });
        titlebar.addEventListener("pointermove", moveDrag);
        titlebar.addEventListener("pointerup", endDrag);
        titlebar.addEventListener("pointercancel", endDrag);
      }
      panel.addEventListener("pointerdown", () => bringMessengerWindowToFront(panel));
      panel.addEventListener("pointerenter", reveal);
      panel.addEventListener("pointerleave", scheduleAutoHide);
      function keepWindowInsideViewport() {
        if (!win || panel.classList.contains("is-maximized")) return;
        const rect = panel.getBoundingClientRect();
        const next = clampMessengerPosition(panel, rect.left, rect.top);
        panel.style.left = `${next.x}px`;
        panel.style.top = `${next.y}px`;
        persist();
      }
      if (win) win.addEventListener("resize", keepWindowInsideViewport);
      const resizeObserver = win && "ResizeObserver" in win
        ? new win.ResizeObserver(() => {
          if (!panel.classList.contains("is-dragging") && !panel.classList.contains("is-maximized")) persist();
        })
        : null;
      if (resizeObserver) resizeObserver.observe(panel);
      panel._wavekbPersistWindowState = persist;
      scheduleAutoHide();
      return () => {
        if (hideTimer && win) win.clearTimeout(hideTimer);
        if (win) win.removeEventListener("resize", keepWindowInsideViewport);
        if (resizeObserver) resizeObserver.disconnect();
      };
    }

    function resetSocialLifecycle() {
      activeSocialCleanup();
      activeSocialCleanup = () => {};
      renderSequence += 1;
    }

    function registerSocialCleanup(cleanup) {
      if (typeof cleanup !== "function") return;
      const previous = activeSocialCleanup;
      activeSocialCleanup = () => {
        try { previous(); } finally { cleanup(); }
      };
    }

    function resetFloatingMessenger() {
      floatingMessengerCleanup();
      floatingMessengerCleanup = () => {};
      floatingMessengerSequence += 1;
    }

    function registerFloatingMessengerCleanup(cleanup) {
      if (typeof cleanup !== "function") return;
      const previous = floatingMessengerCleanup;
      floatingMessengerCleanup = () => {
        try { previous(); } finally { cleanup(); }
      };
    }

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

    function uiIcon(name, className = "member-ui-icon") {
      const paths = {
        coin: '<circle cx="12" cy="12" r="8"/><path d="M9.5 9.5h3.2a1.8 1.8 0 0 1 0 3.6h-3.4a1.8 1.8 0 0 0 0 3.6h3.2M11 7.5v9M13 7.5v9"/>',
        calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18M8 15l2.2 2L16 12"/>',
        chart: '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>',
        pen: '<path d="m4 20 4.5-1 10.8-10.8a2.1 2.1 0 0 0-3-3L5.5 16 4 20Z"/><path d="m14.5 7 3 3"/>',
        users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
        sparkles: '<path d="m12 3 1.4 3.6L17 8l-3.6 1.4L12 13l-1.4-3.6L7 8l3.6-1.4L12 3ZM5 14l.9 2.1L8 17l-2.1.9L5 20l-.9-2.1L2 17l2.1-.9L5 14ZM19 13l.8 1.8 1.7.7-1.7.7L19 18l-.7-1.8-1.8-.7 1.8-.7L19 13Z"/>',
        arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
        check: '<path d="m5 12 4 4L19 6"/>'
      };
      const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("focusable", "false");
      svg.setAttribute("class", className);
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "1.8");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      svg.innerHTML = paths[name] || paths.sparkles;
      return svg;
    }

    function formatPoints(value) {
      return new Intl.NumberFormat("zh-CN").format(Number(value || 0));
    }

    function selectInput(values, selected = "") {
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

    function researchContextInputs(entry = {}, reviewData = {}) {
      const market = selectInput(catalog.MARKET_GROUPS, entry.market || "crypto");
      const instrument = element("input");
      const listId = `member-instruments-${Math.random().toString(36).slice(2)}`;
      const datalist = element("datalist");
      datalist.id = listId;
      instrument.setAttribute("list", listId);
      instrument.placeholder = "搜索或输入品种，例如 BTC、黄金、标普500";
      instrument.value = entry.instrument || "";
      const timeframe = selectInput(catalog.TIMEFRAMES, entry.timeframe || "4小时");
      const pattern = selectInput(catalog.WAVE_PATTERNS, reviewData.pattern || "unknown");
      const position = selectInput(catalog.WAVE_POSITIONS, reviewData.position || "unknown");
      const direction = selectInput(catalog.DIRECTIONS, reviewData.direction || "unknown");
      function refreshInstruments() {
        datalist.replaceChildren(...catalog.instrumentsFor(market.value).map(name => {
          const option = element("option");
          option.value = name;
          return option;
        }));
      }
      market.addEventListener("change", refreshInstruments);
      refreshInstruments();
      return {market, instrument, timeframe, pattern, position, direction, datalist};
    }

    function routeLink(route, text, className = "kb-knowledge-link") {
      const link = element("a", className, text);
      link.href = core.hashForMemberRoute(route);
      link.addEventListener("click", event => {
        event.preventDefault();
        if (
          route && route.kind === "member" && route.view === "messages" &&
          win && !String(win.location.hash || "").includes("space=messages")
        ) {
          messengerReturnHash = win.location.hash || "#space=home";
          messengerHasBackground = true;
        }
        if (route && route.kind === "member" && route.view === "messages") {
          Promise.resolve(renderMessages({...route, floating: true})).catch(error => {
            showToast(`好友窗口打开失败：${socialError(error)}`, true);
          });
          return;
        }
        navigate(link.hash);
      });
      return link;
    }

    function messengerButton(text = "我的好友", className = "btn btn-ghost member-friends-button") {
      const trigger = button(text, className);
      trigger.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
        messengerReturnHash = win && win.location.hash || "#space=home";
        messengerHasBackground = true;
        Promise.resolve(renderMessages({
          kind: "member",
          view: "messages",
          floating: true
        })).catch(error => {
          showToast(`好友窗口打开失败：${socialError(error)}`, true);
        });
      });
      return trigger;
    }

    function hashLink(hash, text, className = "btn btn-ghost") {
      const link = element("a", className, text);
      link.href = hash;
      link.addEventListener("click", event => {
        event.preventDefault();
        navigate(hash);
      });
      return link;
    }

    function setBreadcrumb(items) {
      if (!items.length) {
        breadcrumbHost.replaceChildren();
        return;
      }
      const list = element("ol", "kb-breadcrumb-list");
      items.forEach((item, index) => {
        const isCurrent = index === items.length - 1;
        const li = element("li", isCurrent ? "is-current" : "");
        if (index) {
          li.appendChild(uiIcon("arrow", "kb-breadcrumb-separator"));
        }
        const crumb = item.route
          ? routeLink(item.route, item.label)
          : item.hash
            ? hashLink(item.hash, item.label, "kb-knowledge-link")
            : element("span", "kb-breadcrumb-current", item.label);
        if (isCurrent) crumb.setAttribute("aria-current", "page");
        li.appendChild(crumb);
        list.appendChild(li);
      });
      breadcrumbHost.replaceChildren(list);
    }

    function notice(title, message) {
      const panel = element("section", "community-notice");
      panel.append(element("h2", "", title), element("p", "", message));
      return panel;
    }

    function requireActor() {
      const actor = auth.actor();
      if (actor) return actor;
      setBreadcrumb([{label: "个人空间"}]);
      contentHost.replaceChildren(notice(
        "登录后进入个人空间",
        "请使用右上角登录。登录后即可保存私密复盘、日记和草稿。"
      ));
      return null;
    }

    function profileAvatar(profile, actor) {
      const theme = nameplateTheme(profile);
      const frameClasses = [
        "member-avatar-frame",
        `is-${theme.style}`,
        theme.pretty ? "is-pretty" : "",
        theme.premium ? "is-premium" : ""
      ].filter(Boolean).join(" ");
      if (profile && profile.avatar_url) {
        const image = element("img", `member-avatar ${frameClasses}`);
        image.src = profile.avatar_url;
        image.alt = `${profile.display_name || actor.displayName}的头像`;
        image.width = 88;
        image.height = 88;
        return image;
      }
      return element(
        "div",
        `member-avatar member-avatar-fallback ${frameClasses}`,
        String(profile && profile.display_name || actor.displayName || "研")
          .slice(0, 1)
      );
    }

    function nameplateTheme(profile) {
      const supported = new Set([
        "classic",
        "blackgold",
        "platinum",
        "purplegold",
        "rainbow",
        "newyear"
      ]);
      const pretty = Boolean(profile && String(profile.public_uid || "").length === 5);
      const requested = String(profile && profile.nameplate_style || "classic");
      const style = supported.has(requested) ? requested : "classic";
      return {
        pretty,
        style: style === "classic" && pretty ? "blackgold" : style,
        premium: style !== "classic" || pretty
      };
    }

    function displayNameNode(profile, fallback, tag = "strong", className = "") {
      const theme = nameplateTheme(profile);
      const classes = [
        "member-display-name",
        `is-${theme.style}`,
        theme.pretty ? "is-pretty" : "",
        className
      ].filter(Boolean).join(" ");
      return element(tag, classes, profile && profile.display_name || fallback || "波浪研究者");
    }

    function uidNameplate(profile) {
      if (!profile || !profile.public_uid) return null;
      const {pretty, style, premium} = nameplateTheme(profile);
      const plate = element(
        "span",
        `member-uid-nameplate is-${style}${pretty ? " is-pretty" : ""}${premium ? " is-premium" : ""}`
      );
      plate.setAttribute("aria-label", premium
        ? `炫彩铭牌 UID ${profile.public_uid}`
        : `UID ${profile.public_uid}`);
      if (premium) {
        plate.appendChild(element("span", "member-liang-icon", "靓"));
      }
      plate.appendChild(element("span", "member-uid-number", String(profile.public_uid)));
      return plate;
    }

    function profileTitle(profile) {
      const label = profile && profile.display_title
        || (profile && profile.role === "admin" ? "知识库管理员" : "波浪研究者");
      return element("span", "member-title-chip", label);
    }

    function externalKind(rawUrl) {
      const value = String(rawUrl || "").trim();
      if (!value) return {url: "", kind: ""};
      try {
        const url = new URL(value);
        if (url.protocol !== "https:") throw new Error();
        const host = url.hostname.toLowerCase().replace(/^www\./, "");
        if (["youtube.com", "youtu.be", "m.youtube.com"].includes(host)) {
          return {url: url.toString(), kind: "youtube"};
        }
        if (["x.com", "twitter.com", "mobile.twitter.com"].includes(host)) {
          return {url: url.toString(), kind: "x"};
        }
      } catch (_) {
        // Fall through to the user-facing validation error.
      }
      throw new Error("外部引用目前只支持完整的 YouTube 或 X 的 https 链接。");
    }

    function entryCard(entry) {
      const article = element("article", "member-entry-card");
      const top = element("div", "member-entry-meta");
      top.append(
        element("span", "member-entry-kind", entryKindLabels()[entry.kind] || "记录"),
        element(
          "time",
          "text-small text-muted",
          new Date(entry.updated_at || entry.created_at || Date.now())
            .toLocaleDateString("zh-CN")
        )
      );
      const title = routeLink(
        {kind: "member-entry", entryId: entry.id},
        entry.title,
        "member-entry-title"
      );
      const excerpt = element(
        "p",
        "text-muted",
        String(entry.body || "").replace(/\s+/g, " ").slice(0, 120)
          || "这条记录还没有正文。"
      );
      article.append(top, title, excerpt);
      return article;
    }

    async function renderHome(view = "home") {
      const actor = requireActor();
      if (!actor) return;
      const sequence = ++renderSequence;
      setBreadcrumb([{label: "个人空间"}]);
      contentHost.replaceChildren(notice("正在读取", "正在打开你的个人空间。"));
      try {
        const [profile, entries, rewardCenter] = await Promise.all([
          repository.getMyProfile(actor.id),
          repository.listPrivateEntries(actor.id, null),
          typeof repository.getRewardCenter === "function"
            ? repository.getRewardCenter().catch(() => null)
            : Promise.resolve(null)
        ]);
        if (sequence !== renderSequence) return;
        const fragment = doc.createDocumentFragment();
        const hero = element(
          "section",
          `member-profile-hero cover-${profile.cover_style || "chart-dark"}`
        );
        if (profile.cover_url) {
          hero.style.setProperty("--member-cover-image", `url("${profile.cover_url.replace(/["\\]/g, "")}")`);
          hero.classList.add("has-cover-image");
        }
        const identity = element("div", "member-profile-identity");
        const avatarStack = element("div", "member-profile-avatar-stack");
        const identityCopy = element("div", "member-profile-identity-copy");
        const avatarLink = routeLink(
          {kind: "member", view: "profile"},
          "",
          "member-avatar-link"
        );
        avatarLink.setAttribute("aria-label", "编辑个人资料");
        avatarLink.append(
          profileAvatar(profile, actor),
          element("span", "member-avatar-edit-mark")
        );
        avatarLink.lastChild.appendChild(uiIcon("pen"));
        const nameRow = element("div", "member-name-row");
        nameRow.append(
          displayNameNode(profile, actor.displayName, "h1"),
          profileTitle(profile)
        );
        const plate = uidNameplate(profile);
        if (plate) nameRow.appendChild(plate);
        avatarStack.appendChild(avatarLink);
        identityCopy.append(
          nameRow,
          element(
            "p",
            "member-profile-bio text-muted",
            profile.bio || "把每一次浪型判断保留成可复查的证据。"
          ),
          routeLink({kind: "member", view: "profile"}, "编辑名片", "member-edit-profile-link")
        );
        if (rewardCenter && rewardCenter.wallet) {
          const pointsLink = routeLink(
            {kind: "member", view: "rewards"},
            "",
            "member-balance-pill"
          );
          pointsLink.append(
            uiIcon("coin"),
            element("span", "", "研究积分"),
            element("strong", "", formatPoints(rewardCenter.wallet.balance))
          );
          avatarStack.appendChild(pointsLink);
        }
        identity.append(avatarStack, identityCopy);
        const actions = element("div", "member-primary-actions");
        actions.append(
          messengerButton("我的好友"),
          hashLink(
            "#workbench=new&step=0",
            privateHomeCopy().primaryAction,
            "btn btn-primary"
          ),
          routeLink({kind: "member", view: "rewards"}, "积分商城", "btn btn-ghost member-store-button")
        );
        hero.append(identity, actions);

        const stats = element("div", "member-profile-statbar");
        const entryRows = Array.isArray(entries) ? entries : [];
        const statItems = [
          ["复盘", entryRows.filter(item => item.kind === "review").length, "#workbench=new&step=0&panel=records&records=review"],
          ["交易日记", entryRows.filter(item => item.kind === "journal").length, "#workbench=new&step=0&panel=records&records=journal"],
          ["研究草稿", entryRows.filter(item => item.kind === "draft").length, "#workbench=new&step=0&panel=records&records=draft"],
          ["可用积分", rewardCenter && rewardCenter.wallet ? rewardCenter.wallet.balance : 0, "#space=rewards"]
        ];
        statItems.forEach(([label, value, hash]) => {
          const item = hashLink(hash, "", "member-profile-stat");
          item.append(element("strong", "", String(value)), element("span", "", label));
          stats.appendChild(item);
        });

        const privacy = element("section", "member-privacy-note");
        privacy.append(
          element("strong", "", "私密工作区"),
          element("p", "", privateHomeCopy().privacy),
          element(
            "p",
            "text-small text-muted",
            "公开观点会生成独立快照，私人原稿与复盘字段不会随帖子公开。"
          )
        );

        fragment.append(hero, stats, privacy);
        contentHost.replaceChildren(fragment);
      } catch (error) {
        contentHost.replaceChildren(notice(
          "私人空间暂时无法读取",
          String(error && error.message || error || "请稍后重试。")
        ));
      }
    }

    function field(label, input, hint) {
      const wrapper = element("label", "community-field");
      wrapper.append(element("span", "", label), input);
      if (hint) wrapper.append(element("small", "text-small text-muted", hint));
      return wrapper;
    }

    function createTVPanel(initialValue, instrumentInput, timeframeInput, marketInput) {
      const panel = element("section", "member-tv-panel");
      const chartUrl = element("input");
      chartUrl.type = "text";
      chartUrl.autocomplete = "off";
      chartUrl.placeholder = "粘贴 TradingView 链接，或输入 BINANCE:BTCUSDT";
      const symbol = element("input");
      symbol.placeholder = "例如 BINANCE:BTCUSDT";
      const interval = element("input");
      interval.placeholder = "例如 4小时、D、60";
      const theme = element("select");
      [["auto", "跟随网站与分享图表"], ["dark", "深色图表"], ["light", "浅色图表"]].forEach(([value, label]) => {
        const option = element("option", "", label);
        option.value = value;
        theme.appendChild(option);
      });
      const fileInput = element("input");
      fileInput.type = "file";
      fileInput.accept = ".json,application/json";
      const status = element("p", "text-small text-muted");
      const preview = element("div", "member-tv-preview");
      const actions = element("div", "member-tv-actions");
      const presets = element("div", "member-tv-presets");
      presets.append(element("span", "member-tv-presets-label", "快速填入"));
      [
        ["BTC 4小时", "BINANCE:BTCUSDT", "4小时"],
        ["黄金 日线", "OANDA:XAUUSD", "日线"],
        ["标普500 周线", "SP:SPX", "周线"]
      ].forEach(([label, presetSymbol, presetInterval]) => {
        const preset = button(label, "btn btn-ghost member-tv-preset");
        preset.addEventListener("click", () => {
          chartUrl.value = presetSymbol;
          symbol.value = presetSymbol;
          interval.value = presetInterval;
          rebuildAndPreview();
        });
        presets.appendChild(preset);
      });
      const apply = button("重新识别", "btn btn-secondary");
      const show = button("刷新图表", "btn btn-ghost");
      const exportButton = button("导出复盘图表包", "btn btn-ghost");
      let chartPackage = initialValue && initialValue.provider === "tradingview"
        ? {...initialValue}
        : null;
      let importedLayoutText = "";
      let autoTimer = 0;

      function setInputs(value) {
        if (!value) return;
        chartUrl.value = value.chart_url || "";
        symbol.value = value.symbol || "";
        interval.value = value.interval || "";
        theme.value = tv.normalizeTheme(value.theme);
      }

      function describe(value) {
        if (!value) {
          status.textContent = "粘贴链接或输入品种代码后，系统会自动识别并加载图表。";
          return;
        }
        const summary = value.layout && value.layout.summary;
        const parts = [
          value.symbol ? `品种 ${value.symbol}` : "",
          value.interval ? `周期 ${value.interval}` : "",
          summary ? `识别到 ${summary.indicatorCount || 0} 个指标` : "",
          summary ? `${summary.drawingCount || 0} 项画线数据` : ""
        ].filter(Boolean);
        status.textContent = parts.length
          ? `已绑定：${parts.join(" · ")}`
          : "图表配置已绑定到本次复盘。";
      }

      function syncResearchContext(value) {
        if (!value) return;
        if (value.symbol) instrumentInput.value = value.symbol;
        const timeframe = tv.intervalLabel(value.interval);
        if (Array.from(timeframeInput.options || []).some(option => option.value === timeframe)) {
          timeframeInput.value = timeframe;
        }
        const market = tv.marketGroupForSymbol(value.symbol);
        if (marketInput && market) {
          marketInput.value = market;
          marketInput.dispatchEvent(new win.Event("change", {bubbles: true}));
        }
      }

      function rebuild() {
        const parsedPrimary = tv.parseChartUrl(chartUrl.value);
        if (parsedPrimary.symbol) symbol.value = parsedPrimary.symbol;
        if (parsedPrimary.interval) interval.value = tv.intervalLabel(parsedPrimary.interval);
        chartPackage = tv.buildPackage({
          chartUrl: chartUrl.value,
          symbol: symbol.value,
          interval: interval.value,
          theme: theme.value,
          layoutText: importedLayoutText,
          layout: !importedLayoutText && chartPackage ? chartPackage.layout : null
        });
        setInputs(chartPackage);
        syncResearchContext(chartPackage);
        describe(chartPackage);
        return chartPackage;
      }

      function rebuildAndPreview() {
        try {
          const value = rebuild();
          if (value && value.symbol) {
            tv.mountWidget(preview, value);
          } else {
            preview.replaceChildren();
            status.textContent = "这个 TradingView 分享链接没有公开品种信息，请补充品种代码。";
          }
        } catch (error) {
          preview.replaceChildren();
          status.textContent = String(error && error.message || error);
        }
      }

      function scheduleAutomaticRead() {
        if (autoTimer && win) win.clearTimeout(autoTimer);
        if (!win) return rebuildAndPreview();
        autoTimer = win.setTimeout(rebuildAndPreview, 520);
      }

      apply.addEventListener("click", () => {
        rebuildAndPreview();
      });
      fileInput.addEventListener("change", async () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        try {
          importedLayoutText = await file.text();
          rebuildAndPreview();
        } catch (error) {
          status.textContent = String(error && error.message || error);
        }
      });
      show.addEventListener("click", () => {
        rebuildAndPreview();
        preview.scrollIntoView({behavior: "smooth", block: "nearest"});
      });
      exportButton.addEventListener("click", () => {
        try {
          const value = rebuild();
          if (!value) throw new Error("当前还没有可导出的图表配置。");
          const url = URL.createObjectURL(tv.exportFile(value));
          const download = element("a");
          download.href = url;
          download.download = `wavekb-tv-${value.symbol || "chart"}-${Date.now()}.json`;
          download.click();
          setTimeout(() => URL.revokeObjectURL(url), 0);
        } catch (error) {
          status.textContent = String(error && error.message || error);
        }
      });

      chartUrl.addEventListener("input", scheduleAutomaticRead);
      chartUrl.addEventListener("paste", () => {
        if (win) win.setTimeout(rebuildAndPreview, 0);
      });
      symbol.addEventListener("input", scheduleAutomaticRead);
      interval.addEventListener("change", rebuildAndPreview);
      theme.addEventListener("change", rebuildAndPreview);

      setInputs(chartPackage);
      describe(chartPackage);
      actions.append(apply, show);
      const grid = element("div", "member-tv-grid");
      grid.append(
        field("TradingView 品种代码", symbol),
        field("图表周期", interval),
        field("显示主题", theme)
      );
      const advanced = element("details", "member-tv-advanced");
      advanced.append(
        element("summary", "", "高级选项：导入或导出图表配置"),
        field("导入图表配置 JSON", fileInput),
        exportButton
      );
      const account = element("details", "member-tv-account");
      const accountStatus = element("p", "text-small text-muted");
      accountStatus.textContent = "TradingView 没有向普通第三方网站开放用户账号登录授权。请在 TradingView 官方页面登录后，复制公开分享链接；私人布局可通过下方 JSON 配置导入。";
      const accountActions = element("div", "member-tv-actions");
      const openTV = element("a", "btn btn-ghost", "打开 TradingView 图表");
      openTV.href = "https://www.tradingview.com/chart/";
      openTV.target = "_blank";
      openTV.rel = "noopener noreferrer";
      accountActions.append(openTV);
      account.append(
        element("summary", "", "TradingView 图表连接说明"),
        accountStatus,
        accountActions,
      );
      panel.append(
        element("h2", "", "获取与绑定图表"),
        element(
          "p",
          "text-small text-muted",
          "粘贴 TradingView 链接或品种代码即可自动识别品种、周期和市场，并直接加载交互图表。"
        ),
        field("TradingView 链接或品种代码", chartUrl, "公开图表可直接预览。私人布局和未公开画线无法由网页自动读取。"),
        grid,
        presets,
        actions,
        account,
        advanced,
        status,
        preview
      );
      if (chartPackage && chartPackage.symbol && win) {
        win.setTimeout(() => tv.mountWidget(preview, chartPackage), 0);
      }
      return {
        node: panel,
        value() {
          try {
            return rebuild();
          } catch (_) {
            return chartPackage;
          }
        }
      };
    }

    async function renderEntry(entryId) {
      const actor = requireActor();
      if (!actor) return;
      const isNew = String(entryId).startsWith("new-");
      setBreadcrumb([
        {label: "交易工作台", hash: "#workbench=new&step=0&panel=records&records=all"},
        {label: "复盘与记录", hash: "#workbench=new&step=0&panel=records&records=all"},
        {label: isNew ? "新建记录" : "编辑记录"}
      ]);
      let entry = {
        kind: entryId === "new-review"
          ? "review"
          : entryId === "new-journal"
            ? "journal"
            : "draft",
        title: "",
        body: "",
        tags: [],
        knowledge_ids: []
      };
      if (!isNew) {
        contentHost.replaceChildren(notice("正在读取", "正在打开私人原稿。"));
        try {
          entry = await repository.getPrivateEntry(entryId);
        } catch (error) {
          contentHost.replaceChildren(notice("无法打开记录", String(error.message || error)));
          return;
        }
      }
      const form = element("form", "member-editor");
      const heading = element("div", "member-editor-heading");
      heading.append(
        element("p", "member-eyebrow", "仅自己可见"),
        element("h1", "", isNew ? "新建私人记录" : "编辑私人记录"),
        element("p", "text-muted", "先保存真实过程，需要公开时再整理成独立快照。")
      );
      const kind = element("select");
      Object.entries(entryKindLabels()).forEach(([value, label]) => {
        const option = element("option", "", label);
        option.value = value;
        option.selected = entry.kind === value;
        kind.appendChild(option);
      });
      const title = element("input");
      title.value = entry.title || "";
      title.maxLength = 120;
      const body = element("textarea");
      body.value = entry.body || "";
      body.rows = 10;
      body.maxLength = 50000;
      const reviewFields = element("section", "member-review-fields");
      const reviewData = {...(entry.review_data || {})};
      let editorMode = reviewData.editor_mode === "professional" ? "professional" : "simple";
      const modeSwitch = element("div", "composer-mode-switch");
      modeSwitch.setAttribute("role", "tablist");
      modeSwitch.setAttribute("aria-label", "记录模式");
      const simpleModeButton = button("简易记录", "composer-mode-button");
      const professionalModeButton = button("专业复盘", "composer-mode-button");
      simpleModeButton.setAttribute("role", "tab");
      professionalModeButton.setAttribute("role", "tab");
      modeSwitch.append(simpleModeButton, professionalModeButton);
      const imagePicker = imageAttachments.createPicker({
        document: doc,
        window: win,
        maxImages: 9,
        initialItems: Array.from(entry.private_entry_images || []).map((image, index) => ({
          id: image.id,
          url: image.signed_url,
          name: `已保存图片 ${index + 1}`
        }))
      });
      imagePicker.bindPasteTarget(form);
      const context = researchContextInputs(entry, reviewData);
      const {instrument, timeframe, market} = context;
      const outcome = element("select");
      [
        ["", "尚未结束"],
        ["win", "盈利"],
        ["loss", "亏损"],
        ["breakeven", "保本"],
        ["cancelled", "未执行"]
      ].forEach(([value, label]) => {
        const option = element("option", "", label);
        option.value = value;
        option.selected = reviewData.outcome === value;
        outcome.appendChild(option);
      });
      const countResult = element("select");
      [
        ["", "待核验"],
        ["correct", "主计数成立"],
        ["alternate", "备选计数成立"],
        ["invalid", "计数失效"]
      ].forEach(([value, label]) => {
        const option = element("option", "", label);
        option.value = value;
        option.selected = reviewData.count_result === value;
        countResult.appendChild(option);
      });
      const ruleCompliance = element("select");
      [
        ["", "待核验"],
        ["yes", "遵守全部硬规则"],
        ["no", "存在规则违规"],
        ["unclear", "证据不足"]
      ].forEach(([value, label]) => {
        const option = element("option", "", label);
        option.value = value;
        option.selected = reviewData.rule_compliance === value;
        ruleCompliance.appendChild(option);
      });
      const executionScore = element("input");
      executionScore.type = "number";
      executionScore.min = "1";
      executionScore.max = "5";
      executionScore.value = reviewData.execution_score || "";
      const lesson = element("textarea");
      lesson.rows = 4;
      lesson.maxLength = 2000;
      lesson.value = reviewData.lesson || "";
      reviewFields.append(
        element("h2", "", "复盘核验"),
        element("p", "text-small text-muted", "把结构判断与交易执行分开记录，避免用盈亏替代规则核验。"),
        field("最终结果", outcome),
        field("数浪结果", countResult),
        field("规则遵守情况", ruleCompliance),
        field("执行纪律（1 至 5 分）", executionScore),
        field("本次经验与下次改进", lesson)
      );
      const researchContext = element("section", "research-editor-section");
      const researchGrid = element("div", "research-context-grid");
      researchGrid.append(
        field("市场分类", market),
        field("品种（可搜索）", instrument),
        context.datalist,
        field("分析周期", timeframe),
        field("当前浪型", context.pattern),
        field("当前子浪", context.position),
        field("方向", context.direction)
      );
      researchContext.append(
        element("p", "member-eyebrow", "分析坐标"),
        element("h2", "", "先固定市场、周期与浪型"),
        element("p", "text-small text-muted", "品种支持预设搜索，也可直接输入交易所代码或自定义名称。"),
        researchGrid
      );
      function syncReviewVisibility() {
        const professional = editorMode === "professional";
        simpleModeButton.classList.toggle("is-active", !professional);
        professionalModeButton.classList.toggle("is-active", professional);
        simpleModeButton.setAttribute("aria-selected", String(!professional));
        professionalModeButton.setAttribute("aria-selected", String(professional));
        researchContext.hidden = !professional;
        reviewFields.hidden = !professional || kind.value !== "review";
        body.rows = professional ? 10 : 16;
        heading.querySelector(".text-muted").textContent = professional
          ? "按市场、周期、浪型和规则保存完整分析过程。"
          : "直接记录文字，再选择、拖入或粘贴多张图片。";
      }
      kind.addEventListener("change", syncReviewVisibility);
      simpleModeButton.addEventListener("click", () => {
        editorMode = "simple";
        syncReviewVisibility();
      });
      professionalModeButton.addEventListener("click", () => {
        editorMode = "professional";
        syncReviewVisibility();
      });
      syncReviewVisibility();
      const status = element("p", "text-small text-muted");
      const actions = element("div", "community-form-actions");
      const save = button("保存私人记录", "btn btn-primary");
      save.type = "submit";
      actions.appendChild(save);
      let publishPanel = null;
      if (!isNew) {
        publishPanel = element("section", "member-publish-panel");
        publishPanel.append(
          element("h2", "", "公开发布"),
          element("p", "text-small text-muted", "发布的是独立快照，私人原稿与复盘核验字段保持私密。")
        );
        const board = element("select");
        Object.entries(publicBoardLabels()).forEach(([value, label]) => {
          const option = element("option", "", label);
          option.value = value;
          board.appendChild(option);
        });
        const externalUrl = element("input");
        externalUrl.type = "url";
        externalUrl.placeholder = "可选：YouTube 视频或 X 帖子链接";
        publishPanel.append(
          field("发布到", board),
          field("外部引用", externalUrl)
        );
        const publish = button(privateHomeCopy().publishAction, "btn btn-secondary");
        publish.addEventListener("click", async () => {
          publish.disabled = true;
          try {
            const external = externalKind(externalUrl.value);
            const publicBody = catalog.compileStructuredPost({
              market: market.value,
              instrument: instrument.value,
              timeframe: timeframe.value,
              pattern: context.pattern.value,
              position: context.position.value,
              direction: context.direction.value,
              thesis: body.value,
              notes: ""
            }, board.value);
            const snapshot = core.createPublicSnapshot(
              {...entry, title: title.value, body: body.value},
              {
                board: board.value,
                body: publicBody,
                summary: body.value.slice(0, 160),
                external_url: external.url,
                external_kind: external.kind
              }
            );
            const postId = await repository.publishSnapshot(entry.id, {
              ...snapshot,
              userId: actor.id
            });
            navigate(
              board.value === "public_viewpoint"
                ? core.hashForMemberRoute({kind: "public-viewpoint", postId})
                : `#post=${encodeURIComponent(postId)}`
            );
          } catch (error) {
            status.textContent = String(error.message || error);
            publish.disabled = false;
          }
        });
        publishPanel.appendChild(publish);
      }
      form.append(
        heading,
        modeSwitch,
        field("记录类型", kind),
        field("标题", title),
        researchContext,
        field("正文", body),
        imagePicker.node,
        reviewFields,
        ...(publishPanel ? [publishPanel] : []),
        actions,
        status
      );
      form.addEventListener("submit", async event => {
        event.preventDefault();
        const validation = core.validatePrivateEntry({
          kind: kind.value,
          title: title.value,
          body: body.value,
          instrument: instrument.value,
          market: market.value,
          timeframe: timeframe.value,
          tags: entry.tags,
          knowledge_ids: entry.knowledge_ids,
          review_data: {
            ...reviewData,
            outcome: outcome.value,
            count_result: countResult.value,
            rule_compliance: ruleCompliance.value,
            pattern: context.pattern.value,
            position: context.position.value,
            direction: context.direction.value,
            execution_score: executionScore.value ? Number(executionScore.value) : null,
            lesson: lesson.value.trim(),
            editor_mode: editorMode,
            // TradingView 编辑入口已停用；保留历史记录，避免用户编辑其他字段时被清空。
            tradingview: reviewData.tradingview || null
          }
        });
        if (!validation.ok) {
          status.textContent = Object.values(validation.errors).join(" ");
          return;
        }
        save.disabled = true;
        status.textContent = "正在保存…";
        try {
          const saved = await repository.savePrivateEntry({
            ...validation.value,
            id: isNew ? undefined : entry.id,
            ownerId: actor.id,
            files: imagePicker.files(),
            keptImageIds: imagePicker.keptIds(),
            existingImages: entry.private_entry_images || []
          });
          status.textContent = "已安全保存到私人空间。";
          if (isNew && saved && saved.id) {
            navigate(`#workbench=new&step=0&panel=records&records=${encodeURIComponent(kind.value)}`);
          }
        } catch (error) {
          status.textContent = `保存失败：${String(error.message || error)}`;
        } finally {
          save.disabled = false;
        }
      });
      contentHost.replaceChildren(form);
    }

    function socialError(error) {
      const message = String(error && error.message || error || "");
      if (/is not a function|undefined/i.test(message)) {
        return "页面组件版本不一致，已为新版功能更新缓存标识；请刷新后重试。";
      }
      if (/function .* does not exist|schema cache|404/i.test(message)) {
        return "社交功能的数据表尚未安装；本地界面已经就绪，执行新增迁移后即可使用。";
      }
      return message || "操作暂时无法完成，请稍后重试。";
    }

    function desktopMessageTime(value) {
      if (!value) return "";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "";
      const now = new Date();
      const clock = date.toLocaleTimeString("zh-CN", {hour: "2-digit", minute: "2-digit"});
      if (date.toDateString() === now.toDateString()) return clock;
      return `${date.toLocaleDateString("zh-CN", {month: "numeric", day: "numeric"})} ${clock}`;
    }

    async function openDesktopChatWindow(conversationId, profile, options = {}) {
      const id = String(conversationId || "");
      if (!id || !profile) return;
      const existing = messengerChatWindows.get(id);
      if (existing && existing.panel && existing.panel.isConnected) {
        existing.panel.classList.remove("is-minimized", "is-auto-hidden");
        if (existing.taskButton) existing.taskButton.remove();
        existing.taskButton = null;
        saveMessengerWindowState(`chat:${id}`, {minimized: false});
        bringMessengerWindowToFront(existing.panel);
        const input = existing.panel.querySelector("textarea");
        if (input) input.focus({preventScroll: true});
        return;
      }
      const actor = requireActor();
      if (!actor) return;
      ensureMessengerDesktop();
      const panel = element("section", "wavekb-chat-window");
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "false");
      panel.setAttribute("aria-label", `与${profile.display_name || "好友"}的聊天窗口`);
      const windowbar = element("header", "wavekb-chat-windowbar");
      const identity = element("div", "wavekb-chat-identity");
      const avatarNode = profileAvatar(profile, {displayName: profile.display_name || "研"});
      avatarNode.classList.add("wavekb-chat-avatar");
      const identityCopy = element("div", "wavekb-chat-identity-copy");
      identityCopy.append(
        displayNameNode(profile, "波浪研究者", "strong"),
        element("span", "wavekb-chat-presence", options.online ? "在线" : "好友 · 私密会话")
      );
      identity.append(avatarNode, identityCopy);
      const actions = element("div", "wavekb-chat-window-actions");
      const pin = button("置顶", "wavekb-window-control wavekb-window-pin");
      const minimize = button("—", "wavekb-window-control");
      minimize.setAttribute("aria-label", "最小化聊天窗口");
      const maximize = button("□", "wavekb-window-control");
      maximize.setAttribute("aria-label", "最大化聊天窗口");
      const close = button("×", "wavekb-window-control");
      close.setAttribute("aria-label", "关闭聊天窗口");
      actions.append(pin, minimize, maximize, close);
      windowbar.append(identity, actions);

      const stream = element("div", "wavekb-chat-stream");
      stream.setAttribute("aria-live", "polite");
      const status = element("p", "wavekb-chat-status");
      const composer = element("form", "wavekb-chat-composer");
      const toolRow = element("div", "wavekb-chat-tools");
      const emojiToggle = button("表情", "wavekb-chat-tool");
      emojiToggle.setAttribute("aria-expanded", "false");
      const imageInput = element("input");
      imageInput.type = "file";
      imageInput.accept = "image/png,image/jpeg,image/gif,image/webp";
      imageInput.hidden = true;
      const screenshotButton = button("截图", "wavekb-chat-tool");
      screenshotButton.title = "选择截图，或直接向消息栏粘贴、拖拽图片";
      toolRow.append(
        emojiToggle,
        screenshotButton,
        imageInput,
        element("span", "wavekb-chat-image-hint", "可粘贴或拖拽图片")
      );

      const emojiPanel = element("div", "wavekb-chat-emoji-panel");
      emojiPanel.hidden = true;
      const quickGrid = element("div", "wavekb-chat-emoji-grid");
      stickerCatalog.forEach(sticker => {
        const option = button(sticker.glyph, "wavekb-chat-emoji");
        option.dataset.sticker = sticker.id;
        option.title = sticker.label;
        option.setAttribute("aria-label", `选择${sticker.label}表情`);
        quickGrid.appendChild(option);
      });
      const customHead = element("div", "wavekb-chat-custom-head");
      customHead.append(
        element("strong", "", "我的表情"),
        element("span", "", "GIF / WebP / PNG / JPEG")
      );
      const customGrid = element("div", "wavekb-chat-custom-grid");
      emojiPanel.append(quickGrid, customHead, customGrid);

      const pending = element("div", "wavekb-chat-pending");
      pending.hidden = true;
      const textarea = element("textarea");
      textarea.rows = 3;
      textarea.maxLength = 4000;
      textarea.placeholder = "输入消息…";
      const send = button("发送", "wavekb-chat-send");
      send.type = "submit";
      const inputRow = element("div", "wavekb-chat-input-row");
      inputRow.append(textarea, send);
      composer.append(toolRow, emojiPanel, pending, inputRow);
      panel.append(windowbar, stream, status, composer);
      messengerDesktopLayer.appendChild(panel);

      const cleanups = [];
      const record = {panel, taskButton: null, cleanup: () => {}};
      messengerChatWindows.set(id, record);
      const releasePosition = installMessengerWindow(panel, {
        id: `chat:${id}`,
        kind: "chat",
        width: 960,
        height: 780,
        x: Math.max(20, ((win ? win.innerWidth : 1440) - 960) / 2 + (messengerChatWindows.size % 4) * 24),
        y: 44 + (messengerChatWindows.size % 4) * 24
      });
      const initiallyMaximized = panel.classList.contains("is-maximized");
      maximize.textContent = initiallyMaximized ? "还原" : "□";
      maximize.setAttribute("aria-label", initiallyMaximized ? "还原聊天窗口" : "最大化聊天窗口");
      pin.setAttribute("aria-pressed", String(panel.classList.contains("is-pinned")));
      pin.classList.toggle("is-active", panel.classList.contains("is-pinned"));
      pin.textContent = panel.classList.contains("is-pinned") ? "已置顶" : "置顶";
      cleanups.push(releasePosition);
      let pendingBody = "";
      let lastMessageKey = "";
      let pollTimer = 0;
      let disposed = false;
      let sending = false;

      function setEmojiPanel(open) {
        const visible = Boolean(open);
        emojiPanel.hidden = !visible;
        emojiToggle.classList.toggle("is-active", visible);
        emojiToggle.setAttribute("aria-expanded", String(visible));
        emojiToggle.textContent = visible ? "收起表情" : "表情";
      }
      function clearPending() {
        pendingBody = "";
        pending.hidden = true;
        pending.replaceChildren();
      }
      function stageMessage(body, preview, label) {
        pendingBody = body;
        textarea.value = "";
        const remove = button("×", "wavekb-chat-pending-remove");
        remove.setAttribute("aria-label", "移除待发送内容");
        remove.addEventListener("click", clearPending);
        pending.replaceChildren(preview, element("span", "", `待发送：${label}`), remove);
        pending.hidden = false;
        setEmojiPanel(false);
        send.focus({preventScroll: true});
      }
      function resizeComposerInput() {
        textarea.style.height = "auto";
        textarea.style.height = `${Math.min(180, Math.max(92, textarea.scrollHeight))}px`;
      }
      function renderMessages(rows, forceScroll = false) {
        const nearBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 84;
        stream.replaceChildren();
        if (!rows || !rows.length) {
          stream.appendChild(element("p", "wavekb-chat-empty", "你们已经是好友，发送第一条消息吧。"));
        } else {
          rows.forEach(message => {
            const mine = message.sender_id === actor.id;
            const row = element("div", `wavekb-chat-message${mine ? " is-mine" : ""}`);
            const messageAvatar = mine
              ? null
              : profileAvatar(profile, {displayName: profile.display_name || "研"});
            if (messageAvatar) messageAvatar.classList.add("wavekb-chat-message-avatar");
            const bubble = element("article", "wavekb-chat-bubble");
            const sticker = stickerFromBody(message.body);
            const custom = customStickerFromBody(message.body);
            if (sticker) {
              const glyph = element("span", "wavekb-chat-sticker", sticker.glyph);
              glyph.setAttribute("aria-label", sticker.label);
              bubble.appendChild(glyph);
            } else if (custom && typeof repository.chatStickerPublicUrl === "function") {
              const image = element("img", "wavekb-chat-sticker-image");
              image.src = repository.chatStickerPublicUrl(custom.storage_path);
              image.alt = custom.label;
              image.loading = "lazy";
              bubble.appendChild(image);
            } else {
              bubble.appendChild(element("p", "", message.body));
            }
            const meta = element("span", "wavekb-chat-message-meta");
            meta.appendChild(element("time", "wavekb-chat-time", desktopMessageTime(message.created_at)));
            if (mine) meta.appendChild(element("span", "wavekb-chat-delivery", "已发送"));
            bubble.appendChild(meta);
            if (messageAvatar) row.append(messageAvatar, bubble);
            else row.appendChild(bubble);
            stream.appendChild(row);
          });
        }
        const newest = rows && rows[rows.length - 1];
        lastMessageKey = newest ? `${newest.id || ""}:${newest.created_at || ""}:${rows.length}` : "empty";
        if (newest && typeof repository.markConversationRead === "function" && doc.visibilityState !== "hidden") {
          Promise.resolve(repository.markConversationRead(id, Number(newest.id || 0))).catch(() => {});
        }
        if (forceScroll || nearBottom) requestAnimationFrame(() => { stream.scrollTop = stream.scrollHeight; });
      }
      async function refreshMessages(forceScroll = false) {
        try {
          const rows = await repository.listMessages(id);
          if (!disposed) renderMessages(rows || [], forceScroll);
        } catch (error) {
          if (!disposed) status.textContent = `消息同步暂缓：${socialError(error)}`;
        }
      }
      async function loadCustomStickers() {
        customGrid.replaceChildren();
        if (typeof repository.listChatStickers !== "function" || typeof repository.chatStickerPublicUrl !== "function") return;
        try {
          const stickers = await repository.listChatStickers(actor.id);
          (stickers || []).forEach(sticker => {
            const option = button("", "wavekb-chat-custom-sticker");
            const image = element("img");
            image.src = repository.chatStickerPublicUrl(sticker.storage_path);
            image.alt = sticker.label || "自定义表情";
            option.appendChild(image);
            option.addEventListener("click", () => {
              const preview = image.cloneNode();
              stageMessage(customStickerToken(sticker), preview, sticker.label || "自定义表情");
            });
            customGrid.appendChild(option);
          });
        } catch (_) {}
      }
      async function uploadImage(file) {
        const validation = validateCustomStickerFile(file);
        if (!validation.ok) {
          status.textContent = validation.error;
          return;
        }
        if (typeof repository.uploadChatSticker !== "function") {
          status.textContent = "图片服务尚未连接。";
          return;
        }
        screenshotButton.disabled = true;
        screenshotButton.textContent = "处理中…";
        try {
          const mimeType = resolvedCustomStickerMime(file);
          const uploadFile = file.type === mimeType
            ? file
            : new File([file], file.name || "聊天图片", {type: mimeType, lastModified: file.lastModified || Date.now()});
          const sticker = await repository.uploadChatSticker(actor.id, uploadFile);
          const stored = Array.isArray(sticker) ? sticker[0] : sticker;
          if (!stored) throw new Error("图片上传后未返回文件记录。");
          const preview = element("img");
          preview.src = repository.chatStickerPublicUrl(stored.storage_path);
          preview.alt = stored.label || "聊天图片";
          stageMessage(customStickerToken(stored), preview, stored.label || "聊天图片");
          await loadCustomStickers();
        } catch (error) {
          status.textContent = `图片上传失败：${socialError(error)}`;
        } finally {
          screenshotButton.disabled = false;
          screenshotButton.textContent = "截图";
        }
      }

      emojiToggle.addEventListener("click", event => {
        event.stopPropagation();
        setEmojiPanel(emojiPanel.hidden);
      });
      quickGrid.addEventListener("click", event => {
        const option = event.target.closest("[data-sticker]");
        if (!option) return;
        const sticker = stickerCatalog.find(item => item.id === option.dataset.sticker);
        if (!sticker) return;
        stageMessage(`[[sticker:${sticker.id}]]`, element("span", "wavekb-chat-pending-glyph", sticker.glyph), sticker.label);
      });
      screenshotButton.addEventListener("click", () => {
        imageInput.click();
      });
      imageInput.addEventListener("change", () => {
        const file = imageInput.files && imageInput.files[0];
        imageInput.value = "";
        if (file) uploadImage(file);
      });
      function firstImageFile(transfer) {
        if (!transfer) return null;
        const fromFiles = Array.from(transfer.files || []).find(file => String(file.type || "").startsWith("image/"));
        if (fromFiles) return fromFiles;
        return Array.from(transfer.items || [])
          .filter(item => item.kind === "file" && String(item.type || "").startsWith("image/"))
          .map(item => item.getAsFile && item.getAsFile())
          .find(Boolean) || null;
      }
      textarea.addEventListener("paste", event => {
        const file = firstImageFile(event.clipboardData);
        if (!file || !String(file.type || "").startsWith("image/")) return;
        event.preventDefault();
        uploadImage(file);
      });
      composer.addEventListener("dragover", event => {
        if (!firstImageFile(event.dataTransfer)) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
        composer.classList.add("is-image-dragover");
      });
      composer.addEventListener("dragleave", event => {
        if (!composer.contains(event.relatedTarget)) composer.classList.remove("is-image-dragover");
      });
      composer.addEventListener("drop", event => {
        const file = firstImageFile(event.dataTransfer);
        composer.classList.remove("is-image-dragover");
        if (!file) return;
        event.preventDefault();
        uploadImage(file);
      });
      textarea.addEventListener("input", () => {
        if (textarea.value && pendingBody) clearPending();
        resizeComposerInput();
      });
      textarea.addEventListener("keydown", event => {
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
          event.preventDefault();
          composer.requestSubmit();
        }
      });
      composer.addEventListener("submit", async event => {
        event.preventDefault();
        const body = pendingBody || textarea.value.trim();
        if (!body || sending) return;
        sending = true;
        send.disabled = true;
        status.textContent = "发送中…";
        try {
          await repository.sendMessage(id, body);
          textarea.value = "";
          resizeComposerInput();
          clearPending();
          status.textContent = "";
          playSocialSound("sent", true);
          await refreshMessages(true);
          textarea.focus({preventScroll: true});
        } catch (error) {
          status.textContent = socialError(error);
        } finally {
          sending = false;
          send.disabled = false;
        }
      });
      const dismissEmoji = event => {
        if (emojiPanel.hidden || emojiPanel.contains(event.target) || emojiToggle.contains(event.target)) return;
        setEmojiPanel(false);
      };
      doc.addEventListener("pointerdown", dismissEmoji);
      cleanups.push(() => doc.removeEventListener("pointerdown", dismissEmoji));

      pin.addEventListener("click", () => {
        const pressed = !panel.classList.contains("is-pinned");
        pin.setAttribute("aria-pressed", String(pressed));
        pin.classList.toggle("is-active", pressed);
        pin.textContent = pressed ? "已置顶" : "置顶";
        panel.classList.toggle("is-pinned", pressed);
        panel.classList.remove("is-auto-hidden");
        saveMessengerWindowState(`chat:${id}`, {pinned: pressed});
        bringMessengerWindowToFront(panel);
      });
      minimize.addEventListener("click", () => {
        panel.classList.add("is-minimized");
        saveMessengerWindowState(`chat:${id}`, {minimized: true});
        if (!record.taskButton || !record.taskButton.isConnected) {
          record.taskButton = button(profile.display_name || "聊天", "wavekb-messenger-task");
          record.taskButton.addEventListener("click", () => {
            panel.classList.remove("is-minimized");
            record.taskButton.remove();
            record.taskButton = null;
            saveMessengerWindowState(`chat:${id}`, {minimized: false});
            bringMessengerWindowToFront(panel);
          });
          messengerTaskbar.appendChild(record.taskButton);
        }
      });
      maximize.addEventListener("click", () => {
        const maximized = panel.classList.toggle("is-maximized");
        maximize.textContent = maximized ? "还原" : "□";
        maximize.setAttribute("aria-label", maximized ? "还原聊天窗口" : "最大化聊天窗口");
        saveMessengerWindowState(`chat:${id}`, {maximized});
        bringMessengerWindowToFront(panel);
      });
      function dispose() {
        if (disposed) return;
        disposed = true;
        if (pollTimer && win) win.clearTimeout(pollTimer);
        cleanups.splice(0).forEach(cleanup => {
          try { cleanup(); } catch (_) {}
        });
        if (record.taskButton) record.taskButton.remove();
        panel.remove();
        messengerChatWindows.delete(id);
      }
      record.cleanup = dispose;
      close.addEventListener("click", dispose);
      function schedulePoll(delay = 7000) {
        if (!win || disposed) return;
        if (pollTimer) win.clearTimeout(pollTimer);
        pollTimer = win.setTimeout(async () => {
          if (disposed || doc.visibilityState === "hidden") return schedulePoll();
          try {
            const rows = await repository.listMessages(id);
            const newest = rows && rows[rows.length - 1];
            const nextKey = newest ? `${newest.id || ""}:${newest.created_at || ""}:${rows.length}` : "empty";
            if (nextKey !== lastMessageKey) {
              if (newest && newest.sender_id !== actor.id && lastMessageKey) playSocialSound("received");
              renderMessages(rows || []);
            }
          } catch (_) {}
          schedulePoll();
        }, delay);
      }
      await Promise.all([refreshMessages(true), loadCustomStickers()]);
      resizeComposerInput();
      schedulePoll();
      requestAnimationFrame(() => textarea.focus({preventScroll: true}));
    }

    async function openProfileConversation(profile, trigger, feedback) {
      if (!profile || !profile.id) return;
      if (trigger) trigger.disabled = true;
      if (feedback) feedback.textContent = "正在打开会话…";
      try {
        const conversationId = await repository.openConversation(profile.id);
        await openDesktopChatWindow(conversationId, profile);
        if (feedback) feedback.textContent = "";
        if (trigger) trigger.disabled = false;
      } catch (error) {
        if (feedback) feedback.textContent = socialError(error);
        if (trigger) trigger.disabled = false;
      }
    }

    function socialProfileCard(profile, connection, options = {}) {
      const card = element(
        "article",
        `member-person-card${options.compact ? " is-compact" : ""}`
      );
      const identity = element("div", "member-person-identity");
      const avatarNode = profileAvatar(profile, {displayName: profile.display_name || "研"});
      const avatarButton = button("", "member-avatar-button");
      avatarButton.setAttribute("aria-label", `查看${profile.display_name || "该研究者"}的个人主页`);
      avatarButton.appendChild(avatarNode);
      avatarButton.addEventListener("click", () => {
        navigate(core.hashForMemberRoute({
          kind: "member",
          view: "person",
          uid: profile.public_uid
        }));
      });
      const copyNode = element("div", "member-person-copy");
      identity.append(avatarButton, copyNode);
      const copy = identity.lastChild;
      const name = element("div", "member-name-row");
      name.append(displayNameNode(profile, "波浪研究者", "h3"), profileTitle(profile));
      const plate = uidNameplate(profile);
      if (plate) name.appendChild(plate);
      copy.append(name, element("p", "text-small text-muted", profile.bio || "尚未填写个人简介。"));
      const actions = element("div", "member-person-actions");
      const status = element("span", "text-small text-muted");
      if (profile.public_uid) {
        actions.appendChild(routeLink(
          {kind: "member", view: "person", uid: profile.public_uid},
          "查看主页",
          "btn btn-ghost member-view-profile"
        ));
      }
      if (connection && connection.status === "self") {
        status.textContent = "这是你的个人名片";
      } else if (connection && connection.status === "unavailable") {
        status.textContent = "好友关系暂未读取，请稍后重试";
      } else if (connection && connection.status === "accepted") {
        status.textContent = "已是好友";
        const chat = button("发起会话", "btn btn-primary");
        chat.addEventListener("click", () => {
          openProfileConversation(profile, chat, status);
        });
        actions.append(chat);
      } else if (connection && connection.status === "pending" && connection.direction === "incoming") {
        const accept = button("接受好友", "btn btn-primary");
        const decline = button("忽略", "btn btn-ghost");
        accept.addEventListener("click", async () => {
          accept.disabled = true;
          try {
            await repository.respondFriend(connection.friendship_id, true);
            playSocialSound("friend", true);
            (options.refresh || (() => renderPeople({})))();
          } catch (error) {
            status.textContent = socialError(error);
            accept.disabled = false;
          }
        });
        decline.addEventListener("click", async () => {
          decline.disabled = true;
          try {
            await repository.respondFriend(connection.friendship_id, false);
            (options.refresh || (() => renderPeople({})))();
          } catch (error) {
            status.textContent = socialError(error);
            decline.disabled = false;
          }
        });
        actions.append(accept, decline);
      } else if (connection && connection.status === "pending") {
        status.textContent = "好友请求已发送";
      } else {
        const add = button("添加好友", "btn btn-primary");
        add.addEventListener("click", async () => {
          add.disabled = true;
          try {
            await repository.requestFriend(profile.id);
            playSocialSound("friend", true);
            add.textContent = "已发送";
            status.textContent = "等待对方接受";
            if (options.refresh) options.refresh();
          } catch (error) {
            status.textContent = socialError(error);
            add.disabled = false;
          }
        });
        actions.append(add);
      }
      actions.append(status);
      card.append(identity, actions);
      return card;
    }

    function publicMemberPostCard(post) {
      const card = element("article", "member-public-post-card");
      const meta = element("div", "member-public-post-meta");
      meta.append(
        element("span", "member-public-post-board", publicBoardLabels()[post.board] || "公开内容"),
        element("time", "text-small text-muted", new Date(post.created_at || Date.now()).toLocaleDateString("zh-CN"))
      );
      card.append(
        meta,
        routeLink({kind: "public-viewpoint", postId: post.id}, post.title || "未命名研究", "member-public-post-title"),
        element("p", "text-muted", post.summary || String(post.body || "").replace(/\s+/g, " ").slice(0, 140) || "暂无摘要。")
      );
      return card;
    }

    async function renderPublicProfile(route) {
      const actor = requireActor();
      if (!actor) return;
      const uid = String(route && route.uid || "").trim();
      if (!/^\d{5,6}$/.test(uid)) {
        contentHost.replaceChildren(notice("UID 无效", "请返回好友页面重新查找 5 至 6 位 UID。"));
        return;
      }
      const sequence = ++renderSequence;
      setBreadcrumb([
        {label: "我的好友", route: {kind: "member", view: "messages"}},
        {label: `UID ${uid}`}
      ]);
      contentHost.replaceChildren(notice("正在打开主页", "正在读取公开资料与研究内容。"));
      try {
        const profileRows = await repository.searchByUid(uid);
        const profile = Array.isArray(profileRows) ? profileRows[0] : profileRows;
        if (!profile) {
          contentHost.replaceChildren(notice("没有找到该用户", "该 UID 不存在，或账号当前不可访问。"));
          return;
        }
        const [connectionsState, postsState, followingState] = await Promise.allSettled([
          repository.listConnections(),
          typeof repository.listPublicPostsByAuthor === "function"
            ? repository.listPublicPostsByAuthor(profile.id, 16)
            : Promise.resolve([]),
          profile.id !== actor.id && typeof repository.isFollowing === "function"
            ? repository.isFollowing(actor.id, profile.id)
            : Promise.resolve(false)
        ]);
        if (sequence !== renderSequence) return;
        const connections = connectionsState.status === "fulfilled" ? connectionsState.value || [] : [];
        const posts = postsState.status === "fulfilled" ? postsState.value || [] : [];
        let isFollowing = followingState.status === "fulfilled" && Boolean(followingState.value);
        const connection = profile.id === actor.id
          ? {status: "self"}
          : connections.find(item => item.other_id === profile.id);

        const page = element("div", "member-public-profile-page");
        const hero = element("section", `member-public-profile-hero cover-${profile.cover_style || "chart-dark"}`);
        if (connection && connection.status === "self") hero.classList.add("is-own-profile");
        if (profile.cover_url) {
          hero.style.setProperty("--member-cover-image", `url("${profile.cover_url.replace(/["\\]/g, "")}")`);
          hero.classList.add("has-cover-image");
        }
        const cover = element("div", "member-public-profile-cover");
        cover.setAttribute("aria-hidden", "true");
        const avatarNode = profileAvatar(profile, {displayName: profile.display_name || "研"});
        avatarNode.classList.add("member-public-profile-avatar");
        const copy = element("div", "member-public-profile-copy");
        const title = profileTitle(profile);
        title.classList.add("member-public-profile-title");
        const name = element("div", "member-name-row");
        name.append(displayNameNode(profile, "波浪研究者", "h1"));
        const plate = uidNameplate(profile);
        if (plate) name.appendChild(plate);
        copy.append(title, name, element("p", "member-public-profile-bio", profile.bio || "这位研究者还没有填写个人签名。"));
        const tags = element("div", "member-public-profile-tags");
        [...(profile.markets || []), ...(profile.timeframes || [])].slice(0, 8).forEach(value => {
          tags.appendChild(element("span", "member-public-profile-tag", value));
        });
        if (tags.childElementCount) copy.appendChild(tags);
        const actions = element("div", "member-public-profile-actions");
        const status = element("p", "member-public-profile-status");
        let topAction = null;
        if (connection && connection.status === "self") {
          topAction = routeLink({kind: "member", view: "profile"}, "编辑个人资料", "btn btn-ghost member-public-profile-edit");
          actions.appendChild(routeLink({kind: "member", view: "home"}, "回到个人空间", "btn btn-ghost"));
          status.textContent = "这是你的公开主页预览。";
        } else {
          const follow = button(
            isFollowing ? "已关注" : "关注",
            "btn btn-ghost member-public-profile-edit member-public-profile-follow"
          );
          follow.setAttribute("aria-pressed", String(isFollowing));
          follow.addEventListener("click", async () => {
            follow.disabled = true;
            try {
              if (isFollowing) await repository.unfollowProfile(actor.id, profile.id);
              else await repository.followProfile(actor.id, profile.id);
              isFollowing = !isFollowing;
              follow.textContent = isFollowing ? "已关注" : "关注";
              follow.setAttribute("aria-pressed", String(isFollowing));
              status.textContent = isFollowing ? "已关注这位研究者。" : "已取消关注。";
            } catch (error) {
              status.textContent = socialError(error);
            } finally {
              follow.disabled = false;
            }
          });
          topAction = follow;
          if (connection && connection.status === "accepted") {
            const chat = button("发起会话", "btn btn-primary");
            chat.addEventListener("click", () => openProfileConversation(profile, chat, status));
            actions.appendChild(chat);
            status.textContent = "你们已经是好友，点击即可开始会话。";
          } else if (connection && connection.status === "pending") {
            const pending = button(
              connection.direction === "incoming" ? "好友请求待处理" : "请求已发送",
              "btn btn-ghost"
            );
            pending.disabled = true;
            actions.appendChild(pending);
            status.textContent = connection.direction === "incoming"
              ? "对方已向你发送好友请求，请在好友列表中处理。"
              : "等待对方接受好友请求。";
          } else {
            const add = button("添加好友", "btn btn-primary");
            add.addEventListener("click", async () => {
              add.disabled = true;
              status.textContent = "正在发送好友请求。";
              try {
                await repository.requestFriend(profile.id);
                playSocialSound("friend", true);
                add.textContent = "请求已发送";
                status.textContent = "等待对方接受好友请求。";
              } catch (error) {
                status.textContent = socialError(error);
                add.disabled = false;
              }
            });
            actions.appendChild(add);
          }
        }
        const identity = element("div", "member-public-profile-identity");
        identity.append(avatarNode, copy);
        const actionStack = element("div", "member-public-profile-action-stack");
        actionStack.append(actions, status);
        const summary = element("div", "member-public-profile-summary");
        summary.append(identity, actionStack);
        hero.appendChild(cover);
        if (topAction) hero.appendChild(topAction);
        hero.appendChild(summary);

        const overview = element("section", "member-public-profile-overview");
        overview.setAttribute("aria-label", "公开资料摘要");
        const boardCount = new Set(posts.map(post => post.board)).size;
        const marketCount = Array.isArray(profile.markets) ? profile.markets.length : 0;
        [["公开内容", posts.length], ["参与板块", boardCount], ["关注市场", marketCount]].forEach(([label, value]) => {
          const item = element("div", "member-public-profile-metric");
          item.append(element("strong", "", String(value)), element("span", "", label));
          overview.appendChild(item);
        });
        const content = element("section", "member-public-profile-content");
        const contentHeading = element("header", "member-public-content-heading");
        contentHeading.append(
          element("h2", "", "公开研究"),
          element("p", "text-muted", "仅展示已经发布的观点、思路与案例。")
        );
        content.appendChild(contentHeading);
        const grid = element("div", "member-public-post-grid");
        if (!posts.length) {
          grid.appendChild(notice("还没有公开内容", "私人复盘、日记和草稿不会显示在其他用户的主页。"));
        } else {
          posts.forEach(post => grid.appendChild(publicMemberPostCard(post)));
        }
        content.appendChild(grid);
        page.append(hero, overview, content);
        contentHost.replaceChildren(page);
      } catch (error) {
        contentHost.replaceChildren(notice("主页暂时无法读取", socialError(error)));
      }
    }

    async function renderPeople(route) {
      return renderMessages({
        kind: "member",
        view: "messages",
        openFriendSearch: true,
        uid: route && route.uid || ""
      });
    }

    async function renderMessages(route) {
      const floating = true;
      if (messengerFriendWindow && messengerFriendWindow.panel && messengerFriendWindow.panel.isConnected) {
        const existing = messengerFriendWindow;
        existing.panel.classList.remove("is-minimized", "is-auto-hidden");
        if (messengerFriendTaskButton) messengerFriendTaskButton.remove();
        messengerFriendTaskButton = null;
        saveMessengerWindowState("friend-directory", {minimized: false});
        bringMessengerWindowToFront(existing.panel);
        if (route && route.openFriendSearch && typeof existing.openFriendSearch === "function") {
          existing.openFriendSearch(route.uid || "");
        }
        return;
      }
      resetFloatingMessenger();
      const actor = requireActor();
      if (!actor) return;
      const sequence = floating ? ++floatingMessengerSequence : ++renderSequence;
      const isStale = () => floating
        ? sequence !== floatingMessengerSequence
        : sequence !== renderSequence;
      const registerMessageCleanup = floating
        ? registerFloatingMessengerCleanup
        : registerSocialCleanup;
      const hasActiveConversation = Boolean(route.conversationId || route.mentorThreadId);
      const shell = element("section", "member-message-shell member-messenger-shell member-messenger-overlay");
      const windowPanel = element(
        "div",
        "member-messenger-window is-directory-view wavekb-friend-panel"
      );
      windowPanel.setAttribute("role", "dialog");
      windowPanel.setAttribute("aria-modal", "false");
      windowPanel.setAttribute("aria-label", "我的好友与站内会话");
      const heading = element("div", "member-social-heading member-messenger-heading member-messenger-windowbar");
      const headingCopy = element("div", "member-heading-copy");
      headingCopy.append(element("h1", "", "我的好友"));
      heading.append(headingCopy);
      const minimizeMessenger = button("−", "member-messenger-minimize");
      minimizeMessenger.setAttribute("aria-label", "最小化好友窗口");
      const closeMessenger = button("×", "member-messenger-close");
      closeMessenger.setAttribute("aria-label", "关闭好友窗口");
      closeMessenger.addEventListener("click", () => {
        if (floating) {
          resetFloatingMessenger();
          return;
        }
        const returnHash = messengerReturnHash || "#space=home";
        if (messengerHasBackground && win && win.history && typeof win.history.replaceState === "function") {
          resetSocialLifecycle();
          win.history.replaceState(win.history.state, "", returnHash);
          messengerHasBackground = false;
          return;
        }
        messengerHasBackground = false;
        navigate(returnHash);
      });
      const windowActions = element("div", "member-messenger-window-actions");
      windowActions.append(minimizeMessenger, closeMessenger);
      heading.appendChild(windowActions);
      const socialOverview = element("div", "member-social-overview is-loading");
      ["好友", "最近会话", "待处理请求"].forEach(label => {
        const item = element("div", "member-social-overview-item");
        item.append(element("strong", "", "—"), element("span", "", label));
        socialOverview.appendChild(item);
      });
      const feedback = element("p", "community-form-message member-chat-feedback");
      const messenger = element(
        "div",
        "member-messenger is-directory-view"
      );
      const sidebar = element("aside", "member-chat-sidebar");
      const pane = element("section", `member-chat-pane${hasActiveConversation ? " has-conversation" : ""}`);
      const loading = notice("正在连接好友", "正在读取好友列表与最近会话。 ");
      pane.appendChild(loading);
      messenger.append(sidebar, pane);
      windowPanel.append(heading, feedback, messenger);
      shell.append(windowPanel);
      ensureMessengerDesktop().appendChild(shell);
      const releaseFriendPosition = installMessengerWindow(windowPanel, {
        id: "friend-directory",
        kind: "directory",
        width: 560,
        height: 720
      });
      windowPanel.classList.add("is-pinned");
      windowPanel.classList.remove("is-auto-hidden", "is-minimized");
      saveMessengerWindowState("friend-directory", {pinned: true, minimized: false});
      messengerFriendWindow = {panel: windowPanel, shell, openFriendSearch: null};
      minimizeMessenger.addEventListener("click", () => {
        windowPanel.classList.add("is-minimized");
        saveMessengerWindowState("friend-directory", {minimized: true});
        if (messengerFriendTaskButton && messengerFriendTaskButton.isConnected) return;
        messengerFriendTaskButton = button("我的好友", "wavekb-messenger-task is-friends");
        messengerFriendTaskButton.addEventListener("click", () => {
          windowPanel.classList.remove("is-minimized");
          messengerFriendTaskButton.remove();
          messengerFriendTaskButton = null;
          saveMessengerWindowState("friend-directory", {minimized: false});
          bringMessengerWindowToFront(windowPanel);
        });
        messengerTaskbar.appendChild(messengerFriendTaskButton);
      });
      registerMessageCleanup(() => {
        if (messengerFriendTaskButton) messengerFriendTaskButton.remove();
        messengerFriendTaskButton = null;
        if (messengerFriendWindow && messengerFriendWindow.panel === windowPanel) messengerFriendWindow = null;
        shell.remove();
      });
      registerMessageCleanup(releaseFriendPosition);

      function connectionProfile(connection) {
        return {
          id: connection.other_id,
          public_uid: connection.public_uid,
          display_name: connection.display_name,
          avatar_url: connection.avatar_url,
          bio: connection.bio,
          role: connection.role,
          display_title: connection.display_title,
          nameplate_style: connection.nameplate_style
        };
      }

      function conversationProfile(conversation) {
        return {
          id: conversation.other_id,
          public_uid: conversation.public_uid,
          display_name: conversation.display_name,
          avatar_url: conversation.avatar_url,
          display_title: conversation.display_title,
          nameplate_style: conversation.nameplate_style
        };
      }

      function contactContent(profile, subtitle) {
        const fragment = doc.createDocumentFragment();
        fragment.appendChild(profileAvatar(profile, {displayName: profile.display_name || "研"}));
        const copy = element("span", "member-chat-contact-copy");
        const nameRow = element("span", "member-chat-contact-name");
        nameRow.appendChild(displayNameNode(profile, "波浪研究者", "strong"));
        const plate = uidNameplate(profile);
        if (plate) nameRow.appendChild(plate);
        copy.append(
          nameRow,
          element("span", "member-chat-contact-preview", subtitle || "点击头像开始会话")
        );
        fragment.appendChild(copy);
        return fragment;
      }

      function conversationTime(value) {
        if (!value) return "";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "";
        const now = new Date();
        if (date.toDateString() === now.toDateString()) {
          return date.toLocaleTimeString("zh-CN", {hour: "2-digit", minute: "2-digit"});
        }
        if (date.getFullYear() === now.getFullYear()) {
          return date.toLocaleDateString("zh-CN", {month: "numeric", day: "numeric"});
        }
        return date.toLocaleDateString("zh-CN", {year: "numeric", month: "numeric", day: "numeric"});
      }

      function messageTime(value) {
        if (!value) return "";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "";
        const now = new Date();
        const clock = date.toLocaleTimeString("zh-CN", {hour: "2-digit", minute: "2-digit"});
        if (date.toDateString() === now.toDateString()) return clock;
        const day = date.toLocaleDateString("zh-CN", {
          ...(date.getFullYear() === now.getFullYear() ? {} : {year: "2-digit"}),
          month: "numeric",
          day: "numeric"
        });
        return `${day} ${clock}`;
      }

      function sectionTitle(label, count) {
        const row = element("div", "member-chat-section-title");
        row.append(
          element("strong", "", label),
          element("span", "", String(count || 0))
        );
        return row;
      }

      try {
        const [connectionsState, conversationsState, studentsState, mentorAccessState, claimsState] = await Promise.allSettled([
          repository.listConnections(),
          repository.listConversations(),
          typeof repository.listMentorStudents === "function"
            ? repository.listMentorStudents()
            : Promise.resolve([]),
          typeof repository.listMentorAccess === "function"
            ? repository.listMentorAccess()
            : Promise.resolve([]),
          typeof repository.listMentorPaymentClaims === "function"
            ? repository.listMentorPaymentClaims()
            : Promise.resolve([])
        ]);
        if (isStale()) return;
        if (connectionsState.status === "rejected" && conversationsState.status === "rejected") {
          throw connectionsState.reason || conversationsState.reason;
        }
        const connections = connectionsState.status === "fulfilled"
          ? connectionsState.value || []
          : [];
        const conversations = conversationsState.status === "fulfilled"
          ? conversationsState.value || []
          : [];
        const students = studentsState.status === "fulfilled"
          ? studentsState.value || []
          : [];
        const mentorAccess = mentorAccessState.status === "fulfilled"
          ? mentorAccessState.value || []
          : [];
        const paymentClaims = claimsState.status === "fulfilled"
          ? claimsState.value || []
          : [];
        if (connectionsState.status === "rejected") {
          feedback.textContent = `好友列表暂未更新：${socialError(connectionsState.reason)}`;
        } else if (conversationsState.status === "rejected") {
          feedback.textContent = `最近会话暂未更新：${socialError(conversationsState.reason)}`;
        }
        const accepted = connections.filter(item => item.status === "accepted");
        const pending = connections.filter(item => item.status === "pending");
        socialOverview.classList.remove("is-loading");
        const overviewValues = [accepted.length, conversations.length, pending.length];
        Array.from(socialOverview.children).forEach((item, index) => {
          item.querySelector("strong").textContent = String(overviewValues[index] || 0);
        });
        const sidebarTop = element("div", "member-chat-sidebar-top");
        const sidebarTopRow = element("div", "member-chat-sidebar-titlebar");
        const friendSearchPanel = element("section", "member-add-friend-panel");
        friendSearchPanel.hidden = true;
        const uidSearch = element("form", "member-add-friend-form");
        const uidInput = element("input");
        uidInput.inputMode = "numeric";
        uidInput.pattern = "[0-9]{5,6}";
        uidInput.maxLength = 6;
        uidInput.placeholder = "输入 5 至 6 位 UID";
        uidInput.setAttribute("aria-label", "输入好友 UID");
        uidInput.value = route.uid || "";
        const uidSubmit = button("查找", "btn btn-primary member-add-friend-submit");
        uidSubmit.type = "submit";
        const uidResult = element("div", "member-add-friend-result");
        const uidFeedback = element("p", "member-add-friend-feedback");
        uidSearch.append(uidInput, uidSubmit);
        friendSearchPanel.append(
          element("p", "member-add-friend-hint", "输入对方 UID，找到后可直接发送好友请求。"),
          uidSearch,
          uidFeedback,
          uidResult
        );
        let newFriendRow = null;
        function setFriendSearchPanel(open) {
          const visible = Boolean(open);
          friendSearchPanel.hidden = !visible;
          if (newFriendRow) {
            newFriendRow.classList.toggle("is-active", visible);
            newFriendRow.setAttribute("aria-expanded", String(visible));
          }
          if (visible) uidInput.focus({preventScroll: true});
        }
        if (messengerFriendWindow && messengerFriendWindow.panel === windowPanel) {
          messengerFriendWindow.openFriendSearch = uid => {
            if (uid) uidInput.value = String(uid);
            setFriendSearchPanel(true);
          };
        }
        async function searchUid() {
          const uid = uidInput.value.trim();
          uidResult.replaceChildren();
          if (!/^\d{5,6}$/.test(uid)) {
            uidFeedback.textContent = "请输入 5 至 6 位数字 UID。";
            return;
          }
          uidSubmit.disabled = true;
          uidFeedback.textContent = "正在查找…";
          try {
            const rows = await repository.searchByUid(uid);
            const profile = Array.isArray(rows) ? rows[0] : rows;
            if (!profile) {
              uidFeedback.textContent = "没有找到这个 UID。";
              return;
            }
            uidFeedback.textContent = "";
            const connection = profile.id === actor.id
              ? {status: "self"}
              : connections.find(item => item.other_id === profile.id);
            uidResult.appendChild(socialProfileCard(profile, connection, {
              compact: true,
              refresh: () => renderMessages({...route, openFriendSearch: true, uid})
            }));
          } catch (error) {
            uidFeedback.textContent = socialError(error);
          } finally {
            uidSubmit.disabled = false;
          }
        }
        uidSearch.addEventListener("submit", event => {
          event.preventDefault();
          searchUid();
        });
        const contactSearch = element("input", "member-chat-sidebar-search");
        contactSearch.type = "search";
        contactSearch.placeholder = "搜索好友 / UID";
        contactSearch.setAttribute("aria-label", "搜索好友或 UID");
        const contactLists = [];
        function searchContacts() {
          const needle = contactSearch.value.trim().toLowerCase();
          contactLists.flatMap(list => Array.from(list.children)).forEach(item => {
            const haystack = String(item.dataset.search || "").toLowerCase();
            item.hidden = Boolean(needle && !haystack.includes(needle));
          });
        }
        contactSearch.addEventListener("input", searchContacts);
        const unreadTotal = conversations.reduce((total, item) => total + Number(item.unread_count || 0), 0);
        const submittedClaims = paymentClaims.filter(item => item.status === "submitted");
        // Friend requests live exclusively in “新朋友”. Keep the general
        // notification center for unread conversations and mentor payments.
        const notificationTotal = unreadTotal + submittedClaims.length;
        const utilityList = element("div", "member-chat-utility-list");
        newFriendRow = button("", "member-chat-utility-row");
        newFriendRow.setAttribute("aria-expanded", "false");
        newFriendRow.append(
          element("span", "member-chat-utility-icon", "+"),
          element("span", "member-chat-utility-label", "新朋友"),
          element("span", "member-chat-utility-count", pending.length ? String(pending.length) : "")
        );
        newFriendRow.addEventListener("click", () => {
          setNotificationCenter(false);
          setFriendSearchPanel(friendSearchPanel.hidden);
        });
        const notificationRow = button("", "member-chat-utility-row");
        notificationRow.append(
          element("span", "member-chat-utility-icon", "•"),
          element("span", "member-chat-utility-label", "消息通知"),
          element("span", "member-chat-utility-count", notificationTotal ? String(notificationTotal) : "")
        );
        notificationRow.setAttribute("aria-expanded", "false");
        const mentorNotifications = element("section", "member-mentor-payment-notifications");
        mentorNotifications.hidden = true;
        if (!paymentClaims.length) {
          mentorNotifications.appendChild(element("p", "member-chat-list-empty", "暂无新的站内通知"));
        } else {
          paymentClaims.forEach(claim => {
            const item = element("article", `member-mentor-payment-notice is-${claim.status}`);
            const copy = element("div", "member-mentor-payment-copy");
            copy.append(
              element("strong", "", `${claim.display_name || "用户"} 已提交付款确认`),
              element("span", "", `${claim.offer_name || "辅导服务"} · ${(Number(claim.amount_cents || 0) / 100).toFixed(2)} USDT`),
              element("small", "", claim.buyer_note || `付款方式：${claim.payment_label || "线下转账"}`)
            );
            item.appendChild(copy);
            if (claim.status === "submitted") {
              const controls = element("div", "member-mentor-payment-actions");
              const reject = button("未收到", "btn btn-ghost");
              const confirm = button("确认并打开对话", "btn btn-primary");
              reject.addEventListener("click", async () => {
                reject.disabled = true;
                try {
                  await repository.reviewMentorPaymentClaim(claim.claim_id, false);
                  renderMessages(route);
                } catch (error) {
                  feedback.textContent = socialError(error);
                  reject.disabled = false;
                }
              });
              confirm.addEventListener("click", async () => {
                confirm.disabled = true;
                confirm.textContent = "正在确认…";
                try {
                  const threadId = await repository.reviewMentorPaymentClaim(claim.claim_id, true);
                  playSocialSound("received", true);
                  navigate(core.hashForRoute({kind: "member", view: "messages", mentorThreadId: threadId}));
                } catch (error) {
                  feedback.textContent = socialError(error);
                  confirm.disabled = false;
                  confirm.textContent = "确认并打开对话";
                }
              });
              controls.append(reject, confirm);
              item.appendChild(controls);
            }
            mentorNotifications.appendChild(item);
          });
        }
        utilityList.append(newFriendRow, notificationRow);
        const directoryTabs = element("div", "member-chat-directory-tabs");
        const friendTab = button("好友", "is-active");
        friendTab.setAttribute("aria-pressed", "true");
        const teacherTab = button("老师");
        teacherTab.setAttribute("aria-pressed", "false");
        const teacherNoticeCount = submittedClaims.length;
        if (teacherNoticeCount) {
          const badge = element("span", "member-chat-tab-count", String(teacherNoticeCount));
          badge.setAttribute("aria-label", `${teacherNoticeCount} 条待处理付款通知`);
          teacherTab.appendChild(badge);
        }
        directoryTabs.append(friendTab, teacherTab);
        function setDirectoryMode(mode) {
          const teachers = mode === "teachers";
          setFriendSearchPanel(false);
          notificationCenter.hidden = true;
          sidebar.classList.remove("show-notifications");
          notificationRow.classList.remove("is-active");
          notificationRow.setAttribute("aria-expanded", "false");
          friendTab.classList.toggle("is-active", !teachers);
          teacherTab.classList.toggle("is-active", teachers);
          friendTab.setAttribute("aria-pressed", String(!teachers));
          teacherTab.setAttribute("aria-pressed", String(teachers));
          sidebar.classList.toggle("show-mentor-directory", teachers);
        }
        friendTab.addEventListener("click", () => setDirectoryMode("friends"));
        teacherTab.addEventListener("click", () => setDirectoryMode("teachers"));
        sidebarTopRow.append(element("strong", "", "好友"));
        sidebarTop.append(sidebarTopRow, contactSearch, utilityList, directoryTabs, friendSearchPanel);
        sidebar.appendChild(sidebarTop);

        if (pending.length) {
          const pendingSection = element("section", "member-chat-section member-chat-request-section member-new-friend-requests");
          pendingSection.appendChild(sectionTitle("好友请求", pending.length));
          const pendingList = element("div", "member-chat-request-list");
          pending.forEach(connection => {
            pendingList.appendChild(socialProfileCard(
              connectionProfile(connection),
              connection,
              {compact: true, refresh: () => renderMessages(route)}
            ));
          });
          pendingSection.appendChild(pendingList);
          friendSearchPanel.appendChild(pendingSection);
        }

        const recentSection = element("section", "member-chat-section member-friend-directory-section member-recent-conversations");
        const recentTitle = element("div", "member-chat-section-title");
        recentTitle.append(element("strong", "", "最近会话"));
        recentSection.appendChild(recentTitle);
        const recentList = element("div", "member-chat-list");
        if (!conversations.length) {
          recentList.appendChild(element("p", "member-chat-list-empty", "暂无最近会话"));
        } else {
          conversations.forEach(conversation => {
            const conversationId = conversation.conversation_id || conversation.id;
            const profile = conversationProfile(conversation);
            const link = button("", `member-chat-contact member-conversation-card${String(conversationId) === String(route.conversationId || "") ? " is-active" : ""}`);
            link.setAttribute("aria-label", `打开与${profile.display_name || "该好友"}的会话`);
            link.dataset.userId = String(profile.id || "");
            link.dataset.search = [profile.display_name, profile.public_uid, conversation.last_message].filter(Boolean).join(" ");
            link.appendChild(contactContent(
              profile,
              conversation.last_message || "你们已经是好友，发条消息吧"
            ));
            const timeText = conversationTime(conversation.last_message_at);
            if (timeText) link.appendChild(element("time", "member-chat-contact-time", timeText));
            const unreadCount = Number(conversation.unread_count || 0);
            if (
              unreadCount > 0 &&
              String(conversationId) !== String(route.conversationId || "")
            ) {
              const unread = element(
                "span",
                "member-chat-unread",
                unreadCount > 99 ? "99+" : String(unreadCount)
              );
              unread.setAttribute("aria-label", `${unreadCount} 条未读消息`);
              link.appendChild(unread);
            }
            link.addEventListener("click", () => openDesktopChatWindow(conversationId, profile));
            link.addEventListener("dblclick", () => openDesktopChatWindow(conversationId, profile));
            recentList.appendChild(link);
          });
        }
        recentSection.appendChild(recentList);
        contactLists.push(recentList);
        sidebar.appendChild(recentSection);

        const notificationCenter = element("section", "member-chat-notification-center");
        notificationCenter.hidden = true;
        const notificationHeader = element("header", "member-chat-notification-header");
        const notificationHeading = element("div", "member-chat-notification-heading");
        notificationHeading.append(
          element("strong", "", "消息通知"),
          element("span", "", notificationTotal ? `${notificationTotal} 条未处理` : "全部已读")
        );
        const closeNotifications = button("×", "member-chat-notification-close");
        closeNotifications.setAttribute("aria-label", "关闭消息通知");
        notificationHeader.append(notificationHeading, closeNotifications);
        const notificationList = element("div", "member-chat-notification-list");
        conversations.filter(item => Number(item.unread_count || 0) > 0).forEach(conversation => {
          const profile = conversationProfile(conversation);
          const conversationId = conversation.conversation_id || conversation.id;
          const link = button("", "member-chat-notification-item");
          link.appendChild(contactContent(
            profile,
            `${Number(conversation.unread_count || 0)} 条未读消息 · ${conversation.last_message || "打开会话查看"}`
          ));
          link.addEventListener("click", () => {
            setNotificationCenter(false);
            openDesktopChatWindow(conversationId, profile);
          });
          notificationList.appendChild(link);
        });
        submittedClaims.forEach(claim => {
          const item = button("", "member-chat-notification-item member-chat-payment-alert");
          item.append(
            element("strong", "", `${claim.display_name || "用户"} 已提交付款确认`),
            element("span", "", `${claim.offer_name || "辅导服务"} · ${(Number(claim.amount_cents || 0) / 100).toFixed(2)} USDT`)
          );
          item.addEventListener("click", () => setDirectoryMode("teachers"));
          notificationList.appendChild(item);
        });
        if (!notificationList.children.length) {
          notificationList.appendChild(element("p", "member-chat-notification-empty", "暂时没有新通知"));
        }
        notificationCenter.append(notificationHeader, notificationList);
        sidebar.appendChild(notificationCenter);

        function setNotificationCenter(open) {
          const visible = Boolean(open);
          notificationCenter.hidden = !visible;
          sidebar.classList.toggle("show-notifications", visible);
          notificationRow.classList.toggle("is-active", visible);
          notificationRow.setAttribute("aria-expanded", String(visible));
          if (visible) notificationCenter.scrollIntoView({block: "start"});
        }
        notificationRow.addEventListener("click", () => {
          setNotificationCenter(notificationCenter.hidden);
        });
        closeNotifications.addEventListener("click", () => setNotificationCenter(false));

        // A recent conversation is still a friend. Build the directory from the
        // union of accepted connections and conversation peers instead of
        // subtracting recent contacts from the friend count.
        const directoryFriendMap = new Map();
        accepted.forEach(connection => {
          const profile = connectionProfile(connection);
          const key = String(profile.id || profile.public_uid || "");
          if (key) directoryFriendMap.set(key, profile);
        });
        conversations.forEach(conversation => {
          const profile = conversationProfile(conversation);
          const key = String(profile.id || profile.public_uid || "");
          if (key && !directoryFriendMap.has(key)) directoryFriendMap.set(key, profile);
        });
        const directoryFriends = Array.from(directoryFriendMap.values());
        const friendSection = element("section", "member-chat-section member-friend-directory-section");
        const friendSectionTitle = element("div", "member-chat-section-title member-friend-section-title");
        friendSectionTitle.append(element("strong", "", "我的好友"));
        friendSectionTitle.classList.add("member-friend-section-title");
        friendSection.appendChild(friendSectionTitle);
        const friendList = element("div", "member-chat-list");
        if (!directoryFriends.length) {
          const empty = element("div", "member-chat-list-empty");
          empty.append(
            element("p", "", "还没有好友"),
            button("添加好友", "member-chat-inline-add")
          );
          empty.lastChild.addEventListener("click", () => newFriendRow.click());
          friendList.appendChild(empty);
        } else {
          directoryFriends.forEach(profile => {
            const contact = element("article", "member-chat-contact member-friend-row");
            contact.dataset.userId = String(profile.id || "");
            contact.dataset.search = [profile.display_name, profile.public_uid, profile.bio].filter(Boolean).join(" ");
            const home = routeLink(
              {kind: "member", view: "person", uid: profile.public_uid},
              "",
              "member-friend-profile-link"
            );
            home.setAttribute("aria-label", `查看${profile.display_name || "该好友"}的个人主页`);
            home.appendChild(contactContent(profile, profile.bio || "好友"));
            let profileNavigateTimer = 0;
            home.addEventListener("click", event => {
              event.preventDefault();
              event.stopImmediatePropagation();
              if (profileNavigateTimer && win) win.clearTimeout(profileNavigateTimer);
              profileNavigateTimer = win.setTimeout(() => {
                profileNavigateTimer = 0;
                navigate(home.hash);
              }, 240);
            }, true);
            const chat = button("聊天", "member-friend-chat-button");
            chat.addEventListener("click", () => {
              openProfileConversation(profile, chat, feedback);
            });
            contact.addEventListener("dblclick", event => {
              if (event.target.closest("button")) return;
              event.preventDefault();
              if (profileNavigateTimer && win) {
                win.clearTimeout(profileNavigateTimer);
                profileNavigateTimer = 0;
              }
              openProfileConversation(profile, chat, feedback);
            });
            contact.append(home, chat);
            friendList.appendChild(contact);
          });
        }
        friendSection.appendChild(friendList);
        contactLists.push(friendList);
        sidebar.appendChild(friendSection);

        const teacherSection = element("section", "member-chat-section member-mentor-directory-section");
        mentorNotifications.hidden = false;
        teacherSection.appendChild(mentorNotifications);

        const teacherList = element("div", "member-chat-list member-teacher-list");
        teacherSection.appendChild(sectionTitle("我的老师", mentorAccess.length));
        if (!mentorAccess.length) {
          teacherList.appendChild(element("p", "member-chat-list-empty", "尚未开通老师辅导服务"));
        } else {
          mentorAccess.forEach(access => {
            const teacher = {
              public_uid: access.mentor_public_uid,
              display_name: access.mentor_name,
              avatar_url: access.mentor_avatar_url,
              display_title: "辅导老师"
            };
            const link = doc.createElement("a");
            link.href = `#tutoring=thread&id=${encodeURIComponent(access.thread_id || "")}`;
            link.className = "member-chat-contact member-teacher-row";
            link.dataset.search = [teacher.display_name, access.status].filter(Boolean).join(" ");
            link.appendChild(contactContent(
              teacher,
              access.status === "active" ? "辅导服务进行中" : "查看历史辅导记录"
            ));
            teacherList.appendChild(link);
          });
        }
        teacherSection.appendChild(teacherList);
        contactLists.push(teacherList);

        if (students.length) {
          const studentSection = element("section", "member-student-section");
          studentSection.appendChild(sectionTitle("我的学生", students.length));
          const studentList = element("div", "member-chat-list");
          students.forEach(student => {
            const profile = {
              id: student.student_id,
              public_uid: student.public_uid,
              display_name: student.display_name,
              avatar_url: student.avatar_url,
              bio: student.bio,
              display_title: student.display_title || "辅导学员",
              nameplate_style: student.nameplate_style
            };
            const thread = routeLink(
              {kind: "member", view: "messages", mentorThreadId: student.thread_id},
              "",
              `member-chat-contact member-student-row${String(student.thread_id) === String(route.mentorThreadId || "") ? " is-active" : ""}`
            );
            thread.dataset.search = [profile.display_name, profile.public_uid, student.last_message].filter(Boolean).join(" ");
            thread.dataset.userId = String(profile.id || "");
            thread.appendChild(contactContent(profile, student.last_message || "打开辅导对话并回复"));
            const status = element("span", "member-student-status", student.access_status === "active" ? "辅导中" : "已到期");
            thread.appendChild(status);
            studentList.appendChild(thread);
          });
          studentSection.appendChild(studentList);
          contactLists.push(studentList);
          teacherSection.appendChild(studentSection);
        }
        sidebar.appendChild(teacherSection);
        setDirectoryMode(route.mentorThreadId ? "teachers" : "friends");

        if (typeof repository.subscribePresence === "function") {
          const stopPresence = repository.subscribePresence(actor.id, onlineIds => {
            let onlineFriendCount = 0;
            sidebar.querySelectorAll("[data-user-id]").forEach(contact => {
              const online = onlineIds.has(String(contact.dataset.userId || ""));
              contact.classList.toggle("is-online", online);
              if (online && contact.classList.contains("member-friend-row")) onlineFriendCount += 1;
            });
            const label = friendSectionTitle.querySelector("strong");
            if (label) label.textContent = onlineFriendCount
              ? `我的好友 · ${onlineFriendCount} 在线`
              : "我的好友";
          });
          registerMessageCleanup(stopPresence);
        }

        pane.replaceChildren();
        if (!hasActiveConversation) {
          pane.remove();
          if (route.openFriendSearch && route.uid) searchUid();
          return;
        }

        if (route.mentorThreadId) {
          const student = students.find(item => String(item.thread_id) === String(route.mentorThreadId));
          if (!student) {
            pane.appendChild(notice("辅导会话不可用", "这位学员不在你的辅导列表中，或辅导权限已经变更。"));
            return;
          }
          const studentProfile = {
            id: student.student_id,
            public_uid: student.public_uid,
            display_name: student.display_name,
            avatar_url: student.avatar_url,
            display_title: student.display_title || "辅导学员",
            nameplate_style: student.nameplate_style
          };
          const mentorHeader = element("header", "member-chat-header member-student-chat-header");
          const mentorBack = routeLink({kind: "member", view: "messages"}, "‹", "member-chat-back");
          mentorBack.setAttribute("aria-label", "返回学生列表");
          const mentorIdentity = element("div", "member-chat-header-identity");
          const mentorHome = routeLink(
            {kind: "member", view: "person", uid: studentProfile.public_uid},
            "",
            "member-chat-profile-link"
          );
          mentorHome.appendChild(profileAvatar(studentProfile, {displayName: studentProfile.display_name || "学"}));
          const mentorCopy = element("div", "member-chat-header-copy");
          const mentorName = element("div", "member-name-row");
          mentorName.append(displayNameNode(studentProfile, "辅导学员", "h2"), profileTitle(studentProfile));
          const mentorPlate = uidNameplate(studentProfile);
          if (mentorPlate) mentorName.appendChild(mentorPlate);
          mentorCopy.append(
            mentorName,
            element("span", "text-small text-muted", student.access_status === "active" ? "我的学生 · 辅导中" : "我的学生 · 辅导已到期")
          );
          mentorIdentity.append(mentorHome, mentorCopy);
          mentorHeader.append(mentorBack, mentorIdentity);

          const mentorRows = await repository.listMentorMessages(route.mentorThreadId);
          if (isStale()) return;
          const mentorStream = element("div", "member-message-stream member-mentor-message-stream");
          mentorStream.setAttribute("aria-live", "polite");
          if (!mentorRows.length) {
            mentorStream.appendChild(element("p", "member-chat-first-message", "学员还没有发送问题。"));
          } else {
            mentorRows.forEach(message => {
              const mine = message.sender_id === actor.id;
              const bubble = element("article", `member-message-bubble${mine ? " is-mine" : ""}`);
              if (!mine) bubble.appendChild(element("strong", "text-small", studentProfile.display_name || "学员"));
              bubble.append(
                element("p", "", message.body),
                element("time", "text-small text-muted", new Date(message.created_at).toLocaleString("zh-CN"))
              );
              mentorStream.appendChild(bubble);
            });
          }
          const mentorComposer = element("form", "member-message-composer member-mentor-reply-composer");
          const mentorInput = element("textarea");
          mentorInput.rows = 3;
          mentorInput.maxLength = 5000;
          mentorInput.placeholder = `回复 ${studentProfile.display_name || "学员"}`;
          const mentorSend = button("发送回复", "btn btn-primary");
          mentorSend.type = "submit";
          mentorComposer.append(mentorInput, mentorSend);
          mentorComposer.addEventListener("submit", async event => {
            event.preventDefault();
            const body = mentorInput.value.trim();
            if (!body) return;
            mentorSend.disabled = true;
            mentorInput.disabled = true;
            mentorSend.textContent = "发送中…";
            try {
              await repository.sendMentorMessage(route.mentorThreadId, body);
              playSocialSound("sent", true);
              renderMessages(route);
            } catch (error) {
              feedback.textContent = socialError(error);
              mentorSend.disabled = false;
              mentorInput.disabled = false;
              mentorSend.textContent = "发送回复";
            }
          });
          mentorInput.addEventListener("keydown", event => {
            if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
              event.preventDefault();
              mentorComposer.requestSubmit();
            }
          });
          pane.append(mentorHeader, mentorStream, mentorComposer);
          requestAnimationFrame(() => { mentorStream.scrollTop = mentorStream.scrollHeight; });
          return;
        }

        const active = conversations.find(item => (
          String(item.conversation_id || item.id) === String(route.conversationId)
          && (!route.peerId || String(item.other_id || "") === String(route.peerId))
        ));
        if (!active) {
          pane.appendChild(notice("会话不可用", "好友身份与会话不匹配。请返回好友列表重新打开，系统不会把你带到其他人的聊天框。"));
          return;
        }
        const activeProfile = conversationProfile(active);
        pane.remove();
        await openDesktopChatWindow(route.conversationId, activeProfile);
        return;
        const chatHeader = element("header", "member-chat-header");
        const back = routeLink({kind: "member", view: "messages"}, "‹", "member-chat-back");
        back.setAttribute("aria-label", "返回好友列表");
        const headerIdentity = element("div", "member-chat-header-identity");
        const headerHome = routeLink(
          {kind: "member", view: "person", uid: activeProfile.public_uid},
          "",
          "member-chat-profile-link"
        );
        headerHome.setAttribute("aria-label", `查看${activeProfile.display_name || "好友"}的个人主页`);
        headerHome.appendChild(profileAvatar(activeProfile, {displayName: activeProfile.display_name || "研"}));
        headerIdentity.appendChild(headerHome);
        const headerCopy = element("div", "member-chat-header-copy");
        const headerName = element("div", "member-name-row");
        headerName.append(displayNameNode(activeProfile, "波浪研究者", "h2"), profileTitle(activeProfile));
        const headerPlate = uidNameplate(activeProfile);
        if (headerPlate) headerName.appendChild(headerPlate);
        headerCopy.append(headerName, element("span", "text-small text-muted", "好友 · 私密会话"));
        headerIdentity.appendChild(headerCopy);
        chatHeader.append(back, headerIdentity);

        const messages = await repository.listMessages(route.conversationId);
        if (isStale()) return;
        const stream = element("div", "member-message-stream");
        stream.setAttribute("aria-live", "polite");
        let lastMessageKey = "";
        let lastMarkedMessageId = 0;
        function renderMessageRows(rows, options = {}) {
          const wasNearBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 96;
          const nextRows = rows || [];
          stream.replaceChildren();
          if (!nextRows.length) {
            stream.appendChild(element("p", "member-chat-first-message", "你们已经是好友，发送第一条消息吧。"));
          } else {
            nextRows.forEach(message => {
            const mine = message.sender_id === actor.id;
            const bubble = element(
              "article",
              `member-message-bubble${mine ? " is-mine" : ""}`
            );
            const sticker = stickerFromBody(message.body);
            const customSticker = customStickerFromBody(message.body);
            let bodyNode;
            if (sticker) {
              bodyNode = element("div", "member-message-sticker", sticker.glyph);
              bodyNode.setAttribute("aria-label", sticker.label);
            } else if (customSticker && typeof repository.chatStickerPublicUrl === "function") {
              bodyNode = element("div", "member-message-custom-sticker");
              const image = element("img", "member-message-sticker-image");
              image.src = repository.chatStickerPublicUrl(customSticker.storage_path);
              image.alt = customSticker.label;
              image.loading = "lazy";
              image.decoding = "async";
              image.referrerPolicy = "no-referrer";
              image.addEventListener("error", () => {
                bodyNode.replaceChildren(element("span", "text-small text-muted", "表情图片暂时无法显示"));
              }, {once: true});
              bodyNode.appendChild(image);
            } else {
              bodyNode = element("p", "", message.body);
            }
            if (!mine) bubble.appendChild(element("strong", "text-small", message.display_name || "研究者"));
            bubble.append(
              bodyNode,
              element("time", "member-message-time", messageTime(message.created_at))
            );
            stream.appendChild(bubble);
            });
          }
          const newest = nextRows[nextRows.length - 1];
          lastMessageKey = newest
            ? `${newest.id || ""}:${newest.created_at || ""}:${nextRows.length}`
            : "empty";
          const newestId = Number(newest && newest.id || 0);
          if (
            newestId > lastMarkedMessageId &&
            doc.visibilityState !== "hidden" &&
            typeof repository.markConversationRead === "function"
          ) {
            lastMarkedMessageId = newestId;
            Promise.resolve(repository.markConversationRead(route.conversationId, newestId))
              .catch(() => {
                lastMarkedMessageId = 0;
              });
          }
          if (options.forceScroll || wasNearBottom) {
            requestAnimationFrame(() => {
              stream.scrollTop = stream.scrollHeight;
            });
          }
        }
        renderMessageRows(messages, {forceScroll: true});
        const composer = element("form", "member-message-composer");
        const inputWrap = element("div", "member-message-input-wrap");
        const messageInput = element("textarea");
        messageInput.rows = 3;
        messageInput.maxLength = 4000;
        messageInput.placeholder = `发消息给 ${activeProfile.display_name || "好友"}`;
        const composerTools = element("div", "member-message-tools");
        const pendingStickerPreview = element("div", "member-pending-sticker-preview");
        pendingStickerPreview.hidden = true;
        let pendingStickerBody = "";
        function clearPendingSticker() {
          pendingStickerBody = "";
          pendingStickerPreview.hidden = true;
          pendingStickerPreview.replaceChildren();
        }
        function stageSticker(body, previewNode, label) {
          pendingStickerBody = body;
          messageInput.value = "";
          const remove = button("×", "member-pending-sticker-remove");
          remove.type = "button";
          remove.setAttribute("aria-label", `移除待发送的${label || "表情"}`);
          remove.addEventListener("click", () => {
            clearPendingSticker();
            messageInput.focus({preventScroll: true});
          });
          pendingStickerPreview.replaceChildren(previewNode, element("span", "", `已选择${label || "表情"}`), remove);
          pendingStickerPreview.hidden = false;
          setStickerPanel(false);
          send.focus({preventScroll: true});
        }
        const stickerToggle = button("表情", "member-sticker-toggle");
        stickerToggle.setAttribute("aria-expanded", "false");
        stickerToggle.setAttribute("aria-label", "打开表情面板");
        const stickerPanel = element("div", "member-sticker-panel");
        stickerPanel.hidden = true;
        const quickStickerSection = element("section", "member-sticker-section");
        const quickStickerHeader = element("div", "member-sticker-panel-header");
        const closeStickerPanelButton = button("×", "member-sticker-panel-close");
        closeStickerPanelButton.setAttribute("aria-label", "关闭表情面板");
        quickStickerHeader.append(
          element("strong", "member-sticker-section-title", "快捷表情"),
          closeStickerPanelButton
        );
        quickStickerSection.appendChild(quickStickerHeader);
        const quickStickerGrid = element("div", "member-sticker-grid");
        stickerCatalog.forEach(sticker => {
          const item = button(sticker.glyph, "member-sticker-option");
          item.title = sticker.label;
          item.setAttribute("aria-label", `选择${sticker.label}表情`);
          item.dataset.sticker = sticker.id;
          quickStickerGrid.appendChild(item);
        });
        quickStickerSection.appendChild(quickStickerGrid);

        const customStickerSection = element("section", "member-sticker-section member-custom-sticker-section");
        const customStickerHead = element("div", "member-custom-sticker-head");
        const customStickerTitle = element("div");
        customStickerTitle.append(
          element("strong", "member-sticker-section-title", "我的表情"),
          element("span", "text-small text-muted", "支持动态 GIF、WebP 和静态 PNG、JPEG")
        );
        const uploadStickerButton = button("上传表情", "member-sticker-upload-button");
        const stickerFileInput = element("input", "member-sticker-file-input");
        stickerFileInput.type = "file";
        stickerFileInput.accept = "image/png,image/jpeg,image/gif,image/webp";
        stickerFileInput.multiple = true;
        stickerFileInput.hidden = true;
        const customStickerGrid = element("div", "member-custom-sticker-grid");
        const customStickerStatus = element("p", "text-small text-muted member-sticker-status", "正在读取我的表情…");
        const customStickerMap = new Map();
        customStickerHead.append(customStickerTitle, uploadStickerButton, stickerFileInput);
        customStickerSection.append(customStickerHead, customStickerGrid, customStickerStatus);
        stickerPanel.append(quickStickerSection, customStickerSection);

        async function loadCustomStickers() {
          customStickerGrid.replaceChildren();
          customStickerMap.clear();
          if (typeof repository.listChatStickers !== "function") {
            customStickerStatus.textContent = "自定义表情服务尚未连接，快捷表情仍可使用。";
            uploadStickerButton.disabled = true;
            return;
          }
          customStickerStatus.textContent = "正在读取我的表情…";
          try {
            const rows = await repository.listChatStickers(actor.id);
            const stickers = Array.isArray(rows) ? rows : [];
            stickers.forEach(sticker => {
              customStickerMap.set(String(sticker.id), sticker);
              const card = element("article", "member-custom-sticker-card");
              const sendSticker = button("", "member-custom-sticker-send");
              sendSticker.dataset.customSticker = String(sticker.id);
              sendSticker.setAttribute("aria-label", `选择${sticker.label || "自定义"}表情`);
              const image = element("img", "member-custom-sticker-thumb");
              image.src = repository.chatStickerPublicUrl(sticker.storage_path);
              image.alt = sticker.label || "自定义表情";
              image.loading = "lazy";
              image.decoding = "async";
              const remove = button("移除", "member-custom-sticker-remove");
              remove.dataset.removeCustomSticker = String(sticker.id);
              remove.setAttribute("aria-label", `移除${sticker.label || "自定义"}表情`);
              sendSticker.appendChild(image);
              card.append(sendSticker, remove);
              customStickerGrid.appendChild(card);
            });
            customStickerStatus.textContent = stickers.length
              ? `已添加 ${stickers.length} 个表情`
              : "还没有自定义表情，可从设备上传。";
          } catch (error) {
            customStickerStatus.textContent = `自定义表情暂不可用：${socialError(error)}`;
          }
        }

        uploadStickerButton.addEventListener("click", () => stickerFileInput.click());
        stickerFileInput.addEventListener("change", async () => {
          const files = Array.from(stickerFileInput.files || []);
          stickerFileInput.value = "";
          if (!files.length) return;
          const invalid = files.map(file => ({file, validation: validateCustomStickerFile(file)}))
            .find(item => !item.validation.ok);
          if (invalid) {
            customStickerStatus.textContent = `${invalid.file.name || "所选文件"}：${invalid.validation.error}`;
            return;
          }
          uploadStickerButton.disabled = true;
          uploadStickerButton.textContent = "上传中…";
          customStickerStatus.textContent = `正在添加 ${files.length} 个表情…`;
          try {
            for (const file of files) {
              const mimeType = resolvedCustomStickerMime(file);
              const uploadFile = file.type === mimeType
                ? file
                : new File([file], file.name || "自定义表情", {type: mimeType, lastModified: file.lastModified || Date.now()});
              await repository.uploadChatSticker(actor.id, uploadFile);
            }
            customStickerStatus.textContent = `${files.length} 个表情已添加。`;
            await loadCustomStickers();
          } catch (error) {
            customStickerStatus.textContent = `上传失败：${socialError(error)}`;
          } finally {
            uploadStickerButton.disabled = false;
            uploadStickerButton.textContent = "上传表情";
          }
        });
        function setStickerPanel(open) {
          const visible = Boolean(open);
          stickerPanel.hidden = !visible;
          stickerToggle.classList.toggle("is-active", visible);
          stickerToggle.setAttribute("aria-expanded", String(visible));
          stickerToggle.setAttribute("aria-label", visible ? "关闭表情面板" : "打开表情面板");
        }
        stickerToggle.addEventListener("click", event => {
          event.stopPropagation();
          setStickerPanel(stickerPanel.hidden);
        });
        closeStickerPanelButton.addEventListener("click", () => setStickerPanel(false));
        const dismissStickerPanel = event => {
          if (stickerPanel.hidden) return;
          if (event.type === "keydown" && event.key !== "Escape") return;
          if (event.type !== "keydown" && (stickerPanel.contains(event.target) || stickerToggle.contains(event.target))) return;
          setStickerPanel(false);
        };
        doc.addEventListener("pointerdown", dismissStickerPanel);
        doc.addEventListener("keydown", dismissStickerPanel);
        registerMessageCleanup(() => {
          doc.removeEventListener("pointerdown", dismissStickerPanel);
          doc.removeEventListener("keydown", dismissStickerPanel);
        });
        composerTools.append(stickerToggle, element("span", "text-small text-muted", "Enter 发送，Shift + Enter 换行"));
        inputWrap.append(messageInput, pendingStickerPreview, composerTools, stickerPanel);
        const send = button("发送", "btn btn-primary");
        send.type = "submit";
        composer.append(inputWrap, send);
        let sending = false;
        composer.addEventListener("submit", async event => {
          event.preventDefault();
          const body = pendingStickerBody || messageInput.value.trim();
          if (!body || sending) return;
          sending = true;
          send.disabled = true;
          messageInput.disabled = true;
          send.textContent = "发送中…";
          try {
            await repository.sendMessage(route.conversationId, body);
            playSocialSound("sent", true);
            renderMessages(route);
          } catch (error) {
            feedback.textContent = socialError(error);
            sending = false;
            send.disabled = false;
            messageInput.disabled = false;
            send.textContent = "发送";
            messageInput.focus({preventScroll: true});
          }
        });
        messageInput.addEventListener("keydown", event => {
          if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            composer.requestSubmit();
          }
        });
        messageInput.addEventListener("input", () => {
          if (messageInput.value && pendingStickerBody) clearPendingSticker();
        });
        stickerPanel.addEventListener("click", event => {
          const option = event.target.closest("[data-sticker]");
          if (!option || sending) return;
          const sticker = stickerCatalog.find(item => item.id === option.dataset.sticker);
          if (!sticker) return;
          const preview = element("span", "member-pending-sticker-glyph", sticker.glyph);
          stageSticker(`[[sticker:${sticker.id}]]`, preview, sticker.label);
        });
        customStickerGrid.addEventListener("click", async event => {
          const remove = event.target.closest("[data-remove-custom-sticker]");
          if (remove) {
            const sticker = customStickerMap.get(remove.dataset.removeCustomSticker);
            if (!sticker || !win || !win.confirm("从我的表情中移除这张图片？")) return;
            remove.disabled = true;
            customStickerStatus.textContent = "正在移除…";
            try {
              await repository.deleteChatSticker(sticker);
              await loadCustomStickers();
            } catch (error) {
              remove.disabled = false;
              customStickerStatus.textContent = `移除失败：${socialError(error)}`;
            }
            return;
          }
          const option = event.target.closest("[data-custom-sticker]");
          if (!option || sending) return;
          const sticker = customStickerMap.get(option.dataset.customSticker);
          if (!sticker) return;
          const preview = element("img", "member-pending-sticker-image");
          preview.src = repository.chatStickerPublicUrl(sticker.storage_path);
          preview.alt = sticker.label || "自定义表情";
          stageSticker(customStickerToken(sticker), preview, sticker.label || "自定义表情");
        });
        loadCustomStickers();
        pane.append(chatHeader, stream, composer);
        requestAnimationFrame(() => {
          stream.scrollTop = stream.scrollHeight;
          if (!win || !win.matchMedia("(max-width: 760px)").matches) {
            messageInput.focus({preventScroll: true});
          }
        });

        let disposed = false;
        let pollTimer = 0;
        let pollInFlight = false;
        function clearPollTimer() {
          if (pollTimer && win) win.clearTimeout(pollTimer);
          pollTimer = 0;
        }
        function canPoll() {
          return !disposed && doc.visibilityState !== "hidden" && (!win || win.navigator.onLine !== false);
        }
        function schedulePoll(delay = 8000) {
          clearPollTimer();
          if (!win || !canPoll()) return;
          pollTimer = win.setTimeout(pollMessages, delay);
        }
        async function pollMessages() {
          if (!canPoll() || pollInFlight) {
            schedulePoll();
            return;
          }
          pollInFlight = true;
          try {
            const rows = await repository.listMessages(route.conversationId);
            if (disposed || isStale()) return;
            const newest = rows && rows[rows.length - 1];
            const nextKey = newest
              ? `${newest.id || ""}:${newest.created_at || ""}:${rows.length}`
              : "empty";
            if (nextKey !== lastMessageKey) {
              if (newest && newest.sender_id !== actor.id && lastMessageKey) {
                playSocialSound("received");
              }
              renderMessageRows(rows);
            }
          } catch (error) {
            if (!disposed) feedback.textContent = `自动同步暂缓：${socialError(error)}`;
          } finally {
            pollInFlight = false;
            schedulePoll();
          }
        }
        function resumePolling() {
          clearPollTimer();
          if (canPoll()) schedulePoll(450);
        }
        if (win) win.addEventListener("online", resumePolling);
        doc.addEventListener("visibilitychange", resumePolling);
        registerMessageCleanup(() => {
          disposed = true;
          clearPollTimer();
          if (win) win.removeEventListener("online", resumePolling);
          doc.removeEventListener("visibilitychange", resumePolling);
        });
        schedulePoll();
      } catch (error) {
        if (isStale()) return;
        feedback.textContent = socialError(error);
        pane.replaceChildren(notice("会话暂不可用", socialError(error)));
      }
    }

    function rewardActionLabel(action) {
      return {
        daily_checkin: "每日签到",
        review_saved: "完成复盘",
        post_published: "发布研究内容",
        product_redeemed: "商城兑换"
      }[action] || "积分变动";
    }

    async function renderRewards() {
      const actor = requireActor();
      if (!actor) return;
      const sequence = ++renderSequence;
      setBreadcrumb([
        {label: "个人空间", route: {kind: "member", view: "home"}},
        {label: "积分商城"}
      ]);
      contentHost.replaceChildren(notice("正在打开积分商城", "正在读取积分、任务与可兑换权益。"));
      try {
        const [center, leaderboard] = await Promise.all([
          repository.getRewardCenter(),
          typeof repository.listRewardLeaderboard === "function"
            ? repository.listRewardLeaderboard(20).catch(() => [])
            : Promise.resolve([])
        ]);
        if (sequence !== renderSequence) return;
        const wallet = center && center.wallet || {};
        const products = Array.isArray(center && center.products) ? center.products : [];
        const nameplates = Array.isArray(center && center.nameplates) ? center.nameplates : [];
        const ledger = Array.isArray(center && center.ledger) ? center.ledger : [];
        const page = element("div", "member-rewards-page");
        const hero = element("section", "member-rewards-hero is-dark-surface");
        const heroCopy = element("div", "member-rewards-hero-copy");
        heroCopy.append(
          element("p", "member-eyebrow", "积分权益"),
          element("h1", "", "把认真研究，积累成长期权益"),
          element("p", "text-muted", "签到、完成复盘和发布可核验思路都会进入积分账本。每个动作只奖励一次。")
        );
        const balance = element("div", "member-reward-balance-card");
        const balanceTop = element("div", "member-reward-balance-top");
        balanceTop.append(uiIcon("coin", "member-reward-balance-icon"), element("span", "", "可用积分"));
        balance.append(
          balanceTop,
          element("strong", "member-reward-balance-value", formatPoints(wallet.balance)),
          element("span", "member-reward-lifetime", `累计获得 ${formatPoints(wallet.lifetime_earned)} 积分`)
        );
        const checkin = button(center.checked_today ? "今日已签到" : "立即签到", "btn member-checkin-button");
        checkin.disabled = Boolean(center.checked_today);
        checkin.prepend(uiIcon(center.checked_today ? "check" : "calendar"));
        const streak = element("span", "member-checkin-streak", `连续 ${Number(center.streak || 0)} 天`);
        const checkinStatus = element("p", "member-checkin-status");
        checkinStatus.setAttribute("role", "status");
        balance.append(checkin, streak, checkinStatus);
        checkin.addEventListener("click", async () => {
          checkin.disabled = true;
          checkin.lastChild.textContent = "签到中";
          try {
            const result = await repository.dailyCheckIn();
            playSocialSound("friend", true);
            checkinStatus.textContent = `签到成功，获得 ${Number(result.points || 0)} 积分。`;
            win.setTimeout(() => renderRewards(), 560);
          } catch (error) {
            checkinStatus.textContent = socialError(error);
            checkin.disabled = false;
            checkin.lastChild.textContent = "重新签到";
          }
        });
        hero.append(heroCopy, balance);

        const leaderboardSection = element("section", "member-reward-section member-leaderboard-section");
        const leaderboardHead = element("header", "member-reward-section-head");
        leaderboardHead.appendChild(element("div", ""));
        leaderboardHead.firstChild.append(
          element("h2", "", "积分排行榜")
        );
        const leaderboardList = element("div", "member-leaderboard-list");
        if (!Array.isArray(leaderboard) || !leaderboard.length) {
          leaderboardList.appendChild(notice("还没有排行数据", "完成签到、复盘或发布可核验内容后，积分排行会在这里更新。"));
        } else {
          leaderboard.forEach((row, index) => {
            const profile = {
              id: row.user_id,
              public_uid: row.public_uid,
              display_name: row.display_name,
              avatar_url: row.avatar_url,
              display_title: row.display_title,
              nameplate_style: row.nameplate_style
            };
            const item = routeLink(
              {kind: "member", view: "person", uid: row.public_uid},
              "",
              `member-leaderboard-row${index < 3 ? ` is-top-${index + 1}` : ""}`
            );
            const rank = element("strong", "member-leaderboard-rank", String(row.rank_no || index + 1));
            const identity = element("span", "member-leaderboard-identity");
            identity.appendChild(profileAvatar(profile, {displayName: row.display_name || "研"}));
            const copy = element("span", "member-leaderboard-copy");
            const name = element("span", "member-leaderboard-name");
            name.appendChild(displayNameNode(profile, "波浪研究者", "strong"));
            const plate = uidNameplate(profile);
            if (plate) name.appendChild(plate);
            copy.append(name, element("span", "text-small text-muted", row.display_title || "波浪研究者"));
            identity.appendChild(copy);
            const points = element("span", "member-leaderboard-points");
            points.append(
              element("strong", "", formatPoints(row.lifetime_earned)),
              element("span", "text-small text-muted", "累计积分")
            );
            item.append(rank, identity, points);
            leaderboardList.appendChild(item);
          });
        }
        leaderboardSection.append(leaderboardHead, leaderboardList);

        const missionSection = element("section", "member-reward-section");
        const missionHead = element("header", "member-reward-section-head");
        missionHead.append(
          element("div", "", ""),
          routeLink({kind: "member-entry", entryId: "new-review"}, "去写复盘", "member-reward-section-link")
        );
        missionHead.firstChild.append(element("p", "member-eyebrow", "成长任务"), element("h2", "", "今天也留下可复查的证据"));
        const missions = element("div", "member-mission-grid");
        [
          ["calendar", "每日签到", center.checked_today ? "今日已完成" : "每天一次", "+5～11", center.checked_today],
          ["chart", "完成复盘", "首次保存一篇复盘", "+20", false],
          ["pen", "发表思路", "发布一篇思路分享", "+12", false],
          ["sparkles", "提交案例", "发布一篇图表案例", "+15", false]
        ].forEach(([iconName, title, copy, points, done]) => {
          const card = element("article", `member-mission-card${done ? " is-complete" : ""}`);
          const mark = element("span", "member-mission-icon");
          mark.appendChild(uiIcon(iconName));
          card.append(
            mark,
            element("strong", "", title),
            element("span", "text-small text-muted", copy),
            element("b", "member-mission-points", points)
          );
          missions.appendChild(card);
        });
        missionSection.append(missionHead, missions);

        const storeSection = element("section", "member-reward-section");
        const storeHead = element("header", "member-reward-section-head");
        storeHead.appendChild(element("div", ""));
        storeHead.firstChild.append(
          element("p", "member-eyebrow", "积分商城"),
          element("h2", "", "兑换你的研究身份与专属权益")
        );
        const storeGrid = element("div", "member-reward-product-grid");
        if (!products.length) {
          storeGrid.appendChild(notice("商品准备中", "管理员上架商品后会显示在这里。"));
        } else {
          products.forEach(product => {
            const card = element("article", `member-reward-product is-${product.product_type || "digital"}`);
            const visual = element("div", "member-reward-product-visual");
            const productMetadata = product.metadata && typeof product.metadata === "object" ? product.metadata : {};
            const productStyle = String(productMetadata.nameplate_style || "classic");
            const entitlement = nameplates.find(item => String(item.product_id) === String(product.id));
            if (product.image_url) {
              const image = element("img");
              image.src = product.image_url;
              image.alt = product.name || "积分商品";
              image.loading = "lazy";
              visual.appendChild(image);
            } else if (product.product_type === "nameplate") {
              const platePreview = uidNameplate({
                public_uid: actor.publicUid || actor.public_uid || 88888,
                nameplate_style: productStyle
              });
              if (platePreview) visual.appendChild(platePreview);
            } else {
              visual.append(uiIcon(product.product_type === "service" ? "users" : "sparkles"));
            }
            const category = element("span", "member-reward-product-category", {
              identity: "身份装扮", digital: "数字权益", service: "服务权益", physical: "实体商品"
            }[product.category] || "积分权益");
            const copy = element("div", "member-reward-product-copy");
            copy.append(
              category,
              element("h3", "", product.name || "积分商品"),
              element("p", "text-muted", product.summary || product.description || "使用积分兑换。")
            );
            const footer = element("footer", "member-reward-product-footer");
            const price = element("strong", "member-reward-price");
            price.append(uiIcon("coin"), doc.createTextNode(formatPoints(product.price_points)));
            const redeem = button("立即兑换", "btn btn-primary member-reward-redeem");
            const unavailable = Number(product.stock || 0) === 0;
            if (entitlement && entitlement.equipped) {
              redeem.textContent = "已佩戴";
              redeem.disabled = true;
              card.classList.add("is-owned", "is-equipped");
            } else if (entitlement) {
              redeem.textContent = "已拥有";
              redeem.disabled = true;
              redeem.title = "请在编辑个人资料中切换佩戴";
              card.classList.add("is-owned");
            } else {
              redeem.disabled = unavailable || Number(wallet.balance || 0) < Number(product.price_points || 0);
              if (unavailable) redeem.textContent = "暂时缺货";
              else if (redeem.disabled) redeem.textContent = "积分不足";
            }
            redeem.addEventListener("click", async () => {
              if (!win.confirm(`确认使用 ${formatPoints(product.price_points)} 积分兑换“${product.name}”？`)) return;
              redeem.disabled = true;
              redeem.textContent = "兑换中";
              try {
                const result = await repository.redeemRewardProduct(product.id, 1);
                playSocialSound("friend", true);
                win.alert(result.status === "fulfilled" ? "兑换成功，权益已经生效。" : "兑换申请已提交，请等待管理员处理。 ");
                renderRewards();
              } catch (error) {
                win.alert(socialError(error));
                redeem.disabled = false;
                redeem.textContent = "重新兑换";
              }
            });
            footer.append(price, redeem);
            card.append(visual, copy, footer);
            storeGrid.appendChild(card);
          });
        }
        storeSection.append(storeHead, storeGrid);

        const ledgerSection = element("section", "member-reward-section member-reward-ledger-section");
        const ledgerHead = element("header", "member-reward-section-head");
        ledgerHead.appendChild(element("div", ""));
        ledgerHead.firstChild.append(element("p", "member-eyebrow", "积分账本"), element("h2", "", "每一分都有来源"));
        const ledgerList = element("div", "member-reward-ledger");
        if (!ledger.length) {
          ledgerList.appendChild(element("p", "text-muted", "完成第一次签到或复盘后，积分记录会出现在这里。"));
        } else {
          ledger.forEach(row => {
            const item = element("article", "member-reward-ledger-row");
            const mark = element("span", `member-ledger-mark${Number(row.points) < 0 ? " is-spend" : ""}`);
            mark.appendChild(uiIcon(Number(row.points) < 0 ? "arrow" : "coin"));
            const copy = element("div", "");
            copy.append(
              element("strong", "", rewardActionLabel(row.action_key)),
              element("span", "text-small text-muted", row.note || new Date(row.created_at).toLocaleString("zh-CN"))
            );
            item.append(
              mark,
              copy,
              element("b", Number(row.points) < 0 ? "is-spend" : "is-earn", `${Number(row.points) > 0 ? "+" : ""}${row.points}`)
            );
            ledgerList.appendChild(item);
          });
        }
        ledgerSection.append(ledgerHead, ledgerList);
        page.append(hero, leaderboardSection, missionSection, storeSection, ledgerSection);
        contentHost.replaceChildren(page);
      } catch (error) {
        contentHost.replaceChildren(notice(
          "积分服务尚未启用",
          `${socialError(error)} 请先部署积分商城数据库迁移。`
        ));
      }
    }

    async function renderProfile() {
      const actor = requireActor();
      if (!actor) return;
      const sequence = ++renderSequence;
      setBreadcrumb([
        {label: "个人空间", route: {kind: "member", view: "home"}},
        {label: "编辑资料"}
      ]);
      contentHost.replaceChildren(notice("正在读取", "正在读取个人资料。"));
      try {
        const [profile, rewardCenter] = await Promise.all([
          repository.getMyProfile(actor.id),
          repository.getRewardCenter().catch(() => ({nameplates: []}))
        ]);
        if (sequence !== renderSequence) return;
        const nameplates = Array.isArray(rewardCenter && rewardCenter.nameplates)
          ? rewardCenter.nameplates
          : [];
        const form = element("form", "member-editor member-profile-form");
        const heading = element("header", "member-profile-editor-heading");
        heading.append(
          element("p", "member-eyebrow", "个人名片"),
          element("h1", "", "打造你的研究身份"),
          element("p", "text-muted", "头像、背景、昵称与签名会同步显示在个人空间、好友列表和私密会话中。")
        );
        const workspace = element("div", "member-profile-editor-layout");
        const previewColumn = element("aside", "member-profile-preview-column");
        previewColumn.append(
          element("span", "member-profile-preview-label", "实时预览")
        );
        const profilePreview = element(
          "section",
          `member-profile-preview cover-${profile.cover_style || "chart-dark"}`
        );
        if (profile.cover_url) {
          profilePreview.style.setProperty(
            "--member-cover-image",
            `url("${profile.cover_url.replace(/["\\]/g, "")}")`
          );
          profilePreview.classList.add("has-cover-image");
        }
        const previewCopy = element("div", "member-profile-preview-copy");
        const previewName = element("div", "member-name-row");
        const previewDisplayName = displayNameNode(profile, actor.displayName, "strong");
        previewName.append(previewDisplayName, profileTitle(profile));
        let previewPlate = uidNameplate(profile);
        if (previewPlate) previewName.appendChild(previewPlate);
        const previewSignature = element(
          "p",
          `member-profile-preview-signature is-${nameplateTheme(profile).style}`,
          profile.bio || "写一句属于你的研究签名。"
        );
        previewCopy.append(previewName, previewSignature);
        let previewAvatar = profileAvatar(profile, actor);
        profilePreview.append(previewAvatar, previewCopy);
        const previewNote = element("p", "member-profile-preview-note");
        previewNote.append(
          element("strong", "", "靓号联动"),
          doc.createTextNode(" 昵称特效由后台分配的 UID 铭牌自动决定，无需重复设置。")
        );
        const nameplateShowcase = element("section", "member-nameplate-showcase member-current-nameplate");
        const showcaseHead = element("div", "member-nameplate-showcase-head");
        showcaseHead.appendChild(element("div", "", ""));
        showcaseHead.firstChild.append(
          element("strong", "", "当前佩戴"),
          element("span", "text-small text-muted", "铭牌、昵称与头像框会保持同步")
        );
        const currentNameplateSlot = element("div", "member-current-nameplate-slot");
        let currentShowcasePlate = uidNameplate(profile);
        currentNameplateSlot.appendChild(currentShowcasePlate || element("span", "text-muted", "经典 UID"));
        nameplateShowcase.append(showcaseHead, currentNameplateSlot);
        previewColumn.append(profilePreview, nameplateShowcase, previewNote);

        const displayName = element("input");
        displayName.name = "display_name";
        displayName.value = profile.display_name || actor.displayName;
        displayName.maxLength = 40;
        displayName.autocomplete = "nickname";
        const bio = element("textarea");
        bio.name = "bio";
        bio.autocomplete = "off";
        bio.value = profile.bio || "";
        bio.rows = 4;
        bio.maxLength = 200;
        bio.placeholder = "例如：只记录可证伪的判断，不追逐无法复盘的情绪。";
        const signatureCount = element("span", "community-field-hint member-character-count");
        const signatureField = field("个性签名", bio);
        signatureField.appendChild(signatureCount);
        const markets = element("input");
        markets.name = "markets";
        markets.autocomplete = "off";
        markets.value = (profile.markets || []).join("、");
        markets.placeholder = "例如：加密、贵金属、股指";
        const timeframes = element("input");
        timeframes.name = "timeframes";
        timeframes.autocomplete = "off";
        timeframes.value = (profile.timeframes || []).join("、");
        timeframes.placeholder = "例如：日线、4小时、15分钟";
        const avatarInput = element("input");
        avatarInput.type = "file";
        avatarInput.name = "avatar";
        avatarInput.accept = "image/jpeg,image/png,image/webp";
        avatarInput.id = "member-profile-avatar";
        const coverInput = element("input");
        coverInput.type = "file";
        coverInput.name = "cover";
        coverInput.accept = "image/jpeg,image/png,image/webp";
        coverInput.id = "member-profile-cover";
        const coverField = element("div", "community-field member-profile-upload-field");
        const coverLabel = element("label", "", "自定义个人页背景");
        coverLabel.htmlFor = coverInput.id;
        coverField.append(
          coverLabel,
          element("span", "community-field-hint", "JPG、PNG 或 WebP，最大 5 MiB。建议使用横向图片。"),
          coverInput
        );
        const coverStyle = element("select");
        coverStyle.name = "cover_style";
        const coverOptions = [
          ["chart-dark", "深色行情图"],
          ["wave-blue", "波浪蓝"],
          ["paper", "研究纸张"],
          ["midnight", "午夜紫"]
        ];
        coverOptions.forEach(([value, label]) => {
          const option = element("option", "", label);
          option.value = value;
          option.selected = (profile.cover_style || "chart-dark") === value;
          coverStyle.appendChild(option);
        });
        coverStyle.className = "member-cover-style-native";
        coverStyle.setAttribute("aria-label", "背景色调");
        const coverStylePicker = element("div", "member-cover-style-picker");
        coverStylePicker.setAttribute("role", "group");
        coverStylePicker.setAttribute("aria-label", "选择背景色调");
        const styleButtons = new Map();
        coverOptions.forEach(([value, label]) => {
          const choice = button("", `member-cover-style-choice cover-${value}`);
          choice.setAttribute("aria-label", label);
          choice.dataset.value = value;
          choice.append(
            element("span", "member-cover-style-swatch"),
            element("span", "member-cover-style-name", label),
            element("span", "member-cover-style-check", "✓")
          );
          choice.addEventListener("click", () => {
            coverStyle.value = value;
            refreshProfilePreview();
          });
          styleButtons.set(value, choice);
          coverStylePicker.appendChild(choice);
        });
        const coverControls = element("div", "member-cover-controls");
        const removeCover = button("移除自定义背景", "btn btn-ghost");
        removeCover.hidden = !profile.cover_url;
        coverControls.append(removeCover);
        coverField.appendChild(coverControls);
        let coverRemoved = false;
        let previewObjectUrl = "";
        let avatarObjectUrl = "";

        function applyPreviewNameplate(style) {
          profile.nameplate_style = style || "classic";
          const theme = nameplateTheme(profile);
          previewDisplayName.className = `member-display-name is-${theme.style}${theme.pretty ? " is-pretty" : ""}`;
          previewSignature.className = `member-profile-preview-signature is-${theme.style}`;
          const avatarIsFallback = previewAvatar.classList.contains("member-avatar-fallback");
          previewAvatar.className = [
            "member-avatar",
            avatarIsFallback ? "member-avatar-fallback" : "",
            "member-avatar-frame",
            `is-${theme.style}`,
            theme.pretty ? "is-pretty" : "",
            theme.premium ? "is-premium" : ""
          ].filter(Boolean).join(" ");

          const nextPreviewPlate = uidNameplate(profile);
          if (previewPlate && nextPreviewPlate) previewPlate.replaceWith(nextPreviewPlate);
          else if (!previewPlate && nextPreviewPlate) previewName.appendChild(nextPreviewPlate);
          else if (previewPlate && !nextPreviewPlate) previewPlate.remove();
          previewPlate = nextPreviewPlate;

          const nextShowcasePlate = uidNameplate(profile);
          currentNameplateSlot.replaceChildren(
            nextShowcasePlate || element("span", "text-muted", "经典 UID")
          );
          currentShowcasePlate = nextShowcasePlate;
        }

        function refreshProfilePreview() {
          previewDisplayName.textContent = displayName.value.trim() || actor.displayName || "波浪研究者";
          previewSignature.textContent = bio.value.trim() || "写一句属于你的研究签名。";
          signatureCount.textContent = `${bio.value.length}/200`;
          ["chart-dark", "wave-blue", "paper", "midnight"].forEach(value => {
            profilePreview.classList.toggle(`cover-${value}`, coverStyle.value === value);
            const choice = styleButtons.get(value);
            if (choice) choice.setAttribute("aria-pressed", String(coverStyle.value === value));
          });
          const coverSource = previewObjectUrl || (!coverRemoved && profile.cover_url) || "";
          if (coverSource) {
            profilePreview.style.setProperty(
              "--member-cover-image",
              `url("${String(coverSource).replace(/["\\]/g, "")}")`
            );
            profilePreview.classList.add("has-cover-image");
          } else {
            profilePreview.style.removeProperty("--member-cover-image");
            profilePreview.classList.remove("has-cover-image");
          }
        }

        displayName.addEventListener("input", refreshProfilePreview);
        bio.addEventListener("input", refreshProfilePreview);
        coverStyle.addEventListener("change", refreshProfilePreview);
        avatarInput.addEventListener("change", () => {
          if (avatarObjectUrl) URL.revokeObjectURL(avatarObjectUrl);
          const file = avatarInput.files && avatarInput.files[0];
          avatarObjectUrl = file ? URL.createObjectURL(file) : "";
          if (!avatarObjectUrl) return;
          const image = profileAvatar({...profile, avatar_url: avatarObjectUrl}, actor);
          image.alt = "新头像预览";
          image.width = 88;
          image.height = 88;
          previewAvatar.replaceWith(image);
          previewAvatar = image;
        });
        coverInput.addEventListener("change", () => {
          if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
          const file = coverInput.files && coverInput.files[0];
          previewObjectUrl = file ? URL.createObjectURL(file) : "";
          if (file) {
            coverRemoved = false;
            removeCover.hidden = false;
          }
          refreshProfilePreview();
        });
        removeCover.addEventListener("click", () => {
          if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
          previewObjectUrl = "";
          coverInput.value = "";
          coverRemoved = true;
          removeCover.hidden = true;
          refreshProfilePreview();
        });
        refreshProfilePreview();
        const settings = element("div", "member-profile-settings");
        function settingsSection(eyebrow, title, copy) {
          const section = element("section", "member-profile-settings-section");
          const sectionHeading = element("header", "member-profile-settings-heading");
          sectionHeading.append(
            element("span", "member-profile-settings-eyebrow", eyebrow),
            element("h2", "", title),
            element("p", "text-muted", copy)
          );
          section.appendChild(sectionHeading);
          return section;
        }
        const identitySettings = settingsSection(
          "01",
          "身份与签名",
          "让好友一眼认出你，也知道你关注怎样的研究。"
        );
        identitySettings.append(
          field("昵称", displayName),
          signatureField
        );
        const appearanceSettings = settingsSection(
          "02",
          "头像与背景",
          "背景色调也会作用于自定义图片，保证文字始终清晰。"
        );
        const avatarField = field("头像", avatarInput);
        avatarField.appendChild(element("span", "community-field-hint", "上传后会自动裁切为正方形 WebP。"));
        const styleField = element("div", "community-field member-cover-style-field");
        styleField.append(
          element("span", "", "背景色调"),
          coverStyle,
          coverStylePicker
        );
        appearanceSettings.append(avatarField, coverField, styleField);
        const preferenceSettings = settingsSection(
          "03",
          "研究偏好",
          "这些信息帮助好友快速理解你的市场范围与观察级别。"
        );
        const preferenceGrid = element("div", "member-profile-preference-grid");
        preferenceGrid.append(
          field("关注市场（用顿号分隔）", markets),
          field("常用周期（用顿号分隔）", timeframes)
        );
        preferenceSettings.appendChild(preferenceGrid);
        const nameplateSettings = settingsSection(
          "04",
          "铭牌与身份特效",
          "在这里管理已经兑换的铭牌；佩戴后会同步到昵称、头像框、好友列表与会话。"
        );
        const nameplateToolbar = element("div", "member-profile-nameplate-toolbar");
        nameplateToolbar.append(
          element(
            "p",
            "text-small text-muted",
            nameplates.length ? `已拥有 ${nameplates.length} 款` : "还没有可佩戴的铭牌"
          ),
          routeLink(
            {kind: "member", view: "rewards"},
            "去积分商城",
            "member-reward-section-link"
          )
        );
        const nameplateStatus = element("p", "member-nameplate-status text-small text-muted");
        nameplateStatus.setAttribute("role", "status");
        nameplateStatus.setAttribute("aria-live", "polite");
        const ownedList = element(
          "div",
          "member-owned-nameplate-list member-profile-nameplate-list"
        );
        const nameplateControls = [];
        if (!nameplates.length) {
          const empty = element("div", "member-profile-nameplate-empty");
          empty.append(
            uiIcon("sparkles"),
            element("strong", "", "尚未拥有身份铭牌"),
            element("p", "text-muted", "在积分商城兑换后，可回到这里预览并佩戴。")
          );
          ownedList.appendChild(empty);
        } else {
          nameplates.forEach(item => {
            const style = String(item.style || "classic");
            const row = element(
              "article",
              `member-owned-nameplate is-${style}${item.equipped ? " is-equipped" : ""}`
            );
            const identity = element("div", "member-owned-nameplate-identity");
            const plate = uidNameplate({
              public_uid: actor.publicUid || actor.public_uid || profile.public_uid || 88888,
              nameplate_style: style
            });
            const expiry = item.expires_at
              ? new Intl.DateTimeFormat("zh-CN").format(new Date(item.expires_at))
              : "长期有效";
            identity.append(
              plate || element("span", "", "UID"),
              element(
                "span",
                "text-small text-muted",
                `${item.product_name || "动态铭牌"} · ${expiry === "长期有效" ? expiry : `有效至 ${expiry}`}`
              )
            );
            const equip = button(
              item.equipped ? "当前佩戴" : "佩戴",
              "btn btn-ghost member-owned-nameplate-equip"
            );
            equip.disabled = Boolean(item.equipped);
            const control = {item, row, equip, style};
            nameplateControls.push(control);
            equip.addEventListener("click", async () => {
              equip.disabled = true;
              equip.textContent = "切换中";
              nameplateStatus.dataset.state = "working";
              nameplateStatus.textContent = "正在同步身份特效…";
              try {
                await repository.equipNameplate(item.id);
                playSocialSound("friend", true);
                nameplates.forEach(entry => {
                  entry.equipped = String(entry.id) === String(item.id);
                });
                nameplateControls.forEach(entry => {
                  const active = String(entry.item.id) === String(item.id);
                  entry.row.classList.toggle("is-equipped", active);
                  entry.equip.disabled = active;
                  entry.equip.textContent = active ? "当前佩戴" : "佩戴";
                });
                applyPreviewNameplate(style);
                if (typeof auth.refreshActor === "function") await auth.refreshActor();
                nameplateStatus.dataset.state = "success";
                nameplateStatus.textContent = "已同步到个人资料、好友列表与会话。";
              } catch (error) {
                nameplateStatus.dataset.state = "error";
                nameplateStatus.textContent = socialError(error);
                equip.disabled = false;
                equip.textContent = "重试";
              }
            });
            row.append(identity, equip);
            ownedList.appendChild(row);
          });
        }
        nameplateSettings.append(nameplateToolbar, ownedList, nameplateStatus);
        settings.append(identitySettings, appearanceSettings, preferenceSettings, nameplateSettings);
        workspace.append(previewColumn, settings);

        const status = element("p", "member-profile-save-status text-small text-muted");
        status.setAttribute("role", "status");
        status.setAttribute("aria-live", "polite");
        const save = button("保存资料", "btn btn-primary");
        save.type = "submit";
        const saveBar = element("footer", "member-profile-savebar");
        saveBar.append(
          element("p", "member-profile-save-copy", "保存后，个人空间与好友会话会同步更新。"),
          status,
          save
        );
        form.append(heading, workspace, saveBar);
        form.addEventListener("submit", async event => {
          event.preventDefault();
          save.disabled = true;
          save.textContent = "校验中…";
          status.dataset.state = "working";
          status.textContent = "正在检查资料…";
          try {
            const coverFile = coverInput.files && coverInput.files[0];
            const avatarSource = avatarInput.files && avatarInput.files[0];
            if (coverFile && !["image/jpeg", "image/png", "image/webp"].includes(coverFile.type)) {
              throw new Error("背景图只支持 JPG、PNG 或 WebP。");
            }
            if (coverFile && coverFile.size > 5 * 1024 * 1024) {
              throw new Error("背景图不能超过 5 MiB。");
            }
            if (avatarSource && !["image/jpeg", "image/png", "image/webp"].includes(avatarSource.type)) {
              throw new Error("头像只支持 JPG、PNG 或 WebP。");
            }
            const validation = core.validateProfile({
              displayName: displayName.value,
              bio: bio.value,
              markets: markets.value.split(/[、,]/),
              timeframes: timeframes.value.split(/[、,]/),
              coverUrl: coverRemoved ? null : profile.cover_url || null,
              coverStyle: coverStyle.value
            });
            if (!validation.ok) {
              throw new Error(Object.values(validation.errors).join(" "));
            }
            let avatarUrl = profile.avatar_url || null;
            let coverUrl = coverRemoved ? null : profile.cover_url || null;
            if (avatarSource) {
              save.textContent = "处理头像…";
              status.textContent = "正在裁切并上传头像。";
              const cropped = await avatar.cropAvatarFile(avatarSource);
              const avatarFile = new File([cropped], "avatar.webp", {
                type: "image/webp"
              });
              avatarUrl = await repository.uploadAvatar(actor.id, avatarFile);
            }
            if (coverFile) {
              save.textContent = "上传背景…";
              status.textContent = "正在上传个人页背景。";
              coverUrl = await repository.uploadCover(actor.id, coverFile);
            }
            save.textContent = "保存中…";
            status.textContent = "正在同步个人名片。";
            await repository.updateMyProfile({
              ...validation.value,
              avatarUrl,
              coverUrl,
              coverStyle: coverStyle.value
            });
            let shouldDeletePreviousCover = Boolean(profile.cover_url && coverRemoved);
            if (profile.cover_url && coverFile && coverUrl) {
              try {
                shouldDeletePreviousCover = new URL(profile.cover_url).pathname
                  !== new URL(coverUrl).pathname;
              } catch (_) {
                shouldDeletePreviousCover = false;
              }
            }
            if (shouldDeletePreviousCover && typeof repository.deleteProfileImage === "function") {
              try {
                await repository.deleteProfileImage(profile.cover_url);
              } catch (_) {
                // The profile is already private from the old URL; storage cleanup can be retried later.
              }
            }
            status.dataset.state = "success";
            status.replaceChildren(
              doc.createTextNode("已保存。"),
              routeLink({kind: "member", view: "home"}, "返回个人空间", "kb-knowledge-link")
            );
            save.textContent = "已保存";
            if (typeof auth.refreshActor === "function") await auth.refreshActor();
          } catch (error) {
            status.dataset.state = "error";
            status.textContent = String(error.message || error);
            save.textContent = "重新保存";
          } finally {
            save.disabled = false;
          }
        });
        activeSocialCleanup = () => {
          if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
          if (avatarObjectUrl) URL.revokeObjectURL(avatarObjectUrl);
          previewObjectUrl = "";
          avatarObjectUrl = "";
        };
        contentHost.replaceChildren(form);
      } catch (error) {
        contentHost.replaceChildren(notice("无法读取资料", String(error.message || error)));
      }
    }

    function publicPostCard(post) {
      const article = element("article", "member-public-card");
      article.append(
        element("p", "member-eyebrow", "公开观点"),
        routeLink(
          {kind: "public-viewpoint", postId: post.id},
          post.title,
          "member-entry-title"
        ),
        element("p", "text-muted", post.summary || String(post.body || "").slice(0, 160)),
        element(
          "time",
          "text-small text-muted",
          new Date(post.created_at || Date.now()).toLocaleDateString("zh-CN")
        )
      );
      return article;
    }

    async function renderFeed() {
      const sequence = ++renderSequence;
      setBreadcrumb([]);
      contentHost.replaceChildren(notice("正在加载", "正在读取公开观点。"));
      try {
        const posts = await repository.listPublicPosts();
        if (sequence !== renderSequence) return;
        const fragment = doc.createDocumentFragment();
        const heading = element("section", "member-feed-heading");
        heading.append(
          element("h1", "", "公开观点"),
          element("p", "text-muted", "公开内容与私人原稿分离；评论用于讨论依据、边界和反例。"),
          hashLink("#compose=public_viewpoint", "发布公开观点", "btn btn-primary")
        );
        const list = element("section", "member-public-list");
        if (!posts || !posts.length) {
          list.appendChild(notice("还没有公开观点", "从私人草稿整理一份可核验的观点发布。"));
        } else {
          posts.forEach(post => list.appendChild(publicPostCard(post)));
        }
        fragment.append(heading, list);
        contentHost.replaceChildren(fragment);
      } catch (error) {
        contentHost.replaceChildren(notice("社区暂时无法读取", String(error.message || error)));
      }
    }

    async function renderViewpoint(postId) {
      const sequence = ++renderSequence;
      setBreadcrumb([
        {label: "研究社区", route: {kind: "community-feed"}},
        {label: "观点详情"}
      ]);
      contentHost.replaceChildren(notice("正在加载", "正在读取观点与评论。"));
      try {
        const [post, comments] = await Promise.all([
          repository.getPublicPost(postId),
          repository.listComments(postId)
        ]);
        if (sequence !== renderSequence) return;
        const fragment = doc.createDocumentFragment();
        const article = element("article", "member-viewpoint");
        article.append(
          element("p", "member-eyebrow", "公开观点"),
          element("h1", "", post.title),
          element("p", "member-viewpoint-summary", post.summary || ""),
          element("div", "member-viewpoint-body", post.body)
        );
        if (post.external_url) {
          const external = element("a", `member-external-reference is-${post.external_kind || "link"}`);
          external.href = post.external_url;
          external.target = "_blank";
          external.rel = "noopener noreferrer";
          external.textContent = post.external_kind === "x"
            ? "𝕏 查看引用的 X 帖子 ↗"
            : "▶ 查看引用的 YouTube 视频 ↗";
          article.appendChild(external);
        }
        const commentSection = element("section", "member-comments");
        commentSection.appendChild(element("h2", "", `评论（${comments.length}）`));
        comments.forEach(comment => {
          const row = element("article", "member-comment");
          row.append(
            element("p", "", comment.body),
            element(
              "time",
              "text-small text-muted",
              new Date(comment.created_at).toLocaleString("zh-CN")
            )
          );
          if (comment.parent_id) row.classList.add("member-comment-reply");
          commentSection.appendChild(row);
        });
        const actor = auth.actor();
        if (actor && auth.canPost() && post.comments_enabled) {
          const form = element("form", "member-comment-form");
          const body = element("textarea");
          body.rows = 3;
          body.maxLength = 2000;
          body.placeholder = "围绕规则、证据或边界发表评论";
          const submit = button("发表评论", "btn btn-primary");
          submit.type = "submit";
          const status = element("p", "text-small text-muted");
          form.append(body, submit, status);
          form.addEventListener("submit", async event => {
            event.preventDefault();
            submit.disabled = true;
            try {
              await repository.addComment({
                postId,
                userId: actor.id,
                body: body.value
              });
              renderViewpoint(postId);
            } catch (error) {
              status.textContent = String(error.message || error);
              submit.disabled = false;
            }
          });
          commentSection.appendChild(form);
        }
        fragment.append(article, commentSection);
        contentHost.replaceChildren(fragment);
      } catch (error) {
        contentHost.replaceChildren(notice("观点暂时无法读取", String(error.message || error)));
      }
    }

    function render(route) {
      resetSocialLifecycle();
      if (!configured || !repository) {
        setBreadcrumb([{label: "个人与社区"}]);
        contentHost.replaceChildren(notice(
          "服务尚未连接",
          "知识库可以继续使用；连接 Supabase 后启用私人记录和公开评论。"
        ));
        return;
      }
      if (!(route.kind === "member" && route.view === "messages") && win) {
        messengerReturnHash = win.location.hash || "#space=home";
        messengerHasBackground = true;
      }
      if (route.kind === "member-entry") return renderEntry(route.entryId);
      if (route.kind === "member" && route.view === "profile") return renderProfile();
      if (route.kind === "member" && route.view === "rewards") return renderRewards();
      if (route.kind === "member" && route.view === "person") return renderPublicProfile(route);
      if (route.kind === "member" && route.view === "people") return renderPeople(route);
      if (route.kind === "member" && route.view === "messages") return renderMessages(route);
      if (route.kind === "member" && ["review", "journal", "draft"].includes(route.view)) {
        navigate(`#workbench=new&step=0&panel=records&records=${encodeURIComponent(route.view)}`);
        return;
      }
      if (route.kind === "member") return renderHome(route.view || "home");
      if (route.kind === "community-feed") return renderFeed();
      if (route.kind === "public-viewpoint") return renderViewpoint(route.postId);
      return renderFeed();
    }

    return {
      render,
      dispose: (disposeOptions = {}) => {
        resetSocialLifecycle();
        if (!disposeOptions.preserveMessenger) resetFloatingMessenger();
      }
    };
  }

  return {
    privateHomeCopy,
    entryKindLabels,
    validateCustomStickerFile,
    customStickerToken,
    customStickerFromBody,
    createMemberUI
  };
});
