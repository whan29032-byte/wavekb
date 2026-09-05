"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Palette } from "@phosphor-icons/react";
import { APPEARANCE_STORAGE_KEY, APPEARANCE_THEMES, DEFAULT_APPEARANCE, applyAppearance, normalizeAppearance, type AppearanceSettings } from "@/lib/appearance";

export function AppearanceSettings() {
  const [settings, setSettings] = useState<AppearanceSettings>(DEFAULT_APPEARANCE);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 16, top: 72 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const id = useId();

  function positionPanel() {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(22 * parseFloat(getComputedStyle(document.documentElement).fontSize), window.innerWidth - 32);
    setPosition({ left: Math.max(16, Math.min(rect.right - width, window.innerWidth - width - 16)), top: rect.bottom + 8 });
  }

  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", positionPanel);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", positionPanel);
    };
  }, [open]);

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
    try { localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(normalized)); } catch { /* Keep the current page usable when storage is unavailable. */ }
    applyAppearance(normalized);
  }

  return <>
    <button ref={trigger} type="button" className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" aria-label="网站外观" aria-expanded={open} aria-controls={id} onClick={() => { positionPanel(); setOpen(!open); }}><Palette aria-hidden size={19} /></button>
    {open ? createPortal(<section ref={panel} id={id} tabIndex={-1} style={{ ...position, maxHeight: `calc(100dvh - ${position.top + 16}px)` }} className="fixed z-[1000] grid w-[min(22rem,calc(100vw-2rem))] gap-5 overflow-y-auto overscroll-contain rounded-xl border bg-surface p-5 text-foreground shadow-xl" aria-label="网站外观设置">
      <div><h2 className="font-semibold">网站外观</h2><p className="mt-1 text-xs text-muted-foreground">设置只保存在当前浏览器。</p></div>
      <fieldset className="grid gap-2"><legend className="mb-2 text-sm font-semibold">显示模式</legend><div className="grid grid-cols-3 gap-2">{([ ["system","跟随系统"], ["light","明亮"], ["dark","深色"] ] as const).map(([value,label]) => <button key={value} type="button" aria-pressed={settings.mode === value} className={`min-h-10 rounded-lg border px-2 text-xs font-semibold ${settings.mode === value ? "border-primary bg-primary text-primary-foreground" : "bg-background"}`} onClick={() => save({ ...settings, mode: value })}>{label}</button>)}</div></fieldset>
      <fieldset className="grid gap-2"><legend className="mb-2 text-sm font-semibold">主题配色</legend><div className="grid grid-cols-2 gap-2">{Object.entries(APPEARANCE_THEMES).filter(([key]) => key !== "custom").map(([key, value]) => <button key={key} type="button" aria-pressed={settings.theme === key} className={`flex min-h-12 items-center gap-3 rounded-lg border px-3 text-left ${settings.theme === key ? "border-primary bg-muted" : "bg-background"}`} onClick={() => save({ ...settings, theme: key as AppearanceSettings["theme"] })}><span className="size-4 rounded-full" style={{ backgroundColor: value.swatch }} aria-hidden /><span><strong className="block text-xs">{value.label}</strong><span className="text-[11px] text-muted-foreground">{value.note}</span></span></button>)}</div></fieldset>
      <label className="grid gap-2 text-sm font-semibold" htmlFor="appearance-custom-color">自定义强调色<div className="flex gap-2"><input id="appearance-custom-color" type="color" value={settings.customColor} onChange={(event) => save({ ...settings, theme: "custom", customColor: event.target.value })} className="h-10 w-14 cursor-pointer rounded-lg border bg-background p-1" /><button type="button" className="min-h-10 flex-1 rounded-lg border bg-background px-3 text-sm" onClick={() => save({ ...settings, theme: "custom" })}>使用此颜色</button></div></label>
      <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={settings.reduceMotion === true} onChange={(event) => save({ ...settings, reduceMotion: event.target.checked })} /><span>减少动态效果<span className="block text-xs text-muted-foreground">保留铭牌材质、渐变与装饰；同时尊重系统设置。</span></span></label>
      <button type="button" className="min-h-10 rounded-lg border bg-background px-3 text-sm font-semibold" onClick={() => save(DEFAULT_APPEARANCE)}>恢复默认</button>
    </section>, document.body) : null}
  </>;
}
