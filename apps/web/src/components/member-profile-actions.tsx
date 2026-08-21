"use client";

import { useState } from "react";
import Link from "next/link";
import { ChatCircleDots, Notebook, PencilSimple, UserPlus, UsersThree } from "@phosphor-icons/react";
import type { FriendshipConnection } from "@wavekb/domain";
import { Button } from "@wavekb/ui";
import { createClient } from "@/lib/supabase/client";

type Props = {
  actorId: string | null;
  profileId: string;
  initialFollowing: boolean;
  initialConnection: FriendshipConnection | null;
  profile: { display_name: string; public_uid: number | null; avatar_url: string | null; display_title: string; nameplate_style: string };
};

function socialError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/already|duplicate|unique/i.test(message)) return "请求已经存在。";
  if (/auth|jwt|permission|row-level/i.test(message)) return "登录状态已失效，请重新登录。";
  return "操作没有完成，请稍后重试。";
}

export function MemberProfileActions({ actorId, profileId, initialFollowing, initialConnection, profile }: Props) {
  const [following, setFollowing] = useState(initialFollowing);
  const [connection, setConnection] = useState(initialConnection);
  const [pending, setPending] = useState<"follow" | "friend" | null>(null);
  const [message, setMessage] = useState("");

  if (!actorId) {
    const returnPath = `/member/${profile.public_uid ?? ""}`;
    const loginHref = `/login?next=${encodeURIComponent(returnPath)}`;
    return (
      <div className="flex flex-wrap gap-3">
        <Button asChild variant="secondary"><Link href={loginHref}>关注</Link></Button>
        <Button asChild><Link href={loginHref}><UserPlus aria-hidden size={18} />添加好友</Link></Button>
      </div>
    );
  }

  if (actorId === profileId) {
    return (
      <div className="grid w-full grid-cols-1 gap-2 min-[28rem]:grid-cols-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
        <Button asChild size="small" className="min-h-11 w-full sm:w-auto"><Link href="/member/profile"><PencilSimple aria-hidden size={16} />编辑资料</Link></Button>
        <Button asChild variant="secondary" size="small" className="min-h-11 w-full sm:w-auto"><Link href="/friends"><UsersThree aria-hidden size={16} />我的好友</Link></Button>
        <Button asChild variant="secondary" size="small" className="min-h-11 w-full sm:w-auto"><Link href="/workbench"><Notebook aria-hidden size={16} />交易工作台</Link></Button>
      </div>
    );
  }

  async function toggleFollow() {
    setPending("follow");
    setMessage("");
    try {
      const client = createClient();
      if (following) {
        const result = await client.from("profile_follows").delete().eq("follower_id", actorId).eq("followed_id", profileId);
        if (result.error) throw result.error;
      } else {
        const result = await client.from("profile_follows").upsert({ follower_id: actorId, followed_id: profileId });
        if (result.error) throw result.error;
      }
      setFollowing((value) => !value);
      setMessage(following ? "已取消关注。" : "已关注这位研究者。");
    } catch (error) {
      setMessage(socialError(error));
    } finally {
      setPending(null);
    }
  }

  async function addFriend() {
    setPending("friend");
    setMessage("");
    try {
      const client = createClient();
      const result = await client.rpc("send_friend_request", { p_target: profileId });
      if (result.error) throw result.error;
      const connectionsResult = await client.rpc("list_my_friendships");
      if (connectionsResult.error) throw connectionsResult.error;
      const current = ((connectionsResult.data ?? []) as FriendshipConnection[]).find((item) => item.other_id === profileId);
      setConnection(current ?? { friendship_id: String(result.data), status: "pending", direction: "outgoing", other_id: profileId });
      setMessage(current?.status === "accepted" ? "你们已成为好友。" : "好友请求已发送，等待对方接受。 ");
    } catch (error) {
      setMessage(socialError(error));
    } finally {
      setPending(null);
    }
  }

  async function openConversation() {
    setPending("friend");
    setMessage("");
    try {
      const result = await createClient().rpc("open_direct_conversation", { p_target: profileId });
      if (result.error) throw result.error;
      window.dispatchEvent(new CustomEvent("wavekb:open-chat", { detail: { conversation: { conversation_id: String(result.data), other_id: profileId, public_uid: profile.public_uid, display_name: profile.display_name, avatar_url: profile.avatar_url, display_title: profile.display_title, nameplate_style: profile.nameplate_style, last_message: null, last_message_at: null, unread_count: 0 } } }));
      setPending(null);
    } catch (error) {
      setMessage(socialError(error));
      setPending(null);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="secondary" onClick={toggleFollow} disabled={pending !== null} aria-pressed={following}>
          {following ? "已关注" : "关注"}
        </Button>
        {connection?.status === "accepted" ? (
          <Button type="button" onClick={openConversation} disabled={pending !== null}><ChatCircleDots aria-hidden size={18} />发起会话</Button>
        ) : connection?.status === "pending" ? (
          <Button type="button" disabled variant="secondary">{connection.direction === "incoming" ? "好友请求待处理" : "请求已发送"}</Button>
        ) : (
          <Button type="button" onClick={addFriend} disabled={pending !== null}><UserPlus aria-hidden size={18} />{pending === "friend" ? "正在发送" : "添加好友"}</Button>
        )}
      </div>
      {message ? <p role="status" className="text-sm text-muted-foreground">{message}</p> : null}
    </div>
  );
}
