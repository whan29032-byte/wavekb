import Link from "next/link";
import { ImageSquare } from "@phosphor-icons/react/dist/ssr";
import { BOARDS, plainTextExcerpt, type CommunityPost } from "@wavekb/domain";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" });

export function PostCard({ post }: { post: CommunityPost }) {
  const author = post.profiles?.display_name || `UID ${post.profiles?.public_uid ?? "未设置"}`;
  return (
    <article className="group grid gap-3 rounded-xl border bg-surface p-5 transition-colors hover:border-primary/45 md:p-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{BOARDS[post.board].title}</span>
        <span aria-hidden>/</span>
        <span>{author}</span>
        <time dateTime={post.created_at}>{dateFormatter.format(new Date(post.created_at))}</time>
        {post.post_images.length > 0 ? (
          <span className="ml-auto inline-flex items-center gap-1"><ImageSquare aria-hidden size={15} />{post.post_images.length}</span>
        ) : null}
      </div>
      <h2 className="text-lg font-semibold tracking-tight md:text-xl">
        <Link href={`/community/post/${post.id}`} className="outline-none after:absolute focus-visible:underline group-hover:text-primary">
          {post.title}
        </Link>
      </h2>
      <p className="max-w-[72ch] text-sm leading-6 text-muted-foreground md:text-base">
        {plainTextExcerpt(post.body)}
      </p>
    </article>
  );
}
