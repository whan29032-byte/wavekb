"use client";

import { useEffect, useRef, useState } from "react";
import { tradingViewEmbedUrl, type TradingViewPackage } from "@/lib/workbench/tradingview";

export function PrivateEntryChart({ value }: { value: TradingViewPackage }) {
  const [siteTheme, setSiteTheme] = useState<"light" | "dark">("light");
  const [failedSource, setFailedSource] = useState("");
  const frameRef = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const update = () => {
      const mode = document.documentElement.dataset.wavekbMode;
      setSiteTheme(mode === "dark" || (mode !== "light" && media?.matches) ? "dark" : "light");
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-wavekb-mode"] });
    media?.addEventListener("change", update);
    return () => { observer.disconnect(); media?.removeEventListener("change", update); };
  }, []);
  const source = tradingViewEmbedUrl({ ...value, theme: value.theme === "auto" ? siteTheme : value.theme });
  useEffect(() => {
    const frame = frameRef.current;
    const fail = () => setFailedSource(source);
    frame?.addEventListener("error", fail);
    return () => frame?.removeEventListener("error", fail);
  }, [source]);
  let chartUrl = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(value.symbol)}`;
  try {
    const candidate = new URL(value.chart_url);
    if (candidate.protocol === "https:" && (candidate.hostname === "tradingview.com" || candidate.hostname.endsWith(".tradingview.com"))) chartUrl = candidate.href;
  } catch { /* Symbol-only packages use the safe chart URL above. */ }
  return <div className="grid gap-3 overflow-hidden rounded-xl border bg-muted p-3">
    {value.symbol ? <iframe ref={frameRef} title={`${value.symbol} 图表`} src={source} className="h-[460px] w-full" loading="lazy" referrerPolicy="no-referrer" /> : <p className="text-sm">该链接或配置未提供品种代码，无法嵌入预览；请补充品种代码或打开原图表。</p>}
    {failedSource === source ? <p role="alert" className="text-sm">图表加载失败，可在 TradingView 查看此图表。</p> : null}
    <p className="text-xs text-muted-foreground">若预览空白或被浏览器拦截，请打开原图表。JSON 仅保存配置，嵌入图表不能恢复私人布局或绘图对象。</p>
    <a href={chartUrl} target="_blank" rel="noreferrer" className="text-sm font-medium text-primary hover:underline">在 TradingView 查看此图表</a>
  </div>;
}
