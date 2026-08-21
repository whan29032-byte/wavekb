import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MemberProfileActions } from "@/components/member-profile-actions";
import { PostCard } from "@/components/post-card";
import { getOptionalActiveMember } from "@/lib/auth/dal";
import { listPostsByAuthor } from "@/lib/community/server-repository";
import { getMemberProfileByUid, getMemberSocialState, getMyPersonalSpaceSummary } from "@/lib/member/server-repository";
import { AvatarFrame, IdentityName, IdentityTitle, Nameplate } from "@/components/nameplate";

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
  const [actor, profile] = await Promise.all([
    getOptionalActiveMember(),
    getMemberProfileByUid(Number(uid)),
  ]);
  if (!profile) notFound();
  const [posts, social] = await Promise.all([
    listPostsByAuthor(profile.id),
    actor ? getMemberSocialState(actor.id, profile.id) : Promise.resolve({ following: false, connection: null }),
  ]);
  const boardCount = new Set(posts.map((post) => post.board)).size;
  const isSelf = actor?.id === profile.id;
  const personal = isSelf && actor ? await getMyPersonalSpaceSummary(actor.id) : null;

  return (
    <main className="mx-auto grid max-w-5xl gap-6 px-4 py-8 md:px-6 md:py-12">
      <section className="profile-hero" data-profile-hero>
        <div className={`profile-hero-cover ${coverClasses[profile.cover_style] || coverClasses["chart-dark"]}`} data-profile-cover aria-hidden>
          {profile.cover_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.cover_url} alt="" className="h-full w-full object-cover" />
          ) : null}
        </div>
        <div className="profile-hero-body">
          <div className="profile-hero-identity" data-profile-identity>
            <div className="profile-hero-avatar-column" data-profile-avatar><AvatarFrame profile={profile} size="large" />{personal ? <span className="profile-hero-points">研究积分 {personal.points.toLocaleString("zh-CN")}</span> : null}</div>
            <div className="profile-hero-copy">
              <IdentityTitle title={profile.display_title || "波浪研究者"} />
              <IdentityName profile={profile} as="h1" className="truncate text-2xl font-semibold tracking-[-0.025em] md:text-3xl" />
              <Nameplate uid={profile.public_uid} style={profile.nameplate_style} />
              <p className="identity-effect max-w-[62ch] text-sm leading-6 text-muted-foreground" data-nameplate={profile.nameplate_style}>{profile.bio || "这位研究者还没有填写个人签名。"}</p>
            </div>
          </div>
          <div className="profile-hero-actions" data-profile-actions>
            <MemberProfileActions actorId={actor?.id ?? null} profileId={profile.id} initialFollowing={social.following} initialConnection={social.connection} profile={profile} />
          </div>
        </div>
      </section>

      {personal ? <section className="grid grid-cols-2 divide-x divide-y rounded-xl border bg-surface sm:grid-cols-4 sm:divide-y-0" aria-label="个人研究统计">{[["复盘", personal.reviews], ["交易日记", personal.journals], ["研究草稿", personal.drafts], ["交易分析", personal.analyses]].map(([label, value]) => <div key={label} className="grid gap-1 p-4 text-center"><strong className="text-xl tabular-nums">{value}</strong><span className="text-xs text-muted-foreground">{label}</span></div>)}</section> : null}

      <section className="grid grid-cols-3 divide-x rounded-xl border bg-surface" aria-label="公开资料摘要">
        {[["公开内容", posts.length], ["参与板块", boardCount], ["身份样式", profile.nameplate_style === "classic" ? "经典" : "已装配"]].map(([label, value]) => (
          <div key={label} className="grid gap-1 p-4 text-center md:p-5"><strong className="text-xl font-semibold">{value}</strong><span className="text-xs text-muted-foreground">{label}</span></div>
        ))}
      </section>

      <section className="grid gap-4" aria-labelledby="member-posts-title">
        <header className="grid gap-1">
          <h2 id="member-posts-title" className="text-2xl font-semibold tracking-tight">{isSelf ? "我的公开研究" : "公开研究"}</h2>
          <p className="text-sm text-muted-foreground">只展示已发布内容，私人复盘、日记和草稿不会出现在这里。</p>
        </header>
        {posts.length ? <div className="grid gap-3">{posts.map((post) => <PostCard key={post.id} post={post} />)}</div> : <div className="rounded-xl border border-dashed bg-surface p-7 text-sm text-muted-foreground">这位研究者还没有公开内容。</div>}
      </section>
    </main>
  );
}
