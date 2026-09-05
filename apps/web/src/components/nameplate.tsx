import type { PublicProfile } from "@wavekb/domain";

const premiumStyles = new Set(["premium", "blackgold", "platinum", "purplegold", "rainbow", "newyear"]);

function normalizedStyle(style: string | undefined) {
  return premiumStyles.has(String(style)) ? String(style) : "classic";
}

export function Nameplate({ uid, style, compact = false, preview = false }: { uid: number | null | undefined; style?: string; compact?: boolean; preview?: boolean }) {
  const resolved = normalizedStyle(style);
  const label = uid ?? (preview ? "•••••" : "未设置");
  return (
    <span className="identity-nameplate" data-nameplate={resolved} data-compact={compact || undefined} aria-label={preview && !uid ? "铭牌样式预览" : `UID ${label}`}>
      {resolved !== "classic" ? <span className="identity-liang" aria-hidden>靓</span> : null}
      <span className="identity-uid">UID {label}</span>
      {resolved === "blackgold" ? <span className="identity-drive-wave" aria-hidden /> : null}
    </span>
  );
}

export type IdentityPreviewProfile = Pick<PublicProfile, "public_uid" | "display_name" | "avatar_url" | "nameplate_style" | "display_title">;

export function IdentityPreview({ style, profile }: { style: string; profile?: IdentityPreviewProfile }) {
  const identity = { display_name: profile?.display_name || "效果预览", avatar_url: profile?.avatar_url ?? null, nameplate_style: style };
  return <div className="flex min-w-0 items-center gap-3 rounded-lg border bg-surface p-3" aria-label="铭牌效果预览"><AvatarFrame profile={identity} /><div className="grid min-w-0 gap-1"><IdentityName profile={identity} className="truncate text-sm font-semibold" /><Nameplate uid={profile?.public_uid} style={style} preview /><span className="text-xs text-muted-foreground">头像框、昵称与 UID 同步效果</span></div></div>;
}

export function IdentityName({ profile, as: Tag = "span", className = "" }: { profile: Pick<PublicProfile, "display_name" | "nameplate_style">; as?: "span" | "strong" | "h1" | "h2"; className?: string }) {
  return <Tag className={`identity-effect ${className}`.trim()} data-nameplate={normalizedStyle(profile.nameplate_style)}>{profile.display_name || "波浪研究者"}</Tag>;
}

export function IdentityTitle({ title }: { title?: string | null }) {
  if (!title) return null;
  return <span className="identity-title">{title}</span>;
}

export function AvatarFrame({ profile, size = "medium", className = "" }: { profile: Pick<PublicProfile, "display_name" | "avatar_url" | "nameplate_style">; size?: "small" | "medium" | "large"; className?: string }) {
  const fallback = (profile.display_name || "研").trim().slice(0, 1);
  return (
    <span className={`identity-avatar-frame ${className}`.trim()} data-nameplate={normalizedStyle(profile.nameplate_style)} data-size={size}>
      {profile.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={profile.avatar_url} alt={`${profile.display_name}的头像`} />
      ) : <span aria-hidden>{fallback}</span>}
    </span>
  );
}
