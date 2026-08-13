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
export type AppearanceSettings = { theme: AppearanceTheme; mode: AppearanceMode; customColor: string };
export const DEFAULT_APPEARANCE: AppearanceSettings = { theme: "wave", mode: "system", customColor: "#557fb8" };

export function normalizeAppearance(value: unknown): AppearanceSettings {
  const source = value && typeof value === "object" ? value as Partial<AppearanceSettings> : {};
  return {
    theme: source.theme && source.theme in APPEARANCE_THEMES ? source.theme : DEFAULT_APPEARANCE.theme,
    mode: source.mode === "light" || source.mode === "dark" || source.mode === "system" ? source.mode : DEFAULT_APPEARANCE.mode,
    customColor: typeof source.customColor === "string" && /^#[0-9a-f]{6}$/i.test(source.customColor) ? source.customColor.toLowerCase() : DEFAULT_APPEARANCE.customColor,
  };
}

export function applyAppearance(settings: AppearanceSettings) {
  const root = document.documentElement;
  root.dataset.wavekbTheme = settings.theme;
  root.dataset.wavekbMode = settings.mode;
  root.style.setProperty("--wavekb-user-accent", settings.customColor);
  root.style.setProperty("--wavekb-user-on-accent", textOnColor(settings.customColor));
}

export function textOnColor(hex: string) {
  const safe = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : DEFAULT_APPEARANCE.customColor.slice(1);
  const channels = [safe.slice(0, 2), safe.slice(2, 4), safe.slice(4, 6)].map((value) => Number.parseInt(value, 16) / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2] > 0.42 ? "#102033" : "#f7fbff";
}
