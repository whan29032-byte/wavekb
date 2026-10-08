"use client";

/* eslint-disable @next/next/no-img-element -- Mentor avatars use existing Supabase and administrator-provided URLs. */

import { useState } from "react";

type MentorAvatarProps = { name: string; url: string | null; size?: "medium" | "large" };

export function MentorAvatar({ name, url, size = "medium" }: MentorAvatarProps) {
  const source = url?.trim() || null;
  // Reset only this image's failure state when the profile supplies a new URL.
  // A late error from the previous image cannot hide the replacement avatar.
  return <MentorAvatarImage key={source || "empty"} name={name} url={source} size={size} />;
}

function MentorAvatarImage({ name, url, size = "medium" }: MentorAvatarProps) {
  const [failed, setFailed] = useState(false);
  const className = `${size === "large" ? "size-20 text-2xl" : "size-14 text-lg"} grid shrink-0 place-items-center overflow-hidden rounded-xl border bg-muted font-semibold text-primary`;
  if (!url || failed) return <span role="img" className={className} aria-label={`${name || "导师"}头像`}>{(name || "师").slice(0, 1)}</span>;
  return <span className={className}><img src={url} alt={`${name || "导师"}头像`} loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" onError={() => setFailed(true)} /></span>;
}
