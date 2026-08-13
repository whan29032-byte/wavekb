"use client";

import { useState } from "react";
import Link from "next/link";
import { ChatCircleDots, UserPlus } from "@phosphor-icons/react";
import type { FriendshipConnection } from "@wavekb/domain";
import { Button } from "@wavekb/ui";
import { createClient } from "@/lib/supabase/client";

type Props = {
  actorId: string;
  profileId: string;
  profileUid: number;
  initialFollowing: boolean;
  initialConnection: FriendshipConnection | null;
  legacySite: string;
};

function socialError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/already|duplicate|unique/i.test(message)) return "请求已经存在。";
  if (/auth|jwt|permission|row-level/i.test(message)) return "登录状态已失效，请重新登录。";
  return "操作没有完成，请稍后重试。";
}

export function MemberProfileActions({ actorId, profileId, profileUid, initialFollowing, initialConnection, legacySite }: Props) {
  const [following, setFollowing] = useState(initialFollowing);
  const [connection, setConnection] = useState(initialConnection);
  const [pending, setPending] = useState<"follow" | "friend" | null>(null);
  const [message, setMessage] = useState("");

  if (actorId === profileId) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="secondary"><a href={`${legacySite}/#space=profile`}>编辑个人资料</a></Button>
        <p className="text-xs text-muted-foreground">资料编辑器迁移完成前继续使用原入口。</p>
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
      const result = await createClient().rpc("send_friend_request", { p_target: profileId });
      if (result.error) throw result.error;
      setConnection({ friendship_id: String(result.data), status: "pending", direction: "outgoing", other_id: profileId });
      setMessage("好友请求已发送。等待对方接受。 ");
    } catch (error) {
      setMessage(socialError(error));
    } finally {
      setPending(null);
    }
  }

  const legacyMessagesUrl = `${legacySite}/#space=messages&uid=${encodeURIComponent(profileUid)}`;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="secondary" onClick={toggleFollow} disabled={pending !== null} aria-pressed={following}>
          {following ? "已关注" : "关注"}
        </Button>
        {connection?.status === "accepted" ? (
          <Button asChild><a href={legacyMessagesUrl}><ChatCircleDots aria-hidden size={18} />发起会话</a></Button>
        ) : connection?.status === "pending" ? (
          <Button type="button" disabled variant="secondary">{connection.direction === "incoming" ? "好友请求待处理" : "请求已发送"}</Button>
        ) : (
          <Button type="button" onClick={addFriend} disabled={pending !== null}><UserPlus aria-hidden size={18} />{pending === "friend" ? "正在发送" : "添加好友"}</Button>
        )}
        <Button asChild variant="ghost"><Link href={`/community/public_viewpoint`}>查看社区观点</Link></Button>
      </div>
      {message ? <p role="status" className="text-sm text-muted-foreground">{message}</p> : null}
    </div>
  );
}
