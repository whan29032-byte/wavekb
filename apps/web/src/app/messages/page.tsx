import type { Metadata } from "next";
import Link from "next/link";
import { UsersThree } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@wavekb/ui";
import { AvatarFrame, IdentityName, Nameplate } from "@/components/nameplate";
import { requireActiveMember } from "@/lib/auth/dal";
import { chatPreview } from "@/lib/member/chat-preview";
import { listConversations } from "@/lib/member/server-repository";

export const metadata: Metadata = { title: "私聊" };

export default async function MessagesPage() {
  await requireActiveMember("/messages");
  const conversations = await listConversations();
  return (
    <main className="mx-auto grid max-w-4xl gap-8 px-4 py-10 md:px-6 md:py-14">
      <header className="flex items-end justify-between gap-4"><div className="grid gap-2"><h1 className="text-3xl font-semibold tracking-[-0.035em] md:text-4xl">私聊</h1><p className="text-sm text-muted-foreground">会话只对双方可见，好友关系失效后不可继续读取或发送。</p></div><Button asChild variant="secondary"><Link href="/friends"><UsersThree aria-hidden size={18} />好友</Link></Button></header>
      {conversations.length ? <div className="grid gap-3">{conversations.map((item) => <Link key={item.conversation_id} href={`/messages/${item.conversation_id}`} className="flex items-center gap-4 rounded-xl border bg-surface p-4 hover:border-primary/45"><AvatarFrame profile={item} size="medium" /><span className="min-w-0 flex-1"><IdentityName profile={item} as="strong" className="block truncate text-sm" /><Nameplate uid={item.public_uid} style={item.nameplate_style} compact /><span className="block truncate text-sm text-muted-foreground">{chatPreview(item.last_message)}</span></span>{Number(item.unread_count || 0) > 0 ? <span className="grid min-w-6 place-items-center rounded-full bg-primary px-1.5 py-0.5 text-xs font-semibold text-primary-foreground" aria-label={`${item.unread_count} 条未读`}>{item.unread_count}</span> : null}</Link>)}</div> : <div className="rounded-xl border border-dashed bg-surface p-7 text-sm text-muted-foreground">还没有会话。前往好友页面，从已接受的好友关系开始私聊。</div>}
    </main>
  );
}
