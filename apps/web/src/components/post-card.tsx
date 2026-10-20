import Link from "next/link";
import { Eye, Heart, ImageSquare } from "@phosphor-icons/react/dist/ssr";
import { BOARDS, plainTextExcerpt, type CommunityPost } from "@wavekb/domain";
import { Badge } from "@wavekb/ui";
import { IdentityName, Nameplate } from "@/components/nameplate";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" });

export function PostCard({ post }: { post: CommunityPost }) {
  return (
    <article className="surface-card surface-card-interactive group grid gap-3 p-5 md:p-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <Badge variant="neutral" size="sm">{BOARDS[post.board].title}</Badge>
        {post.profiles?.public_uid ? <Link href={`/member/${post.profiles.public_uid}`} className="inline-flex items-center gap-2 font-medium hover:text-foreground hover:underline"><IdentityName profile={post.profiles} /><Nameplate uid={post.profiles.public_uid} style={post.profiles.nameplate_style} compact /></Link> : <span>{post.profiles?.display_name || "UID 未设置"}</span>}
        <time dateTime={post.created_at}>{dateFormatter.format(new Date(post.created_at))}</time>
        {post.post_images.length > 0 ? (
          <span className="ml-auto inline-flex items-center gap-1"><ImageSquare aria-hidden size={15} />{post.post_images.length}</span>
        ) : null}
      </div>
      <h2 className="text-lg font-semibold tracking-tight md:text-xl">
        <Link href={`/community/post/${post.id}`} className="outline-none focus-visible:underline group-hover:text-primary">
          {post.title}
        </Link>
      </h2>
      <p className="max-w-[72ch] text-sm leading-6 text-muted-foreground md:text-base">
        {plainTextExcerpt(post.body)}
      </p>
      <footer className="flex items-center gap-4 border-t border-border-subtle pt-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><Eye aria-hidden size={15} /><span className="tabular-nums">{(post.view_count ?? 0).toLocaleString("zh-CN")}</span></span>
        <span className="inline-flex items-center gap-1.5"><Heart aria-hidden size={15} /><span className="tabular-nums">{(post.like_count ?? 0).toLocaleString("zh-CN")}</span></span>
      </footer>
    </article>
  );
}
