import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PencilSimpleLine } from "@phosphor-icons/react/dist/ssr";
import { BOARD_SLUGS, BOARDS, isBoardSlug } from "@wavekb/domain";
import { Button, PageHeader } from "@wavekb/ui";
import { EmptyBoard } from "@/components/empty-board";
import { PostCard } from "@/components/post-card";
import { Pagination } from "@/components/pagination";
import { parsePage } from "@/lib/pagination";
import { publicSupabaseConfig } from "@/lib/env";
import { listPosts } from "@/lib/community/server-repository";
import { publicPageMetadata } from "@/lib/public-page-metadata";

type PageProps = { params: Promise<{ board: string }>; searchParams?: Promise<{ page?: string | string[] }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return BOARD_SLUGS.map((board) => ({ board }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { board } = await params;
  return publicPageMetadata("community", board);
}

export default async function BoardPage({ params, searchParams }: PageProps) {
  const { board } = await params;
  if (!isBoardSlug(board)) notFound();
  const page = parsePage((await searchParams)?.page);
  const result = await listPosts(board, 20, page);
  const posts = result.items;
  const configured = publicSupabaseConfig().configured;

  return (
    <main className="mx-auto grid max-w-5xl gap-8 px-4 py-10 md:px-6 md:py-14">
      <PageHeader
        eyebrow="Community"
        title={BOARDS[board].title}
        description={BOARDS[board].description}
        actions={<Button asChild><Link href={`/community/${board}/new`}><PencilSimpleLine aria-hidden size={18} />发布内容</Link></Button>}
      />
      <nav className="flex gap-1 overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface p-1.5 shadow-[var(--shadow-xs)]" aria-label="社区板块">
        {Object.entries(BOARDS).map(([slug, value]) => (
          <Link key={slug} href={`/community/${slug}`} aria-current={slug === board ? "page" : undefined} className={`shrink-0 rounded-[var(--radius-control)] px-3 py-2 text-sm font-medium transition-colors ${slug === board ? "bg-primary text-primary-foreground shadow-[var(--shadow-xs)]" : "text-muted-foreground hover:bg-surface-subtle hover:text-foreground"}`}>
            {value.title}
          </Link>
        ))}
      </nav>
      {posts.length ? <div className="grid gap-3">{posts.map((post) => <PostCard key={post.id} post={post} />)}</div> : <EmptyBoard board={board} configured={configured} />}
      <Pagination page={page} hasNext={result.hasNext} pathname={`/community/${board}`} />
    </main>
  );
}
