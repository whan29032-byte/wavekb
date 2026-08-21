"use client";

import { useState } from "react";
import Link from "next/link";
import { PencilSimpleLine, Trash } from "@phosphor-icons/react";
import type { CommunityPost } from "@wavekb/domain";
import { Button } from "@wavekb/ui";
import { deletePost } from "@/lib/community/client-repository";
import { createClient } from "@/lib/supabase/client";

export function PostOwnerActions({ post, userId }: { post: CommunityPost; userId: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    if (!window.confirm("确定删除这篇帖子和它的全部图片吗？此操作无法撤销。")) return;
    setPending(true);
    setError("");
    try {
      await deletePost(createClient(), post, userId);
      window.location.assign(new URL(`/community/${post.board}`, window.location.origin));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除没有完成。帖子仍然保留，请刷新后重试。");
      setPending(false);
    }
  }

  return (
    <div className="grid gap-2 border-t pt-6">
      <div className="flex flex-wrap gap-3">
        <Button asChild variant="secondary"><Link href={`/community/post/${post.id}/edit`}><PencilSimpleLine aria-hidden size={17} />编辑帖子</Link></Button>
        <Button type="button" variant="danger" disabled={pending} onClick={remove}><Trash aria-hidden size={17} />{pending ? "正在删除" : "删除帖子"}</Button>
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
