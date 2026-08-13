import { notFound } from "next/navigation";
import { BOARDS, isBoardSlug } from "@wavekb/domain";
import { PostComposer } from "@/components/post-composer";
import { publicSupabaseConfig } from "@/lib/env";
import { requireActiveMember } from "@/lib/auth/dal";
import { getPrivateEntry } from "@/lib/workbench/server-repository";

type PageProps = { params: Promise<{ board: string }>; searchParams: Promise<{ source?: string }> };

export default async function NewPostPage({ params, searchParams }: PageProps) {
  const { board } = await params;
  if (!isBoardSlug(board)) notFound();
  if (!publicSupabaseConfig().configured) {
    return (
      <main className="mx-auto grid max-w-3xl gap-3 px-4 py-16 md:px-6">
        <h1 className="text-2xl font-semibold">发布器尚未连接 Supabase</h1>
        <p className="text-sm leading-6 text-muted-foreground">配置 apps/web/.env.local 后即可登录和发布。旧站不受影响。</p>
      </main>
    );
  }
  const { source: sourceId } = await searchParams;
  const returnPath = `/community/${board}/new${sourceId ? `?source=${encodeURIComponent(sourceId)}` : ""}`;
  const user = await requireActiveMember(returnPath);
  const source = sourceId ? await getPrivateEntry(sourceId, user.id) : null;
  if (sourceId && !source) notFound();

  return (
    <main className="mx-auto grid max-w-4xl gap-7 px-4 py-10 md:px-6 md:py-14">
      <header className="grid gap-2">
        <h1 className="text-3xl font-semibold tracking-[-0.035em]">发布到「{BOARDS[board].title}」</h1>
        <p className="max-w-[65ch] text-sm leading-6 text-muted-foreground">先写清判断，再补充规则依据、图片和可选的外部引用。</p>
      </header>
      <PostComposer board={board} userId={user.id} source={source ?? undefined} />
    </main>
  );
}
