import type { Metadata } from "next";
import { FriendDirectory } from "@/components/friend-directory";
import { requireActiveMember } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "好友" };
export const dynamic = "force-dynamic";

export default async function FriendsPage() {
  const actor = await requireActiveMember("/friends");
  return (
    <main className="mx-auto grid max-w-5xl gap-8 px-4 py-10 md:px-6 md:py-14">
      <header className="grid gap-2"><h1 className="text-3xl font-semibold tracking-[-0.035em] md:text-4xl">好友</h1><p className="text-sm leading-6 text-muted-foreground">处理好友请求，进入公开主页或打开端到端受 RLS 约束的私聊。</p></header>
      <FriendDirectory actorId={actor.id} />
    </main>
  );
}
