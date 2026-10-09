"use client";

import { useEffect, useRef, useState } from "react";

type ReadingImageProps = {
  url: string;
  optimizedUrl?: string;
  alt: string;
  width: number;
  height: number;
};

/** Keeps the source identity in the DOM without eagerly downloading adjacent scans. */
export function KnowledgeReadingImage(props: ReadingImageProps) {
  return <ViewportReadingImage key={props.url} {...props} />;
}

function ViewportReadingImage({ url, optimizedUrl, alt, width, height }: ReadingImageProps) {
  const frame = useRef<HTMLSpanElement>(null);
  const [requested, setRequested] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [optimizedFailed, setOptimizedFailed] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const target = frame.current;
    if (!target) return;
    const revealWithoutObserver = () => {
      let mounted = true;
      queueMicrotask(() => { if (mounted) setRequested(true); });
      return () => { mounted = false; };
    };
    if (typeof IntersectionObserver === "undefined") {
      return revealWithoutObserver();
    }
    try {
      const observer = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.target === target && entry.isIntersecting)) return;
        setRequested(true);
        observer.disconnect();
      }, { rootMargin: "120px 0px" });
      observer.observe(target);
      return () => observer.disconnect();
    } catch {
      // Do not make source material unreadable in partial browser/polyfill
      // implementations that expose an unusable observer constructor.
      return revealWithoutObserver();
    }
  }, []);

  const useOptimized = Boolean(requested && optimizedUrl && !optimizedFailed);
  const status = failed ? "error" : loaded ? "loaded" : requested ? "loading" : "waiting";

  return (
    <span ref={frame} className="knowledge-reading-image relative block w-full" style={{ aspectRatio: `${width} / ${height}` }} data-reading-image data-reading-image-state={status} aria-busy={requested && !loaded && !failed}>
      {/* The original src and dimensions remain auditable. Only the same-size
          lossless derivative is selected after this frame enters the viewport. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} srcSet={useOptimized ? optimizedUrl : undefined} alt={alt} width={width} height={height} loading={requested ? "eager" : "lazy"} decoding="async" fetchPriority={requested ? "high" : "low"} className="h-auto w-full object-contain" style={{ display: requested ? "block" : "none" }} onLoad={() => { setLoaded(true); setFailed(false); }} onError={() => {
        if (useOptimized) {
          // A missing/unsupported derivative gets one ordinary original-file
          // fallback, not a loop of retries or an invented success state.
          setOptimizedFailed(true);
        } else {
          setFailed(true);
        }
      }} />
      {!loaded ? <span className="knowledge-reading-image-feedback pointer-events-none absolute inset-0 grid place-items-center px-4 text-center text-xs text-muted-foreground" role={requested ? "status" : undefined}>
        {failed ? "图片加载失败，点击查看原图。" : requested ? "正在载入原图…" : "滚动到此处后加载原图"}
      </span> : null}
      <noscript><style>{".knowledge-reading-image > img { display: block !important; } .knowledge-reading-image-feedback { display: none !important; }"}</style></noscript>
    </span>
  );
}
