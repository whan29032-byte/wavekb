import Link from "next/link";
import { ArrowLeft, ImageSquare } from "@phosphor-icons/react/dist/ssr";
import { notFound } from "next/navigation";
import { BOARDS } from "@wavekb/domain";
import { PostOwnerActions } from "@/components/post-owner-actions";
import { getPost } from "@/lib/community/server-repository";
import { publicPostImageUrl } from "@/lib/env";
import { getCurrentUser } from "@/lib/auth/dal";

type PageProps = { params: Promise<{ id: string }> };

export default async function PostPage({ params }: PageProps) {
  const { id } = await params;
  const post = await getPost(id);
  if (!post || post.status === "hidden") notFound();
  const user = await getCurrentUser();
  const images = [...post.post_images].sort((a, b) => a.sort_order - b.sort_order);
  const author = post.profiles?.display_name || `UID ${post.profiles?.public_uid ?? "未设置"}`;

  return (
    <main className="mx-auto grid max-w-4xl gap-7 px-4 py-10 md:px-6 md:py-14">
      <Link href={`/community/${post.board}`} className="inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground hover:text-primary">
        <ArrowLeft aria-hidden size={17} />返回{BOARDS[post.board].title}
      </Link>
      <article className="grid gap-8 rounded-xl border bg-surface p-5 md:p-9">
        <header className="grid gap-3">
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{BOARDS[post.board].title}</span><span aria-hidden>/</span>
            {post.profiles?.public_uid ? <Link href={`/member/${post.profiles.public_uid}`} className="hover:text-foreground hover:underline">{author}</Link> : <span>{author}</span>}
            <time dateTime={post.created_at}>{new Date(post.created_at).toLocaleString("zh-CN")}</time>
          </div>
          <h1 className="text-3xl font-semibold leading-tight tracking-[-0.035em] md:text-4xl">{post.title}</h1>
        </header>
        <div className="whitespace-pre-wrap text-[1.02rem] leading-8 text-foreground/90">{post.body}</div>
        {images.length ? (
          <section className="grid gap-3 sm:grid-cols-2" aria-label={`帖子图片，共 ${images.length} 张`}>
            {images.map((image, index) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={image.id} src={publicPostImageUrl(image.storage_path)} alt={`${post.title}，图片 ${index + 1}`} className="h-auto w-full rounded-xl border object-contain" />
            ))}
          </section>
        ) : null}
        {post.external_url ? (
          <a href={post.external_url} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl border bg-muted p-4 text-sm font-medium hover:border-primary/50">
            <ImageSquare aria-hidden size={20} className="text-primary" />查看引用的 {post.external_kind === "youtube" ? "YouTube 视频" : "X 帖子"}
          </a>
        ) : null}
        {user?.id === post.author_id ? <PostOwnerActions post={post} userId={user.id} /> : null}
      </article>
    </main>
  );
}
