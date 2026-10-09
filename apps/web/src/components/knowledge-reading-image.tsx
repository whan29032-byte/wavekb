"use client";

import { useEffect, useRef, useState } from "react";
import { cancelHiddenReadingImage, readingImageWorkerReady } from "@/lib/knowledge/reading-image-worker";
import { observeReadingImage } from "@/lib/knowledge/reading-image-scheduler";

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
  const visible = useRef(false);
  const completed = useRef(false);
  const attempt = useRef(0);
  const finishImage = useRef(() => {});
  const [generation, setGeneration] = useState(0);
  const [requested, setRequested] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [optimizedFailed, setOptimizedFailed] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const target = frame.current;
    if (!target) return;
    let mounted = true;
    let controller: AbortController | undefined;
    const requestImage = () => {
      if (!mounted || visible.current) return;
      visible.current = true;
      if (completed.current) return;
      const current = new AbortController();
      controller = current;
      const reveal = () => {
        if (!mounted || !visible.current || controller !== current || current.signal.aborted) return;
        setPreparing(false);
        setRequested(true);
      };
      const worker = readingImageWorkerReady(optimizedUrl, current.signal);
      if (!worker) { reveal(); return; }
      setPreparing(true);
      void worker.then(reveal, reveal);
    };
    const cancelPending = () => {
      const pending = Boolean(controller);
      visible.current = false;
      controller?.abort();
      controller = undefined;
      if (completed.current || !pending) return;
      cancelHiddenReadingImage(optimizedUrl);
      // A replacement hidden native element cannot turn a late abort error
      // from the previous request into a new original-PNG download on re-entry.
      attempt.current++;
      if (mounted) {
        setGeneration(attempt.current);
        setRequested(false);
        setPreparing(false);
        setLoaded(false);
        setFailed(false);
      }
    };
    const scheduled = observeReadingImage(target, { start: requestImage, cancel: cancelPending });
    finishImage.current = () => { controller = undefined; scheduled.finish(); };
    return () => {
      mounted = false;
      scheduled.dispose();
      cancelPending();
      finishImage.current = () => {};
    };
  }, [optimizedUrl]);

  const useOptimized = Boolean(requested && optimizedUrl && !optimizedFailed);
  const status = failed ? "error" : loaded ? "loaded" : requested || preparing ? "loading" : "waiting";

  return (
    <span ref={frame} className="knowledge-reading-image relative block w-full" style={{ aspectRatio: `${width} / ${height}` }} data-reading-image data-reading-image-state={status} aria-busy={(requested || preparing) && !loaded && !failed}>
      {/* The original src and dimensions remain auditable. Only the same-size
          lossless derivative is selected after this frame enters the viewport. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img key={generation} src={url} srcSet={useOptimized ? optimizedUrl : undefined} alt={alt} width={width} height={height} loading={requested ? "eager" : "lazy"} decoding="async" fetchPriority={requested ? "high" : "low"} className="h-auto w-full object-contain" style={{ display: requested ? "block" : "none" }} onLoad={() => {
        if (!visible.current || !requested || generation !== attempt.current) return;
        completed.current = true;
        finishImage.current();
        setLoaded(true);
        setFailed(false);
      }} onError={() => {
        if (!visible.current || !requested || generation !== attempt.current) return;
        if (useOptimized) {
          // A missing/unsupported derivative gets one ordinary original-file
          // fallback, not a loop of retries or an invented success state.
          setOptimizedFailed(true);
        } else {
          setFailed(true);
          finishImage.current();
        }
      }} />
      {!loaded ? <span className="knowledge-reading-image-feedback pointer-events-none absolute inset-0 grid place-items-center px-4 text-center text-xs text-muted-foreground" role={requested || preparing ? "status" : undefined}>
        {failed ? "图片加载失败，点击查看原图。" : requested || preparing ? "正在载入原图…" : "滚动到此处后加载原图"}
      </span> : null}
      <noscript><style>{".knowledge-reading-image > img { display: block !important; } .knowledge-reading-image-feedback { display: none !important; }"}</style></noscript>
    </span>
  );
}
