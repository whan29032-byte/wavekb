import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IdentificationCard } from "@phosphor-icons/react/dist/ssr";
import { MemberProfileActions } from "@/components/member-profile-actions";
import { PostCard } from "@/components/post-card";
import { requireCurrentUser } from "@/lib/auth/dal";
import { listPostsByAuthor } from "@/lib/community/server-repository";
import { legacySiteUrl } from "@/lib/env";
import { getMemberProfileByUid, getMemberSocialState } from "@/lib/member/server-repository";

type PageProps = { params: Promise<{ uid: string }> };

const coverClasses = {
  "chart-dark": "bg-slate-800",
  "wave-blue": "bg-blue-800",
  paper: "bg-stone-300",
  midnight: "bg-indigo-950",
} as const;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { uid } = await params;
  return { title: /^\d{5,6}$/.test(uid) ? `UID ${uid} 的公开主页` : "用户主页" };
}

export default async function MemberProfilePage({ params }: PageProps) {
  const { uid } = await params;
  if (!/^\d{5,6}$/.test(uid)) notFound();
  const actor = await requireCurrentUser(`/member/${uid}`);
  const profile = await getMemberProfileByUid(Number(uid));
  if (!profile) notFound();
  const [posts, social] = await Promise.all([
    listPostsByAuthor(profile.id),
    getMemberSocialState(actor.id, profile.id),
  ]);
  const boardCount = new Set(posts.map((post) => post.board)).size;
  const avatarFallback = (profile.display_name || "研").trim().slice(0, 1);

  return (
    <main className="mx-auto grid max-w-5xl gap-6 px-4 py-10 md:px-6 md:py-14">
      <section className="overflow-hidden rounded-xl border bg-surface">
        <div className={`relative h-36 overflow-hidden md:h-48 ${coverClasses[profile.cover_style] || coverClasses["chart-dark"]}`} aria-hidden>
          {profile.cover_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.cover_url} alt="" className="h-full w-full object-cover" />
          ) : null}
        </div>
        <div className="grid gap-6 p-5 md:grid-cols-[1fr_auto] md:items-end md:p-8">
          <div className="flex min-w-0 items-start gap-4">
            {profile.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatar_url} alt={`${profile.display_name}的头像`} className="-mt-14 size-24 shrink-0 rounded-xl border-4 border-surface bg-muted object-cover md:-mt-20 md:size-32" />
            ) : (
              <div className="-mt-14 grid size-24 shrink-0 place-items-center rounded-xl border-4 border-surface bg-muted text-3xl font-semibold md:-mt-20 md:size-32">{avatarFallback}</div>
            )}
            <div className="grid min-w-0 gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">{profile.display_title || "波浪研究者"}</p>
              <h1 className="truncate text-3xl font-semibold tracking-[-0.035em]">{profile.display_name || "波浪研究者"}</h1>
              <p className="flex items-center gap-2 text-sm text-muted-foreground"><IdentificationCard aria-hidden size={18} />UID {profile.public_uid}</p>
              <p className="max-w-[62ch] text-sm leading-6 text-muted-foreground">{profile.bio || "这位研究者还没有填写个人签名。"}</p>
            </div>
          </div>
          <MemberProfileActions actorId={actor.id} profileId={profile.id} profileUid={profile.public_uid || Number(uid)} initialFollowing={social.following} initialConnection={social.connection} legacySite={legacySiteUrl()} />
        </div>
      </section>

      <section className="grid grid-cols-3 divide-x rounded-xl border bg-surface" aria-label="公开资料摘要">
        {[["公开内容", posts.length], ["参与板块", boardCount], ["身份样式", profile.nameplate_style === "classic" ? "经典" : "已装配"]].map(([label, value]) => (
          <div key={label} className="grid gap-1 p-4 text-center md:p-5"><strong className="text-xl font-semibold">{value}</strong><span className="text-xs text-muted-foreground">{label}</span></div>
        ))}
      </section>

      <section className="grid gap-4" aria-labelledby="member-posts-title">
        <header className="grid gap-1">
          <h2 id="member-posts-title" className="text-2xl font-semibold tracking-tight">公开研究</h2>
          <p className="text-sm text-muted-foreground">只展示已发布内容，私人复盘、日记和草稿不会出现在这里。</p>
        </header>
        {posts.length ? <div className="grid gap-3">{posts.map((post) => <PostCard key={post.id} post={post} />)}</div> : <div className="rounded-xl border border-dashed bg-surface p-7 text-sm text-muted-foreground">这位研究者还没有公开内容。</div>}
      </section>
    </main>
  );
}
