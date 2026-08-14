"use client";

import { useState } from "react";

export function DirectoryAvatar({ src, fallback, name }: { src: string | null; fallback: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-full border bg-muted text-sm font-bold text-primary">{fallback}</span>;
  // External administrator-managed URLs are intentionally rendered without Next image optimization.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={`${name}头像`} loading="lazy" referrerPolicy="no-referrer" className="size-12 shrink-0 rounded-full border bg-muted object-cover" onError={() => setFailed(true)} />;
}
