import Link from "next/link";
import type { PublicProfile } from "@wavekb/domain";
import { AvatarFrame, IdentityName, IdentityTitle, Nameplate } from "@/components/nameplate";

export function ResearchAuthor({ profile, createdAt, updatedAt }: {
  profile: PublicProfile | null;
  createdAt: string;
  updatedAt?: string;
}) {
  const edited = updatedAt && new Date(updatedAt).getTime() - new Date(createdAt).getTime() > 5_000;
  const identity = (
    <>
      <AvatarFrame profile={profile ?? { display_name: "波浪研究者", avatar_url: null, nameplate_style: "classic" }} size="medium" />
      <span className="grid min-w-0 gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <IdentityName profile={profile ?? { display_name: "波浪研究者", nameplate_style: "classic" }} className="truncate text-base font-semibold" />
          {profile?.public_uid ? <Nameplate uid={profile.public_uid} style={profile.nameplate_style} compact /> : null}
          <IdentityTitle title={profile?.display_title} />
        </span>
        <span className="text-xs text-muted-foreground">
          <time dateTime={createdAt}>{new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(createdAt))}</time>
          {edited ? <span> · 已编辑</span> : null}
        </span>
      </span>
    </>
  );
  return profile?.public_uid ? <Link href={`/member/${profile.public_uid}`} className="flex w-fit items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{identity}</Link> : <span className="flex items-center gap-3">{identity}</span>;
}
