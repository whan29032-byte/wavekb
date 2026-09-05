export const APPEARANCE_STORAGE_KEY = "wavekb:appearance:v1";
export const APPEARANCE_THEMES = {
  wave: { label: "深海波纹", note: "原站冷蓝", swatch: "#557fb8" },
  sakura: { label: "樱庭", note: "柔粉点色", swatch: "#b24f78" },
  aurora: { label: "极光机甲", note: "青绿高光", swatch: "#208f8a" },
  star: { label: "星夜紫", note: "灰紫夜色", swatch: "#7464b8" },
  ink: { label: "墨白", note: "低饱和黑白", swatch: "#596675" },
  custom: { label: "自定义", note: "专属强调色", swatch: "#557fb8" },
} as const;
export type AppearanceTheme = keyof typeof APPEARANCE_THEMES;
export type AppearanceMode = "system" | "light" | "dark";
export type AppearanceSettings = { theme: AppearanceTheme; mode: AppearanceMode; customColor: string; reduceMotion?: boolean };
export const DEFAULT_APPEARANCE: AppearanceSettings = { theme: "wave", mode: "system", customColor: "#557fb8" };

export function normalizeAppearance(value: unknown): AppearanceSettings {
  const source = value && typeof value === "object" ? value as Partial<AppearanceSettings> : {};
  return {
    theme: source.theme && source.theme in APPEARANCE_THEMES ? source.theme : DEFAULT_APPEARANCE.theme,
    mode: source.mode === "light" || source.mode === "dark" || source.mode === "system" ? source.mode : DEFAULT_APPEARANCE.mode,
    customColor: typeof source.customColor === "string" && /^#[0-9a-f]{6}$/i.test(source.customColor) ? source.customColor.toLowerCase() : DEFAULT_APPEARANCE.customColor,
    ...(source.reduceMotion === true ? { reduceMotion: true } : {}),
  };
}

export function applyAppearance(settings: AppearanceSettings) {
  const root = document.documentElement;
  root.dataset.wavekbTheme = settings.theme;
  root.dataset.wavekbMode = settings.mode;
  root.dataset.wavekbReduceMotion = String(settings.reduceMotion === true);
  root.style.setProperty("--wavekb-user-accent", settings.customColor);
  const palette = customAccentPalette(settings.customColor);
  root.style.setProperty("--wavekb-user-accent-readable", palette.light);
  root.style.setProperty("--wavekb-user-accent-dark", palette.dark);
  root.style.setProperty("--wavekb-user-on-accent", palette.onLight);
  root.style.setProperty("--wavekb-user-on-accent-dark", palette.onDark);
}

export function readableAccent(hex: string) {
  const safe = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : DEFAULT_APPEARANCE.customColor.slice(1);
  const channels = [safe.slice(0, 2), safe.slice(2, 4), safe.slice(4, 6)].map((value) => Number.parseInt(value, 16));
  const luminance = (values: number[]) => {
    const linear = values.map((value) => value / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  let factor = 1;
  while (luminance(channels.map((value) => value * factor)) > 0.18 && factor > 0.2) factor -= 0.02;
  return `#${channels.map((value) => Math.round(value * factor).toString(16).padStart(2, "0")).join("")}`;
}

export function textOnColor(hex: string) {
  return contrastRatio(hex, "#102033") > contrastRatio(hex, "#ffffff") ? "#102033" : "#f7fbff";
}

function rgb(hex: string) {
  const safe = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : DEFAULT_APPEARANCE.customColor.slice(1);
  return [0, 2, 4].map((offset) => Number.parseInt(safe.slice(offset, offset + 2), 16));
}

export function contrastRatio(first: string, second: string) {
  const luminance = (hex: string) => rgb(hex).map((v) => v / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

export function customAccentPalette(hex: string) {
  const mix = (target: number, amount: number) => `#${rgb(hex).map((v) => Math.round(v + (target - v) * amount).toString(16).padStart(2, "0")).join("")}`;
  let light = mix(0, 0), dark = light;
  for (let step = 1; contrastRatio(light, "#f7fbff") < 4.7 && step <= 100; step++) light = mix(0, step / 100);
  for (let step = 1; contrastRatio(dark, "#263342") < 5 && step <= 100; step++) dark = mix(255, step / 100);
  return { light, dark, onLight: textOnColor(light), onDark: textOnColor(dark) };
}
