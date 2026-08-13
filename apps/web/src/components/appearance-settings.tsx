"use client";

import { useEffect, useState } from "react";
import { Palette } from "@phosphor-icons/react";
import { APPEARANCE_STORAGE_KEY, APPEARANCE_THEMES, DEFAULT_APPEARANCE, applyAppearance, normalizeAppearance, type AppearanceSettings } from "@/lib/appearance";

export function AppearanceSettings() {
  const [settings, setSettings] = useState<AppearanceSettings>(DEFAULT_APPEARANCE);

  useEffect(() => {
    const restore = window.setTimeout(() => {
      try {
        const next = normalizeAppearance(JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) || "null"));
        setSettings(next);
        applyAppearance(next);
      } catch { applyAppearance(DEFAULT_APPEARANCE); }
    }, 0);
    return () => window.clearTimeout(restore);
  }, []);

  function save(next: AppearanceSettings) {
    const normalized = normalizeAppearance(next);
    setSettings(normalized);
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(normalized));
    applyAppearance(normalized);
  }

  return <details className="group relative">
    <summary className="grid size-10 cursor-pointer list-none place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="网站外观"><Palette aria-hidden size={19} /></summary>
    <section className="absolute right-0 top-12 z-40 grid w-[min(22rem,calc(100vw-2rem))] gap-5 rounded-xl border bg-surface p-5 shadow-xl" aria-label="网站外观设置">
      <div><h2 className="font-semibold">网站外观</h2><p className="mt-1 text-xs text-muted-foreground">设置只保存在当前浏览器。</p></div>
      <fieldset className="grid gap-2"><legend className="mb-2 text-sm font-semibold">显示模式</legend><div className="grid grid-cols-3 gap-2">{([ ["system","跟随系统"], ["light","明亮"], ["dark","深色"] ] as const).map(([value,label]) => <button key={value} type="button" aria-pressed={settings.mode === value} className={`min-h-10 rounded-lg border px-2 text-xs font-semibold ${settings.mode === value ? "border-primary bg-primary text-primary-foreground" : "bg-background"}`} onClick={() => save({ ...settings, mode: value })}>{label}</button>)}</div></fieldset>
      <fieldset className="grid gap-2"><legend className="mb-2 text-sm font-semibold">主题配色</legend><div className="grid grid-cols-2 gap-2">{Object.entries(APPEARANCE_THEMES).filter(([key]) => key !== "custom").map(([key, value]) => <button key={key} type="button" aria-pressed={settings.theme === key} className={`flex min-h-12 items-center gap-3 rounded-lg border px-3 text-left ${settings.theme === key ? "border-primary bg-muted" : "bg-background"}`} onClick={() => save({ ...settings, theme: key as AppearanceSettings["theme"] })}><span className="size-4 rounded-full" style={{ backgroundColor: value.swatch }} aria-hidden /><span><strong className="block text-xs">{value.label}</strong><span className="text-[11px] text-muted-foreground">{value.note}</span></span></button>)}</div></fieldset>
      <label className="grid gap-2 text-sm font-semibold" htmlFor="appearance-custom-color">自定义强调色<div className="flex gap-2"><input id="appearance-custom-color" type="color" value={settings.customColor} onChange={(event) => save({ ...settings, theme: "custom", customColor: event.target.value })} className="h-10 w-14 cursor-pointer rounded-lg border bg-background p-1" /><button type="button" className="min-h-10 flex-1 rounded-lg border bg-background px-3 text-sm" onClick={() => save({ ...settings, theme: "custom" })}>使用此颜色</button></div></label>
      <button type="button" className="min-h-10 rounded-lg border bg-background px-3 text-sm font-semibold" onClick={() => save(DEFAULT_APPEARANCE)}>恢复默认</button>
    </section>
  </details>;
}
