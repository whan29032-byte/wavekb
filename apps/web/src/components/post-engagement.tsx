"use client";

import { useState } from "react";
import { Eye, Heart } from "@phosphor-icons/react";
import { createClient } from "@/lib/supabase/client";

export function PostEngagement({ postId, initialViews, initialLikes, initialLiked, actorId, disabledReason }: {
  postId: string;
  initialViews: number;
  initialLikes: number;
  initialLiked: boolean;
  actorId?: string;
  disabledReason?: string;
}) {
  const [likes, setLikes] = useState(initialLikes);
  const [liked, setLiked] = useState(initialLiked);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function toggleLike() {
    if (!actorId) {
      // A full navigation keeps this component usable inside the server-rendered page tests.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/login?next=${encodeURIComponent(`/community/post/${postId}`)}`);
      return;
    }
    if (pending) return;
    setPending(true);
    setError("");
    const client = createClient();
    try {
      if (liked) {
        const result = await client.from("post_likes").delete().eq("post_id", postId).eq("user_id", actorId);
        if (result.error) throw result.error;
        setLiked(false);
        setLikes((current) => Math.max(0, current - 1));
      } else {
        const result = await client.from("post_likes").insert({ post_id: postId, user_id: actorId });
        if (result.error) throw result.error;
        setLiked(true);
        setLikes((current) => current + 1);
      }
    } catch (likeError) {
      const message = likeError instanceof Error ? likeError.message : String(likeError ?? "");
      setError(/duplicate|23505/i.test(message) ? "你已经点过赞了。" : "点赞没有完成，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
      <span className="inline-flex items-center gap-1.5" aria-label={`浏览 ${initialViews}`}>
        <Eye aria-hidden size={17} />
        <span className="tabular-nums">{initialViews.toLocaleString("zh-CN")}</span>
      </span>
      <button
        type="button"
        aria-pressed={liked}
        aria-label={liked ? `取消点赞，当前 ${likes} 个赞` : `点赞，当前 ${likes} 个赞`}
        className={`inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-control)] border px-3 py-1.5 font-medium transition-colors disabled:opacity-60 ${liked ? "border-primary/25 bg-primary-selected text-primary" : "hover:border-primary/35 hover:bg-surface-subtle hover:text-primary"}`}
        disabled={pending || Boolean(disabledReason)}
        title={disabledReason}
        onClick={() => void toggleLike()}
      >
        <Heart aria-hidden size={17} weight={liked ? "fill" : "regular"} />
        <span className="tabular-nums">{likes.toLocaleString("zh-CN")}</span>
      </button>
      {disabledReason ? <span className="text-xs">{disabledReason}</span> : null}
      {error ? <span role="alert" className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
