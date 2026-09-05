import Link from "next/link";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import { notFound } from "next/navigation";
import { BOARDS } from "@wavekb/domain";
import { PostOwnerActions } from "@/components/post-owner-actions";
import { PostComments } from "@/components/post-comments";
import { Pagination } from "@/components/pagination";
import { parsePage } from "@/lib/pagination";
import { ResearchAuthor } from "@/components/research-author";
import { ResearchBody } from "@/components/research-body";
import { ResearchLightbox } from "@/components/research-lightbox";
import { ResearchMedia } from "@/components/research-media";
import { ResearchTimeline } from "@/components/research-timeline";
import { getPost, listPostComments } from "@/lib/community/server-repository";
import { publicPostImageUrl } from "@/lib/env";
import { getCurrentUser } from "@/lib/auth/dal";
import { getMyProfile } from "@/lib/member/server-repository";
import { tradingViewEmbedUrl, type TradingViewPackage } from "@/lib/workbench/tradingview";

type PageProps = { params: Promise<{ id: string }>; searchParams?: Promise<{ page?: string | string[] }> };

const RESEARCH_GENRE = {
  case_submission: "案例研究",
  idea_sharing: "市场观点",
  public_viewpoint: "公开观点",
  question_answers: "问题讨论",
  review_answers: "复盘讨论",
} as const;

export const dynamic = "force-dynamic";

export default async function PostPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const page = parsePage((await searchParams)?.page);
  const [post, comments] = await Promise.all([getPost(id), listPostComments(id, page)]);
  if (!post || post.status === "hidden") notFound();
  const user = await getCurrentUser();
  const actorProfile = user ? await getMyProfile(user.id).catch(() => null) : null;
  const images = [...post.post_images].sort((a, b) => a.sort_order - b.sort_order);
  const chart = post.chart_package?.provider === "tradingview" ? post.chart_package as TradingViewPackage : null;

  return (
    <main className="mx-auto grid max-w-7xl gap-8 px-4 py-8 md:px-6 md:py-12">
      <Link href={`/community/${post.board}`} className="inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground hover:text-primary">
        <ArrowLeft aria-hidden size={17} />返回{BOARDS[post.board].title}
      </Link>
      <article className="grid gap-12 md:gap-16">
        <header className="mx-auto grid w-full max-w-4xl gap-6 border-b pb-8 md:pb-10">
          <p className="text-sm font-semibold tracking-[0.08em] text-primary">{BOARDS[post.board].title} · {RESEARCH_GENRE[post.board]}</p>
          <h1 className="max-w-[20ch] text-[clamp(1.875rem,5vw,3rem)] font-semibold leading-[1.12] tracking-[-0.04em] text-balance">{post.title}</h1>
          <ResearchAuthor profile={post.profiles} createdAt={post.created_at} updatedAt={post.updated_at} />
        </header>
        <section className="mx-auto w-full max-w-4xl" aria-label="正文观点"><ResearchBody body={post.body} /></section>
        {chart?.symbol ? <section className="research-section" aria-labelledby="post-chart-title"><header className="research-section-heading"><p>实时参考</p><h2 id="post-chart-title">TradingView 图表</h2><span>{chart.symbol} · {chart.interval}</span></header><iframe title={`${chart.symbol} TradingView 图表`} src={tradingViewEmbedUrl(chart)} className="aspect-video min-h-[420px] w-full rounded-xl border bg-muted max-md:min-h-[300px]" loading="lazy" referrerPolicy="no-referrer" /></section> : null}
        {images.length ? (
          <section className="research-section" aria-labelledby="post-images-title">
            <header className="research-section-heading"><p>核心证据</p><h2 id="post-images-title">研究图表</h2><span>点击图片可放大、切换并查看原图。</span></header>
            <ResearchLightbox assets={images.map((image, index) => ({ id: image.id, url: publicPostImageUrl(image.storage_path), alt: `${post.title}，图片 ${index + 1}`, caption: image.caption }))} />
          </section>
        ) : null}
        <div className="mx-auto grid w-full max-w-4xl gap-12 md:gap-16">
          <ResearchMedia references={post.external_references} />
          <ResearchTimeline postId={post.id} createdAt={post.created_at} nodes={post.timeline_nodes} author={post.profiles} actorId={user?.id === post.author_id ? user.id : undefined} />
          {user?.id === post.author_id ? <PostOwnerActions post={post} userId={user.id} /> : null}
        </div>
      </article>
      <div className="mx-auto grid w-full max-w-4xl gap-5"><PostComments key={`${post.id}:${page}`} postId={post.id} comments={comments.items} actorId={user?.id} actorProfile={actorProfile} activeMember={actorProfile?.public_uid != null} commentsEnabled={post.comments_enabled} /><Pagination page={page} hasNext={comments.hasNext} pathname={`/community/post/${id}`} /></div>
    </main>
  );
}
