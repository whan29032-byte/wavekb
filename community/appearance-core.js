(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.WaveKBAppearance = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";

  const STORAGE_KEY = "wavekb:appearance:v1";
  const DEFAULTS = Object.freeze({
    theme: "wave",
    mode: "system",
    customColor: "#557fb8",
  });
  const THEMES = Object.freeze({
    wave: Object.freeze({ label: "深海波纹", note: "原站冷蓝，清晰沉稳", swatch: "#557fb8" }),
    sakura: Object.freeze({ label: "樱庭", note: "柔粉点色，不甜腻", swatch: "#b24f78" }),
    aurora: Object.freeze({ label: "极光机甲", note: "青绿高光，利落通透", swatch: "#208f8a" }),
    star: Object.freeze({ label: "星夜紫", note: "灰紫夜色，轻幻想感", swatch: "#7464b8" }),
    ink: Object.freeze({ label: "墨白", note: "低饱和黑白，专注阅读", swatch: "#596675" }),
    custom: Object.freeze({ label: "自定义", note: "使用你的专属强调色", swatch: "#557fb8" }),
  });
  const MODES = Object.freeze({
    system: "跟随系统",
    light: "明亮",
    dark: "深色",
  });

  function isHexColor(value) {
    return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim());
  }

  function normalize(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      theme: Object.prototype.hasOwnProperty.call(THEMES, source.theme) ? source.theme : DEFAULTS.theme,
      mode: Object.prototype.hasOwnProperty.call(MODES, source.mode) ? source.mode : DEFAULTS.mode,
      customColor: isHexColor(source.customColor) ? source.customColor.toLowerCase() : DEFAULTS.customColor,
    };
  }

  function load(storage) {
    if (!storage || typeof storage.getItem !== "function") return { ...DEFAULTS };
    try {
      const raw = storage.getItem(STORAGE_KEY);
      return normalize(raw ? JSON.parse(raw) : DEFAULTS);
    } catch (_error) {
      return { ...DEFAULTS };
    }
  }

  function save(storage, value) {
    const settings = normalize(value);
    if (storage && typeof storage.setItem === "function") {
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(settings));
      } catch (_error) {
        return settings;
      }
    }
    return settings;
  }

  function textOnColor(hex) {
    const color = isHexColor(hex) ? hex.slice(1) : DEFAULTS.customColor.slice(1);
    const red = parseInt(color.slice(0, 2), 16) / 255;
    const green = parseInt(color.slice(2, 4), 16) / 255;
    const blue = parseInt(color.slice(4, 6), 16) / 255;
    const linear = [red, green, blue].map(function (channel) {
      return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
    });
    const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    return luminance > 0.42 ? "#102033" : "#f7fbff";
  }

  function apply(doc, value) {
    const settings = normalize(value);
    if (!doc || !doc.documentElement) return settings;
    const element = doc.documentElement;
    element.dataset.wavekbTheme = settings.theme;
    element.dataset.wavekbMode = settings.mode;
    element.style.setProperty("--wavekb-user-accent", settings.customColor);
    element.style.setProperty("--wavekb-user-on-accent", textOnColor(settings.customColor));
    return settings;
  }

  return Object.freeze({
    STORAGE_KEY,
    DEFAULTS,
    THEMES,
    MODES,
    isHexColor,
    normalize,
    load,
    save,
    textOnColor,
    apply,
  });
});
