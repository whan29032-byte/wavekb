"use client";

import Link from "next/link";
import { useState, useSyncExternalStore, type FormEvent } from "react";
import type { PostComment, PublicProfile } from "@wavekb/domain";
import { IdentityName, Nameplate } from "@/components/nameplate";
import { Button, Field, FieldMessage, Label, Textarea } from "@wavekb/ui";
import { addPostComment, deletePostComment } from "@/lib/community/client-repository";
import { createClient } from "@/lib/supabase/client";

export function PostComments({ postId, comments, actorId, actorProfile, commentsEnabled, activeMember }: {
  postId: string;
  comments: PostComment[];
  actorId?: string;
  actorProfile?: PublicProfile | null;
  commentsEnabled: boolean;
  activeMember: boolean;
}) {
  const [added, setAdded] = useState<PostComment[]>([]);
  const hydrated = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [replyTo, setReplyTo] = useState<PostComment | null>(null);

  const persistedIds = new Set(comments.map((comment) => comment.id));
  const items = [...comments, ...added.filter((comment) => !persistedIds.has(comment.id))];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!actorId) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const body = String(form.get("body") ?? "").trim();
    const parentId = replyTo?.parent_id ? replyTo.parent_id : replyTo?.id ?? null;
    setPending(true);
    setError("");
    try {
      await addPostComment(createClient(), {
        postId,
        userId: actorId,
        parentId,
        body,
      });
      const timestamp = new Date().toISOString();
      setAdded((current) => [...current, {
        id: `pending-${crypto.randomUUID()}`,
        post_id: postId,
        author_id: actorId,
        parent_id: parentId,
        body,
        status: "visible",
        created_at: timestamp,
        updated_at: timestamp,
        profiles: actorProfile ?? null,
      }]);
      formElement.reset();
      setReplyTo(null);
      setPending(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "评论发布失败，请重试。");
      setPending(false);
    }
  }

  async function remove(commentId: string) {
    if (!actorId) return;
    setPending(true);
    setError("");
    try {
      await deletePostComment(createClient(), commentId, actorId);
      window.location.reload();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "评论删除失败，请重试。");
      setPending(false);
    }
  }

  return (
    <section className="grid gap-5" aria-labelledby="comments-title">
      <div className="flex items-end justify-between gap-4 border-b pb-4">
        <div className="grid gap-1">
          <h2 id="comments-title" className="text-xl font-semibold">评论</h2>
          <p className="text-sm text-muted-foreground">围绕规则、证据、边界和反例展开讨论。</p>
        </div>
        <span className="text-sm tabular-nums text-muted-foreground">{items.length} 条</span>
      </div>
      {items.length ? (
        <div className="grid gap-3">
          {items.map((comment) => {
            return (
              <article key={comment.id} className={`grid gap-2 rounded-xl border bg-surface p-4 ${comment.parent_id ? "ml-5 md:ml-10" : ""}`}>
                <header className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {comment.profiles?.public_uid ? <Link href={`/member/${comment.profiles.public_uid}`} className="inline-flex items-center gap-2 font-medium hover:underline"><IdentityName profile={comment.profiles} /><Nameplate uid={comment.profiles.public_uid} style={comment.profiles.nameplate_style} compact /></Link> : <span>{comment.profiles?.display_name || "UID 未设置"}</span>}
                  <time dateTime={comment.created_at}>{new Date(comment.created_at).toLocaleString("zh-CN")}</time>
                </header>
                <p className="whitespace-pre-wrap text-sm leading-6">{comment.body}</p>
                {actorId ? (
                  <footer className="flex gap-3">
                    <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => setReplyTo(comment)}>回复</button>
                    {actorId === comment.author_id ? <button type="button" className="text-xs font-semibold text-destructive hover:underline" disabled={pending} onClick={() => void remove(comment.id)}>删除</button> : null}
                  </footer>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">还没有评论。你可以从规则依据、失效条件或备选计数开始讨论。</p>}
      {!commentsEnabled ? <p className="text-sm text-muted-foreground">作者已关闭这篇帖子的评论。</p> : activeMember && actorId ? (
        <form className="grid gap-4 rounded-xl border bg-surface p-4 md:p-5" onSubmit={submit}>
          {replyTo ? <div className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2 text-sm"><span>回复 {replyTo.profiles?.display_name || "该评论"}</span><button type="button" className="font-semibold text-primary hover:underline" onClick={() => setReplyTo(null)}>取消</button></div> : null}
          <Field>
            <Label htmlFor="commentBody">发表评论</Label>
            <Textarea id="commentBody" name="body" required minLength={1} maxLength={2000} placeholder="写下可核验的观点或问题" aria-describedby={error ? "comment-error" : undefined} />
          </Field>
          {error ? <FieldMessage id="comment-error" role="alert">{error}</FieldMessage> : null}
          <Button className="w-fit" type="submit" disabled={!hydrated || pending}>{pending ? "正在发布" : replyTo ? "发布回复" : "发表评论"}</Button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground"><Link className="font-semibold text-primary hover:underline" href={`/login?next=${encodeURIComponent(`/community/post/${postId}`)}`}>登录并完成 UID 激活</Link> 后可以发表评论。</p>
      )}
    </section>
  );
}
