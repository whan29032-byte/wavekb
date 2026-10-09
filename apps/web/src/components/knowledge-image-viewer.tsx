"use client";

import { useEffect, useRef, useState } from "react";
import { MagnifyingGlassMinus, MagnifyingGlassPlus, X } from "@phosphor-icons/react";
import { KnowledgeReadingImage } from "./knowledge-reading-image";
import { readingImageUrl } from "@/lib/knowledge/reading-image-url";

export type ViewerAsset = { url: string; alt: string; width: number; height: number; caption: string };

export function KnowledgeImageViewer({ assets }: { assets: ViewerAsset[] }) {
  const [active, setActive] = useState<number | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [failedDeliveryUrl, setFailedDeliveryUrl] = useState<string | null>(null);
  const [fullImageState, setFullImageState] = useState<"loading" | "loaded" | "error">("loading");
  const drag = useRef<{ id: number; x: number; y: number; originX: number; originY: number } | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (active === null) return;
    const previousOverflow = document.body.style.overflow;
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setActive(null); }
      if (event.key !== "Tab") return;
      const buttons = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") || []);
      const first = buttons[0];
      const last = buttons.at(-1);
      if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) {
        event.preventDefault(); first?.focus();
      }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      opener.current?.focus({ preventScroll: true });
    };
  }, [active]);

  const open = (index: number, button: HTMLButtonElement) => { opener.current = button; setActive(index); setScale(1); setOffset({ x: 0, y: 0 }); setDragging(false); setFailedDeliveryUrl(null); setFullImageState("loading"); drag.current = null; };
  const zoom = (delta: number) => setScale((value) => Math.min(4, Math.max(0.5, Number((value + delta).toFixed(2)))));
  const current = active === null ? null : assets[active];
  const currentDelivery = current && failedDeliveryUrl !== current.url ? readingImageUrl(current.url) : undefined;

  return (
    <>
      <div className={assets.length > 1 ? "grid gap-4 sm:grid-cols-2" : "grid gap-4"}>
        {assets.map((asset, index) => (
          <figure key={asset.url} className="overflow-hidden rounded-xl border bg-muted">
            <button type="button" className="block w-full cursor-zoom-in focus-visible:outline-offset-[-3px]" onClick={(event) => open(index, event.currentTarget)} aria-label={`放大查看：${asset.alt}`}>
              <KnowledgeReadingImage url={asset.url} optimizedUrl={readingImageUrl(asset.url)} alt={asset.alt} width={asset.width} height={asset.height} />
            </button>
            {asset.caption ? <figcaption className="border-t px-3 py-2 text-xs text-muted-foreground">{asset.caption}</figcaption> : null}
          </figure>
        ))}
      </div>
      {current ? (
        <div ref={dialog} className="fixed inset-0 z-[120] grid min-w-0 grid-rows-[auto_1fr] overflow-hidden bg-black/85 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={current.alt} onMouseDown={(event) => { if (event.target === event.currentTarget) setActive(null); }}>
          <div className="mx-auto flex min-w-0 w-full max-w-6xl items-center justify-between gap-3 rounded-lg bg-black/55 px-3 py-2 text-white">
            <p className="min-w-0 flex-1 truncate text-sm">{current.caption.startsWith(current.alt) ? current.caption : `${current.alt}${current.caption ? ` · ${current.caption}` : ""}`}</p>
            <div className="flex shrink-0 items-center gap-1">
              <button type="button" className="grid size-11 place-items-center rounded-md hover:bg-white/15 disabled:opacity-40" onClick={() => zoom(-0.25)} disabled={scale <= 0.5} aria-label="缩小"><MagnifyingGlassMinus aria-hidden size={20} /></button>
              <output className="w-12 text-center text-xs tabular-nums" aria-live="polite">{Math.round(scale * 100)}%</output>
              <button type="button" className="grid size-11 place-items-center rounded-md hover:bg-white/15 disabled:opacity-40" onClick={() => zoom(0.25)} disabled={scale >= 4} aria-label="放大"><MagnifyingGlassPlus aria-hidden size={20} /></button>
              <button ref={closeButton} type="button" className="ml-1 grid size-11 place-items-center rounded-md hover:bg-white/15" onClick={() => setActive(null)} aria-label="关闭图片查看器"><X aria-hidden size={21} /></button>
            </div>
          </div>
          <div className="relative min-h-0 overflow-hidden touch-none" onWheel={(event) => { event.preventDefault(); zoom(event.deltaY < 0 ? 0.25 : -0.25); }}>
            {fullImageState !== "loaded" ? <p className="pointer-events-none absolute inset-0 grid place-items-center p-4 text-center text-sm text-white" aria-live="polite">{fullImageState === "error" ? "原图暂时无法载入，请稍后重试或查看原书 PDF。" : "正在载入原图…"}</p> : null}
            <picture>
            {currentDelivery ? <source type="image/webp" srcSet={currentDelivery} /> : null}
            <img src={current.url} alt="" draggable={false} onLoad={() => setFullImageState("loaded")} onError={() => { if (currentDelivery) setFailedDeliveryUrl(current.url); else setFullImageState("error"); }} className="absolute left-1/2 top-1/2 max-h-[86vh] max-w-[92vw] select-none object-contain will-change-transform" style={{ transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${scale})`, cursor: dragging ? "grabbing" : scale > 1 ? "grab" : "zoom-in" }} onDoubleClick={() => zoom(scale > 1 ? 1 - scale : 1)} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, originX: offset.x, originY: offset.y }; setDragging(true); }} onPointerMove={(event) => { const state = drag.current; if (!state || state.id !== event.pointerId) return; setOffset({ x: state.originX + event.clientX - state.x, y: state.originY + event.clientY - state.y }); }} onPointerUp={(event) => { if (drag.current?.id === event.pointerId) { drag.current = null; setDragging(false); } }} onPointerCancel={() => { drag.current = null; setDragging(false); }} />
            </picture>
          </div>
        </div>
      ) : null}
    </>
  );
}
