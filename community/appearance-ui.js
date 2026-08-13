(function () {
  "use strict";

  const core = window.WaveKBAppearance;
  if (!core) return;

  function browserStorage() {
    try {
      return window.localStorage;
    } catch (_error) {
      return null;
    }
  }

  const storage = browserStorage();
  let current = core.load(storage);
  core.apply(document, current);

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function persist(next) {
    current = core.save(storage, next);
    core.apply(document, current);
    renderState();
  }

  function themeButtons() {
    return Object.entries(core.THEMES)
      .filter(function (entry) { return entry[0] !== "custom"; })
      .map(function (entry) {
        const id = entry[0];
        const theme = entry[1];
        return [
          '<button class="wavekb-theme-option" type="button" data-appearance-theme="', escapeHtml(id), '" role="radio" aria-checked="false">',
          '<span class="wavekb-theme-swatch" data-swatch="', escapeHtml(id), '" aria-hidden="true"></span>',
          '<span><strong>', escapeHtml(theme.label), '</strong><small>', escapeHtml(theme.note), '</small></span>',
          '</button>',
        ].join("");
      })
      .join("");
  }

  function modeButtons() {
    return Object.entries(core.MODES)
      .map(function (entry) {
        return '<button type="button" data-appearance-mode="' + escapeHtml(entry[0]) + '" role="radio" aria-checked="false">' + escapeHtml(entry[1]) + '</button>';
      })
      .join("");
  }

  function mount() {
    const sidebar = document.querySelector("#elliott-kb-inline .kb-tree-pane");
    const navigation = sidebar && sidebar.querySelector(".kb-home-nav");
    if (!sidebar || !navigation || sidebar.querySelector("[data-wavekb-appearance]")) return;

    const host = document.createElement("div");
    host.className = "wavekb-appearance";
    host.dataset.wavekbAppearance = "";
    host.innerHTML = [
      '<button class="wavekb-appearance-toggle" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="wavekb-appearance-panel">',
      '<span class="wavekb-current-swatch" aria-hidden="true"></span>',
      '<span class="wavekb-appearance-toggle-copy"><strong>外观</strong><small data-appearance-current></small></span>',
      '<span class="wavekb-appearance-action" aria-hidden="true">设置</span>',
      '</button>',
      '<section id="wavekb-appearance-panel" class="wavekb-appearance-panel" role="dialog" aria-modal="false" aria-labelledby="wavekb-appearance-title" hidden>',
      '<div class="wavekb-appearance-heading"><div><strong id="wavekb-appearance-title">网站外观</strong><p>配色只保存在当前浏览器</p></div><button class="wavekb-appearance-close" type="button">关闭</button></div>',
      '<fieldset class="wavekb-mode-picker"><legend>显示模式</legend><div role="radiogroup" aria-label="显示模式">', modeButtons(), '</div></fieldset>',
      '<fieldset class="wavekb-theme-picker"><legend>主题配色</legend><div class="wavekb-theme-grid" role="radiogroup" aria-label="主题配色">', themeButtons(), '</div></fieldset>',
      '<div class="wavekb-custom-color"><label for="wavekb-custom-color">自定义强调色</label><div><input id="wavekb-custom-color" type="color" value="', escapeHtml(current.customColor), '"><button type="button" data-appearance-custom>使用此颜色</button></div><small>正文、卡片与深浅层级会自动保持可读。</small></div>',
      '<div class="wavekb-appearance-footer"><button type="button" data-appearance-reset>恢复默认</button><span role="status" aria-live="polite" data-appearance-status></span></div>',
      '</section>',
    ].join("");

    sidebar.insertBefore(host, navigation);
    const toggle = host.querySelector(".wavekb-appearance-toggle");
    const panel = host.querySelector(".wavekb-appearance-panel");
    const closeButton = host.querySelector(".wavekb-appearance-close");
    const colorInput = host.querySelector("#wavekb-custom-color");
    const status = host.querySelector("[data-appearance-status]");

    function setOpen(open) {
      toggle.setAttribute("aria-expanded", String(open));
      panel.hidden = !open;
      host.classList.toggle("is-open", open);
      if (open) closeButton.focus({ preventScroll: true });
      else toggle.focus({ preventScroll: true });
    }

    toggle.addEventListener("click", function () {
      setOpen(panel.hidden);
    });
    closeButton.addEventListener("click", function () { setOpen(false); });

    host.addEventListener("click", function (event) {
      const themeButton = event.target.closest("[data-appearance-theme]");
      const modeButton = event.target.closest("[data-appearance-mode]");
      if (themeButton) {
        persist({ ...current, theme: themeButton.dataset.appearanceTheme });
        status.textContent = "主题已保存";
      }
      if (modeButton) {
        persist({ ...current, mode: modeButton.dataset.appearanceMode });
        status.textContent = "显示模式已保存";
      }
      if (event.target.closest("[data-appearance-custom]")) {
        persist({ ...current, theme: "custom", customColor: colorInput.value });
        status.textContent = "自定义颜色已保存";
      }
      if (event.target.closest("[data-appearance-reset]")) {
        persist(core.DEFAULTS);
        colorInput.value = current.customColor;
        status.textContent = "已恢复默认";
      }
    });

    document.addEventListener("pointerdown", function (event) {
      if (!panel.hidden && !host.contains(event.target)) setOpen(false);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !panel.hidden) setOpen(false);
    });

    window.addEventListener("storage", function (event) {
      if (event.key !== core.STORAGE_KEY) return;
      current = core.load(storage);
      core.apply(document, current);
      renderState();
    });

    renderState = function () {
      const theme = core.THEMES[current.theme] || core.THEMES.wave;
      host.querySelector("[data-appearance-current]").textContent = theme.label;
      host.querySelectorAll("[data-appearance-theme]").forEach(function (button) {
        button.setAttribute("aria-checked", String(button.dataset.appearanceTheme === current.theme));
      });
      host.querySelectorAll("[data-appearance-mode]").forEach(function (button) {
        button.setAttribute("aria-checked", String(button.dataset.appearanceMode === current.mode));
      });
      colorInput.value = current.customColor;
    };
    renderState();
  }

  let renderState = function () {};
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
})();
