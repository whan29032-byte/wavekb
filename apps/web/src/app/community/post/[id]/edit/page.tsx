import { notFound } from "next/navigation";
import { BOARDS } from "@wavekb/domain";
import { PostComposer } from "@/components/post-composer";
import { getPost } from "@/lib/community/server-repository";
import { requireActiveMember } from "@/lib/auth/dal";

type PageProps = { params: Promise<{ id: string }> };

export default async function EditPostPage({ params }: PageProps) {
  const { id } = await params;
  const [user, post] = await Promise.all([requireActiveMember(`/community/post/${id}/edit`), getPost(id)]);
  if (!post || post.author_id !== user.id || post.status === "hidden") notFound();

  return (
    <main className="mx-auto grid max-w-4xl gap-7 px-4 py-10 md:px-6 md:py-14">
      <header className="grid gap-2">
        <h1 className="text-3xl font-semibold tracking-[-0.035em]">编辑「{post.title}」</h1>
        <p className="text-sm leading-6 text-muted-foreground">帖子仍属于{BOARDS[post.board].title}。保存时会重新校验正文、图片和外部链接。</p>
      </header>
      <PostComposer board={post.board} userId={user.id} post={post} />
    </main>
  );
}
