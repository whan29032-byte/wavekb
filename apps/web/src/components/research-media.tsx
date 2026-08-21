"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowSquareOut, Play } from "@phosphor-icons/react";
import type { ExternalReference } from "@wavekb/domain";
import { normalizeResearchMediaList, type XMedia, type YouTubeMedia } from "@/lib/community/external-media";

declare global {
  interface Window {
    twttr?: { widgets?: { createTweet: (id: string, element: HTMLElement, options?: Record<string, unknown>) => Promise<HTMLElement | undefined> } };
  }
}

let twitterLoader: Promise<void> | null = null;

function loadTwitterWidgets(): Promise<void> {
  if (window.twttr?.widgets?.createTweet) return Promise.resolve();
  if (twitterLoader) return twitterLoader;
  twitterLoader = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://platform.twitter.com/widgets.js"]');
    const script = existing ?? document.createElement("script");
    const timeout = window.setTimeout(() => reject(new Error("x_embed_timeout")), 8_000);
    const ready = () => { window.clearTimeout(timeout); resolve(); };
    const failed = () => { window.clearTimeout(timeout); reject(new Error("x_embed_failed")); };
    script.addEventListener("load", ready, { once: true });
    script.addEventListener("error", failed, { once: true });
    if (!existing) {
      script.src = "https://platform.twitter.com/widgets.js";
      script.async = true;
      script.crossOrigin = "anonymous";
      document.head.appendChild(script);
    }
  });
  return twitterLoader;
}

function YouTubeEmbed({ media }: { media: YouTubeMedia }) {
  const [state, setState] = useState<"facade" | "loading" | "loaded" | "failed">("facade");
  useEffect(() => {
    if (state !== "loading") return;
    const timeout = window.setTimeout(() => setState("failed"), 10_000);
    return () => window.clearTimeout(timeout);
  }, [state]);
  return (
    <article className="research-media-item">
      <header><strong>YouTube</strong><span>外部引用</span></header>
      <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
        {state === "facade" ? (
          <button type="button" className="group absolute inset-0 grid size-full place-items-center overflow-hidden bg-black text-white" onClick={() => setState("loading")} aria-label="在站内播放 YouTube 视频">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`https://i.ytimg.com/vi/${encodeURIComponent(media.videoId)}/hqdefault.jpg`} alt="YouTube 视频封面" loading="lazy" className="absolute inset-0 size-full object-cover opacity-80 transition duration-200 group-hover:opacity-65" />
            <span className="relative grid size-16 place-items-center rounded-full bg-black/75 shadow-lg transition duration-200 group-hover:scale-105"><Play aria-hidden size={28} weight="fill" className="translate-x-0.5" /></span>
          </button>
        ) : state === "failed" ? (
          <div className="absolute inset-0 grid place-items-center bg-muted px-4 text-center text-sm text-muted-foreground">视频暂时无法加载，请使用下方入口在 YouTube 打开。</div>
        ) : <>
          <iframe title="YouTube 视频播放器" src={`${media.embedUrl}&autoplay=1`} className="absolute inset-0 size-full" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" onLoad={() => setState("loaded")} onError={() => setState("failed")} />
          {state === "loading" ? <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/65 text-sm text-white">正在加载 YouTube 视频…</div> : null}
        </>}
      </div>
      <a href={media.url} target="_blank" rel="noopener noreferrer" className="research-media-link">在 YouTube 打开 <ArrowSquareOut aria-hidden size={15} /></a>
    </article>
  );
}

function XEmbed({ media }: { media: XMedia }) {
  const container = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"waiting" | "loading" | "loaded" | "failed">("waiting");
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      setState("loading");
      loadTwitterWidgets()
        .then(() => window.twttr?.widgets?.createTweet(media.statusId, element, { align: "center", dnt: true, conversation: "none" }))
        .then((result) => setState(result ? "loaded" : "failed"))
        .catch(() => setState("failed"));
    }, { rootMargin: "240px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [media.statusId]);
  return (
    <article className="research-media-item">
      <header><strong>X</strong><span>外部引用</span></header>
      <div ref={container} className="min-h-28 overflow-hidden rounded-lg bg-muted/45" aria-live="polite">
        {state !== "loaded" ? <div className="grid min-h-28 place-items-center px-4 text-center text-sm text-muted-foreground">{state === "failed" ? "该内容暂时无法加载" : "滚动到这里时加载 X 原帖"}</div> : null}
      </div>
      <a href={media.url} target="_blank" rel="noopener noreferrer" className="research-media-link">查看原帖 <ArrowSquareOut aria-hidden size={15} /></a>
    </article>
  );
}

export function ResearchMedia({ references }: { references: ExternalReference[] }) {
  const media = normalizeResearchMediaList(references);
  if (!media.length) return null;
  return (
    <section className="research-section research-media" aria-labelledby="research-media-title">
      <header className="research-section-heading"><p>引用资料</p><h2 id="research-media-title">媒体与外部引用</h2></header>
      <div className="grid gap-5">{media.map((item) => item.kind === "youtube" ? <YouTubeEmbed key={item.id ?? item.url} media={item} /> : <XEmbed key={item.id ?? item.url} media={item} />)}</div>
    </section>
  );
}
