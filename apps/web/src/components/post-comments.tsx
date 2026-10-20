"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import type { PostComment, PublicProfile } from "@wavekb/domain";
import { AvatarFrame, IdentityName, Nameplate } from "@/components/nameplate";
import { Button, Field, FieldMessage, Label, Textarea } from "@wavekb/ui";
import { addPostComment, deletePostComment } from "@/lib/community/client-repository";
import { publicPostImageUrl } from "@/lib/env";
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
  const [files, setFiles] = useState<File[]>([]);
  const previews = useMemo(() => files.map((file) => ({ file, url: URL.createObjectURL(file) })), [files]);
  useEffect(() => () => previews.forEach((preview) => URL.revokeObjectURL(preview.url)), [previews]);

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
      const created = await addPostComment(createClient(), {
        postId,
        userId: actorId,
        parentId,
        body,
        files,
      });
      setAdded((current) => [...current, {
        ...created,
        profiles: actorProfile ?? null,
      }]);
      formElement.reset();
      setFiles([]);
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

  function selectFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []).slice(0, 4);
    const invalid = selected.find((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024);
    if (invalid) {
      setError("评论图片只支持 JPG、PNG 或 WebP，且每张不超过 5MB。");
      event.target.value = "";
      return;
    }
    setError("");
    setFiles(selected);
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
              <article key={comment.id} className={`surface-card grid gap-2 p-4 ${comment.parent_id ? "ml-5 md:ml-10" : ""}`}>
                <header className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-2">
                    {comment.profiles ? <AvatarFrame profile={comment.profiles} size="small" /> : null}
                    {comment.profiles?.public_uid ? <Link href={`/member/${comment.profiles.public_uid}`} className="inline-flex items-center gap-2 font-medium hover:underline"><IdentityName profile={comment.profiles} /><Nameplate uid={comment.profiles.public_uid} style={comment.profiles.nameplate_style} compact /></Link> : <span>{comment.profiles?.display_name || "UID 未设置"}</span>}
                  </span>
                  <time dateTime={comment.created_at}>{new Date(comment.created_at).toLocaleString("zh-CN")}</time>
                </header>
                <p className="whitespace-pre-wrap text-sm leading-6">{comment.body}</p>
                {comment.images?.length ? (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {comment.images.map((image) => {
                      const url = publicPostImageUrl(image.storage_path);
                      return url ? <a key={image.id} href={url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-[var(--radius-control)] border border-border bg-surface-subtle"><img src={url} alt="评论图片" className="aspect-square w-full object-cover" loading="lazy" /></a> : null;
                    })}
                  </div>
                ) : null}
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
      ) : <p className="rounded-[var(--radius-card)] border border-dashed border-border p-5 text-sm text-muted-foreground">还没有评论。你可以从规则依据、失效条件或备选计数开始讨论。</p>}
      {!commentsEnabled ? <p className="text-sm text-muted-foreground">作者已关闭这篇帖子的评论。</p> : activeMember && actorId ? (
        <form className="surface-card grid gap-4 p-4 md:p-5" onSubmit={submit}>
          {replyTo ? <div className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] bg-surface-subtle px-3 py-2 text-sm"><span>回复 {replyTo.profiles?.display_name || "该评论"}</span><button type="button" className="font-semibold text-primary hover:underline" onClick={() => setReplyTo(null)}>取消</button></div> : null}
          <Field>
            <Label htmlFor="commentBody">发表评论</Label>
            <Textarea id="commentBody" name="body" required minLength={1} maxLength={2000} placeholder="写下可核验的观点或问题" aria-describedby={error ? "comment-error" : undefined} />
          </Field>
          <Field>
            <Label htmlFor="commentImages">图片（可选，最多 4 张）</Label>
            <input id="commentImages" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={pending} onChange={selectFiles} className="block w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 py-2 text-sm file:mr-3 file:rounded-[var(--radius-control)] file:border-0 file:bg-surface-subtle file:px-3 file:py-1.5 file:text-sm file:font-medium" />
          </Field>
          {previews.length ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {previews.map((preview) => (
                <div key={preview.url} className="relative overflow-hidden rounded-[var(--radius-control)] border border-border bg-surface-subtle">
                  <img src={preview.url} alt={preview.file.name} className="aspect-square w-full object-cover" />
                  <button type="button" className="absolute top-1 right-1 rounded-md bg-background/90 px-2 py-1 text-xs font-semibold text-destructive" onClick={() => setFiles((current) => current.filter((file) => file !== preview.file))}>移除</button>
                </div>
              ))}
            </div>
          ) : null}
          {error ? <FieldMessage id="comment-error" role="alert">{error}</FieldMessage> : null}
          <Button className="w-fit" type="submit" disabled={!hydrated || pending}>{pending ? "正在发布" : replyTo ? "发布回复" : "发表评论"}</Button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground"><Link className="font-semibold text-primary hover:underline" href={`/login?next=${encodeURIComponent(`/community/post/${postId}`)}`}>登录并完成 UID 激活</Link> 后可以发表评论。</p>
      )}
    </section>
  );
}
