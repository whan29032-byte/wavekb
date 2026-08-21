"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowSquareOut, MagnifyingGlassMinus, MagnifyingGlassPlus, X } from "@phosphor-icons/react";

export type ResearchImageAsset = { id: string; url: string; alt: string; caption?: string };

export function ResearchLightbox({ assets, className = "" }: { assets: ResearchImageAsset[]; className?: string }) {
  const [active, setActive] = useState<number | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ id: number; x: number; y: number; originX: number; originY: number } | null>(null);
  const open = (index: number) => { setActive(index); setScale(1); setOffset({ x: 0, y: 0 }); };
  const move = (delta: number) => active !== null && open((active + delta + assets.length) % assets.length);
  const zoom = (delta: number) => setScale((value) => Math.min(4, Math.max(0.5, Number((value + delta).toFixed(2)))));

  useEffect(() => {
    if (active === null) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActive(null);
      if (event.key === "ArrowLeft" && assets.length > 1) move(-1);
      if (event.key === "ArrowRight" && assets.length > 1) move(1);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", keydown);
    return () => { document.body.style.overflow = ""; window.removeEventListener("keydown", keydown); };
  });

  const current = active === null ? null : assets[active];
  return (
    <>
      <div className={className || "grid gap-6"} role="region" aria-label={`研究图片，共 ${assets.length} 张`}>
        {assets.map((asset, index) => (
          <figure key={asset.id} className="overflow-hidden rounded-xl border bg-muted/35">
            <button type="button" className="block w-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" onClick={() => open(index)} aria-label={`放大查看：${asset.alt}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={asset.url} alt={asset.alt} loading="lazy" className="h-auto max-h-[780px] w-full object-contain" />
            </button>
            {asset.caption ? <figcaption className="border-t px-4 py-3 text-sm text-muted-foreground">图 {index + 1} · {asset.caption}</figcaption> : null}
          </figure>
        ))}
      </div>
      {current ? (
        <div className="fixed inset-0 z-[120] grid grid-rows-[auto_1fr] bg-black/90 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={current.alt}>
          <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 rounded-lg bg-black/55 px-3 py-2 text-white">
            <p className="min-w-0 truncate text-sm">{current.caption || current.alt}</p>
            <div className="flex shrink-0 items-center gap-1">
              {assets.length > 1 ? <button type="button" className="grid size-10 place-items-center rounded-md hover:bg-white/15 sm:size-11" onClick={() => move(-1)} aria-label="上一张"><ArrowLeft aria-hidden size={20} /></button> : null}
              <button type="button" className="grid size-10 place-items-center rounded-md hover:bg-white/15 disabled:opacity-40 sm:size-11" onClick={() => zoom(-0.25)} disabled={scale <= 0.5} aria-label="缩小"><MagnifyingGlassMinus aria-hidden size={20} /></button>
              <output className="w-10 text-center text-xs tabular-nums sm:w-12">{Math.round(scale * 100)}%</output>
              <button type="button" className="grid size-10 place-items-center rounded-md hover:bg-white/15 disabled:opacity-40 sm:size-11" onClick={() => zoom(0.25)} disabled={scale >= 4} aria-label="放大"><MagnifyingGlassPlus aria-hidden size={20} /></button>
              {assets.length > 1 ? <button type="button" className="grid size-10 place-items-center rounded-md hover:bg-white/15 sm:size-11" onClick={() => move(1)} aria-label="下一张"><ArrowRight aria-hidden size={20} /></button> : null}
              <a href={current.url} target="_blank" rel="noopener noreferrer" className="grid size-10 place-items-center rounded-md hover:bg-white/15 sm:size-11" aria-label="查看原图"><ArrowSquareOut aria-hidden size={20} /></a>
              <button type="button" className="grid size-10 place-items-center rounded-md hover:bg-white/15 sm:size-11" onClick={() => setActive(null)} aria-label="关闭图片查看器"><X aria-hidden size={21} /></button>
            </div>
          </div>
          <div className="relative min-h-0 overflow-hidden touch-none" onWheel={(event) => { event.preventDefault(); zoom(event.deltaY < 0 ? 0.25 : -0.25); }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={current.url} alt="" draggable={false} className="absolute left-1/2 top-1/2 max-h-[86vh] max-w-[94vw] select-none object-contain will-change-transform" style={{ transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${scale})`, cursor: scale > 1 ? "grab" : "zoom-in" }} onDoubleClick={() => setScale((value) => value > 1 ? 1 : 2)} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, originX: offset.x, originY: offset.y }; }} onPointerMove={(event) => { const state = drag.current; if (state?.id === event.pointerId) setOffset({ x: state.originX + event.clientX - state.x, y: state.originY + event.clientY - state.y }); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} />
          </div>
        </div>
      ) : null}
    </>
  );
}
