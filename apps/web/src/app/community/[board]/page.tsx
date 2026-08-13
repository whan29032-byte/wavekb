import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PencilSimpleLine } from "@phosphor-icons/react/dist/ssr";
import { BOARD_SLUGS, BOARDS, isBoardSlug } from "@wavekb/domain";
import { Button } from "@wavekb/ui";
import { EmptyBoard } from "@/components/empty-board";
import { PostCard } from "@/components/post-card";
import { publicSupabaseConfig } from "@/lib/env";
import { listPosts } from "@/lib/community/server-repository";

type PageProps = { params: Promise<{ board: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return BOARD_SLUGS.map((board) => ({ board }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { board } = await params;
  return isBoardSlug(board) ? { title: BOARDS[board].title, description: BOARDS[board].description } : {};
}

export default async function BoardPage({ params }: PageProps) {
  const { board } = await params;
  if (!isBoardSlug(board)) notFound();
  const posts = await listPosts(board);
  const configured = publicSupabaseConfig().configured;

  return (
    <main className="mx-auto grid max-w-5xl gap-8 px-4 py-10 md:px-6 md:py-14">
      <header className="grid gap-5 md:grid-cols-[1fr_auto] md:items-end">
        <div className="grid gap-2">
          <h1 className="text-3xl font-semibold tracking-[-0.035em] md:text-4xl">{BOARDS[board].title}</h1>
          <p className="max-w-[62ch] text-sm leading-6 text-muted-foreground md:text-base">{BOARDS[board].description}</p>
        </div>
        <Button asChild>
          <Link href={`/community/${board}/new`}><PencilSimpleLine aria-hidden size={18} />发布内容</Link>
        </Button>
      </header>
      <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="社区板块">
        {Object.entries(BOARDS).map(([slug, value]) => (
          <Link key={slug} href={`/community/${slug}`} aria-current={slug === board ? "page" : undefined} className={`shrink-0 rounded-lg px-3 py-2 text-sm font-medium ${slug === board ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
            {value.title}
          </Link>
        ))}
      </nav>
      {posts.length ? <div className="grid gap-3">{posts.map((post) => <PostCard key={post.id} post={post} />)}</div> : <EmptyBoard board={board} configured={configured} />}
    </main>
  );
}
