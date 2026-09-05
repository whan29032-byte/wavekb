"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChatCircleDots, Check, MagnifyingGlass, UserPlus, X } from "@phosphor-icons/react";
import type { FriendshipConnection, MemberProfile } from "@wavekb/domain";
import { Button, Field, FieldMessage, Input, Label } from "@wavekb/ui";
import { readFriends, runFriendAction } from "@/lib/member/friends-api-client";
import { AvatarFrame, IdentityName, Nameplate } from "@/components/nameplate";
import { useMemberPresence } from "@/hooks/use-member-presence";
import { createClient } from "@/lib/supabase/client";
import { subscribeIdentityChanges } from "@/lib/member/identity-events";

function messageFor(error: unknown): string {
  const value = error as { code?: unknown; message?: unknown } | null;
  const message = error instanceof Error ? error.message : `${String(value?.code ?? "")} ${String(value?.message ?? error ?? "")}`;
  if (/auth|jwt|permission|row-level/i.test(message)) return "登录状态已失效，请重新登录。";
  if (/friendships_unavailable/i.test(message)) return "好友列表暂时无法读取，请重试。";
  return "操作没有完成，请稍后重试。";
}

export function FriendDirectory() {
  const router = useRouter();
  const [actorId, setActorId] = useState<string | null>(null);
  const [connections, setConnections] = useState<FriendshipConnection[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [searchResult, setSearchResult] = useState<MemberProfile | null>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const onlineIds = useMemberPresence(actorId);
  const mounted = useRef(false);
  const owner = useRef<string | null>(null);
  const generation = useRef(0);
  const readRevision = useRef(0);
  const actionRevision = useRef(0);
  const invalidateRequests = useCallback(() => {
    generation.current++; readRevision.current++; actionRevision.current++;
  }, []);

  const clearAccountState = useCallback(() => {
    setActorId(null); setConnections([]); setSearchResult(null); setQuery("");
    setMessage(""); setPending(false); setLoadError("");
  }, []);

  const refreshConnections = useCallback(async () => {
    const expectedOwner = owner.current;
    if (!mounted.current || !expectedOwner) return;
    const session = generation.current;
    const request = ++readRevision.current;
    const current = () => mounted.current && session === generation.current && request === readRevision.current;
    setLoadState("loading");
    setLoadError("");
    try {
      const payload = await readFriends();
      if (!current()) return;
      if (payload.actorId !== expectedOwner || !Array.isArray(payload.connections)) throw new Error("friendships_unavailable");
      setActorId(payload.actorId);
      setConnections(payload.connections);
      setLoadState("ready");
    } catch (error) {
      if (!current()) return;
      clearAccountState();
      if (error instanceof Error && "status" in error && (error as Error & { status?: number }).status === 401) {
        router.replace("/login?next=%2Ffriends");
      }
      setLoadError(messageFor(error));
      setLoadState("error");
    }
  }, [clearAccountState, router]);

  useEffect(() => {
    mounted.current = true;
    let active = true, receivedAuthEvent = false, initialized = false;
    const client = createClient();
    const applyOwner = (nextOwner: string | null) => {
      if (!active || (initialized && owner.current === nextOwner)) return;
      initialized = true;
      const session = ++generation.current;
      readRevision.current++; actionRevision.current++;
      owner.current = nextOwner;
      clearAccountState();
      setLoadState(nextOwner ? "loading" : "ready");
      queueMicrotask(() => {
        if (!active || session !== generation.current) return;
        if (nextOwner) void refreshConnections();
        else router.replace("/login?next=%2Ffriends");
      });
    };
    const auth = client.auth.onAuthStateChange((_event, session) => {
      receivedAuthEvent = true;
      applyOwner(session?.user.id ?? null);
    });
    void client.auth.getSession().then(({ data }) => { if (!receivedAuthEvent) applyOwner(data.session?.user.id ?? null); }).catch((error: unknown) => {
      if (!active || receivedAuthEvent) return;
      clearAccountState();
      setLoadError(messageFor(error));
      setLoadState("error");
    });
    const stopIdentity = subscribeIdentityChanges(() => { if (owner.current) void refreshConnections(); });
    return () => {
      active = false; mounted.current = false;
      invalidateRequests();
      auth.data.subscription.unsubscribe(); stopIdentity();
    };
  }, [clearAccountState, invalidateRequests, refreshConnections, router]);

  function actionScope() {
    const session = generation.current, request = ++actionRevision.current;
    return () => mounted.current && session === generation.current && request === actionRevision.current;
  }

  async function verifyActor() {
    const auth = await createClient().auth.getUser();
    if (!actorId || auth.error || auth.data.user?.id !== actorId) throw new Error("authentication_required");
  }

  async function search() {
    if (!actorId || pending) return;
    if (!/^\d{5,6}$/.test(query.trim())) {
      setMessage("请输入 5 至 6 位 UID。 ");
      return;
    }
    setPending(true);
    setMessage("");
    const current = actionScope();
    try {
      await verifyActor();
      if (!current()) return;
      const result = await runFriendAction({ action: "search", uid: Number(query.trim()) });
      if (!current()) return;
      const profile = result.profile ?? undefined;
      setSearchResult(profile ?? null);
      if (!profile) setMessage("没有找到该 UID。 ");
    } catch (error) {
      if (current()) setMessage(messageFor(error));
    } finally {
      if (current()) setPending(false);
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void search();
  }

  async function sendRequest(profile: MemberProfile) {
    if (!actorId || pending) return;
    setPending(true);
    setMessage("");
    const current = actionScope();
    try {
      await verifyActor();
      if (!current()) return;
      const result = await runFriendAction({ action: "request", targetId: profile.id });
      if (!current()) return;
      setMessage("好友请求已发送。 ");
      if (result.connections) {
        setConnections(result.connections);
        setLoadState("ready");
      } else await refreshConnections();
    } catch (error) {
      if (current()) setMessage(messageFor(error));
    } finally {
      if (current()) setPending(false);
    }
  }

  async function respond(item: FriendshipConnection, accept: boolean) {
    if (!actorId || pending) return;
    setPending(true);
    setMessage("");
    const current = actionScope();
    try {
      await verifyActor();
      if (!current()) return;
      const result = await runFriendAction({ action: "respond", friendshipId: item.friendship_id, accept });
      if (!current()) return;
      if (result.connections) setConnections(result.connections);
      setMessage(accept ? "好友请求已接受。" : "好友请求已拒绝。 ");
      if (!result.connections) await refreshConnections();
    } catch (error) {
      if (current()) setMessage(messageFor(error));
    } finally {
      if (current()) setPending(false);
    }
  }

  async function openConversation(item: FriendshipConnection) {
    if (!actorId || pending) return;
    setPending(true);
    setMessage("");
    const current = actionScope();
    try {
      await verifyActor();
      if (!current()) return;
      const result = await runFriendAction({ action: "conversation", targetId: item.other_id });
      if (!current()) return;
      window.dispatchEvent(new CustomEvent("wavekb:open-chat", { detail: { conversation: { conversation_id: String(result.conversationId), other_id: item.other_id, public_uid: item.public_uid ?? null, display_name: item.display_name || `UID ${item.public_uid || ""}`, avatar_url: item.avatar_url ?? null, display_title: item.display_title || "", nameplate_style: item.nameplate_style || "classic", last_message: null, last_message_at: null, unread_count: 0 } } }));
      setPending(false);
    } catch (error) {
      if (current()) { setMessage(messageFor(error)); setPending(false); }
    }
  }

  const friends = connections.filter((item) => item.status === "accepted");
  const searchedConnection = connections.find((item) => item.other_id === searchResult?.id);

  return (
    <div className="grid gap-8" data-friends-directory data-load-state={loadState} data-friend-count={loadState === "ready" ? friends.length : undefined}>
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
            <div className="flex min-w-0 items-center gap-3"><AvatarFrame profile={searchResult} /><div className="grid min-w-0 gap-1"><Link href={`/member/${searchResult.public_uid}`} className="font-semibold hover:underline"><IdentityName profile={searchResult} /></Link><Nameplate uid={searchResult.public_uid} style={searchResult.nameplate_style} compact /></div></div>
            {searchResult.id === actorId ? <Button asChild variant="secondary"><Link href={`/member/${searchResult.public_uid}`}>查看我的主页</Link></Button> : searchedConnection?.status === "accepted" ? <Button type="button" variant="secondary" onClick={() => openConversation(searchedConnection)} disabled={pending}>发起会话</Button> : searchedConnection?.status === "pending" ? <Button type="button" variant="secondary" disabled>请求等待处理</Button> : <Button type="button" variant="secondary" onClick={() => sendRequest(searchResult)} disabled={pending}><UserPlus aria-hidden size={18} />添加好友</Button>}
          </div>
        ) : null}
        {message ? <FieldMessage role="status">{message}</FieldMessage> : null}
      </section>

      <section className="grid gap-4" aria-labelledby="friend-list-title">
        <div className="flex items-end justify-between gap-4"><div><h2 id="friend-list-title" className="text-2xl font-semibold">好友与请求</h2><p className="mt-1 text-sm text-muted-foreground">{loadState === "ready" ? `${friends.length} 位好友 · ${friends.filter((item) => onlineIds.has(item.other_id)).length} 位在线。` : ""}只有已接受好友关系才能打开私聊。</p></div><Button asChild variant="secondary"><Link href="/messages">会话列表</Link></Button></div>
        {loadState === "loading" ? <div className="grid gap-3" aria-label="正在读取好友"><div className="h-20 animate-pulse rounded-xl bg-muted" /><div className="h-20 animate-pulse rounded-xl bg-muted" /></div> : loadState === "error" ? <div className="grid justify-items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-5" role="alert"><p className="text-sm text-destructive">{loadError}</p><Button type="button" variant="secondary" onClick={() => void refreshConnections()}>重新读取好友</Button></div> : connections.length ? <div className="grid gap-3">{connections.map((item) => (
          <article key={item.friendship_id} className="flex flex-col gap-4 rounded-xl border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3"><Link href={item.public_uid ? `/member/${item.public_uid}` : "/friends"} aria-label={`查看${item.display_name || "好友"}的主页`}><AvatarFrame profile={{ ...item, display_name: item.display_name || `UID ${item.public_uid || "未设置"}`, avatar_url: item.avatar_url ?? null, nameplate_style: item.nameplate_style || "classic" }} /></Link><div className="min-w-0"><div className="flex items-center gap-2"><span className={`size-2 rounded-full ${onlineIds.has(item.other_id) ? "bg-emerald-500" : "bg-muted-foreground/35"}`} aria-label={onlineIds.has(item.other_id) ? "在线" : "离线"} /><Link href={item.public_uid ? `/member/${item.public_uid}` : "/friends"} className="font-semibold hover:text-primary hover:underline"><IdentityName profile={{ display_name: item.display_name || `UID ${item.public_uid || "未设置"}`, nameplate_style: item.nameplate_style || "classic" }} /></Link><Nameplate uid={item.public_uid} style={item.nameplate_style} compact /></div><p className="truncate text-sm text-muted-foreground">{item.bio || (item.status === "accepted" ? "已成为好友" : item.direction === "incoming" ? "向你发送了好友请求" : "好友请求等待处理")}</p></div></div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {item.status === "accepted" ? <Button type="button" onClick={() => openConversation(item)} disabled={pending}><ChatCircleDots aria-hidden size={18} />私聊</Button> : item.status === "pending" && item.direction === "incoming" ? <><Button type="button" onClick={() => respond(item, true)} disabled={pending}><Check aria-hidden size={18} />接受</Button><Button type="button" variant="secondary" onClick={() => respond(item, false)} disabled={pending}><X aria-hidden size={18} />拒绝</Button></> : <Button type="button" variant="secondary" disabled>{item.status === "declined" ? "已拒绝" : "等待接受"}</Button>}
            </div>
          </article>
        ))}</div> : <div className="rounded-xl border border-dashed bg-surface p-7 text-sm text-muted-foreground">还没有好友或待处理请求，可以先按 UID 查找。</div>}
      </section>
    </div>
  );
}
