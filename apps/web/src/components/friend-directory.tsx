"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChatCircleDots, Check, MagnifyingGlass, UserPlus, X } from "@phosphor-icons/react";
import type { FriendshipConnection, MemberProfile } from "@wavekb/domain";
import { Button, Field, FieldMessage, Input, Label } from "@wavekb/ui";
import { createClient } from "@/lib/supabase/client";

function messageFor(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/auth|jwt|permission|row-level/i.test(message)) return "登录状态已失效，请重新登录。";
  return "操作没有完成，请稍后重试。";
}

export function FriendDirectory({ actorId, initialConnections }: { actorId: string; initialConnections: FriendshipConnection[] }) {
  const router = useRouter();
  const [connections, setConnections] = useState(initialConnections);
  const [query, setQuery] = useState("");
  const [searchResult, setSearchResult] = useState<MemberProfile | null>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function search() {
    if (!/^\d{5,6}$/.test(query.trim())) {
      setMessage("请输入 5 至 6 位 UID。 ");
      return;
    }
    setPending(true);
    setMessage("");
    try {
      const result = await createClient().rpc("search_profile_by_uid", { p_uid: Number(query.trim()) });
      if (result.error) throw result.error;
      const profile = (Array.isArray(result.data) ? result.data[0] : result.data) as MemberProfile | undefined;
      setSearchResult(profile ?? null);
      if (!profile) setMessage("没有找到该 UID。 ");
    } catch (error) {
      setMessage(messageFor(error));
    } finally {
      setPending(false);
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void search();
  }

  async function sendRequest(profile: MemberProfile) {
    setPending(true);
    setMessage("");
    try {
      const result = await createClient().rpc("send_friend_request", { p_target: profile.id });
      if (result.error) throw result.error;
      setMessage("好友请求已发送。 ");
      router.refresh();
    } catch (error) {
      setMessage(messageFor(error));
    } finally {
      setPending(false);
    }
  }

  async function respond(item: FriendshipConnection, accept: boolean) {
    setPending(true);
    setMessage("");
    try {
      const result = await createClient().rpc("respond_friend_request", { p_friendship: item.friendship_id, p_accept: accept });
      if (result.error) throw result.error;
      setConnections((current) => current.map((connection) => connection.friendship_id === item.friendship_id ? { ...connection, status: accept ? "accepted" : "declined" } : connection));
      setMessage(accept ? "好友请求已接受。" : "好友请求已拒绝。 ");
      router.refresh();
    } catch (error) {
      setMessage(messageFor(error));
    } finally {
      setPending(false);
    }
  }

  async function openConversation(item: FriendshipConnection) {
    setPending(true);
    setMessage("");
    try {
      const result = await createClient().rpc("open_direct_conversation", { p_target: item.other_id });
      if (result.error) throw result.error;
      router.push(`/messages/${result.data}`);
    } catch (error) {
      setMessage(messageFor(error));
      setPending(false);
    }
  }

  return (
    <div className="grid gap-8">
      <section className="grid gap-4 rounded-xl border bg-surface p-5 md:p-6" aria-labelledby="friend-search-title">
        <div className="grid gap-1"><h2 id="friend-search-title" className="text-xl font-semibold">按 UID 查找</h2><p className="text-sm text-muted-foreground">UID 精确匹配，不会公开邮箱。</p></div>
        <form className="max-w-xl" onSubmit={submitSearch}>
          <Field>
            <Label htmlFor="friend-uid">用户 UID</Label>
            <div className="flex gap-2"><Input id="friend-uid" inputMode="numeric" pattern="[0-9]{5,6}" value={query} onChange={(event) => setQuery(event.target.value.replace(/\D/g, "").slice(0, 6))} /><Button type="submit" disabled={pending}><MagnifyingGlass aria-hidden size={18} />查找</Button></div>
          </Field>
        </form>
        {searchResult ? (
          <div className="flex flex-col gap-4 rounded-xl bg-muted p-4 sm:flex-row sm:items-center sm:justify-between">
            <div><Link href={`/member/${searchResult.public_uid}`} className="font-semibold hover:text-primary hover:underline">{searchResult.display_name}</Link><p className="text-xs text-muted-foreground">UID {searchResult.public_uid}</p></div>
            {searchResult.id === actorId ? <Button asChild variant="secondary"><Link href={`/member/${searchResult.public_uid}`}>查看我的主页</Link></Button> : <Button type="button" variant="secondary" onClick={() => sendRequest(searchResult)} disabled={pending}><UserPlus aria-hidden size={18} />添加好友</Button>}
          </div>
        ) : null}
        {message ? <FieldMessage role="status">{message}</FieldMessage> : null}
      </section>

      <section className="grid gap-4" aria-labelledby="friend-list-title">
        <div className="flex items-end justify-between gap-4"><div><h2 id="friend-list-title" className="text-2xl font-semibold">好友与请求</h2><p className="mt-1 text-sm text-muted-foreground">只有已接受好友关系才能打开私聊。</p></div><Button asChild variant="secondary"><Link href="/messages">会话列表</Link></Button></div>
        {connections.length ? <div className="grid gap-3">{connections.map((item) => (
          <article key={item.friendship_id} className="flex flex-col gap-4 rounded-xl border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0"><Link href={item.public_uid ? `/member/${item.public_uid}` : "/friends"} className="font-semibold hover:text-primary hover:underline">{item.display_name || `UID ${item.public_uid || "未设置"}`}</Link><p className="truncate text-sm text-muted-foreground">{item.bio || (item.status === "accepted" ? "已成为好友" : item.direction === "incoming" ? "向你发送了好友请求" : "好友请求等待处理")}</p></div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {item.status === "accepted" ? <Button type="button" onClick={() => openConversation(item)} disabled={pending}><ChatCircleDots aria-hidden size={18} />私聊</Button> : item.status === "pending" && item.direction === "incoming" ? <><Button type="button" onClick={() => respond(item, true)} disabled={pending}><Check aria-hidden size={18} />接受</Button><Button type="button" variant="secondary" onClick={() => respond(item, false)} disabled={pending}><X aria-hidden size={18} />拒绝</Button></> : <Button type="button" variant="secondary" disabled>{item.status === "declined" ? "已拒绝" : "等待接受"}</Button>}
            </div>
          </article>
        ))}</div> : <div className="rounded-xl border border-dashed bg-surface p-7 text-sm text-muted-foreground">还没有好友或待处理请求，可以先按 UID 查找。</div>}
      </section>
    </div>
  );
}
