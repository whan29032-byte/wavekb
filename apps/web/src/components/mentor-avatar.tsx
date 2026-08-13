/* eslint-disable @next/next/no-img-element -- Mentor avatars use existing Supabase and administrator-provided URLs. */

export function MentorAvatar({ name, url, size = "medium" }: { name: string; url: string | null; size?: "medium" | "large" }) {
  const className = `${size === "large" ? "size-20 text-2xl" : "size-14 text-lg"} grid shrink-0 place-items-center overflow-hidden rounded-xl border bg-muted font-semibold text-primary`;
  if (!url) return <span className={className} aria-label={`${name || "导师"}头像`}>{(name || "师").slice(0, 1)}</span>;
  return <span className={className}><img src={url} alt={`${name || "导师"}头像`} className="h-full w-full object-cover" /></span>;
}
