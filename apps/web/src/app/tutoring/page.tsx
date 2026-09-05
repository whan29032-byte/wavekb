import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ChatsCircle, GraduationCap, Storefront } from "@phosphor-icons/react/dist/ssr";
import { remainingMentorQuota } from "@wavekb/domain";
import { Button } from "@wavekb/ui";
import { MentorAvatar } from "@/components/mentor-avatar";
import { MentorPaymentStatus } from "@/components/mentor-payment-status";
import { requireActiveMember } from "@/lib/auth/dal";
import { getMyMentorSettings, listMyMentorAccess } from "@/lib/mentor/server-repository";

export const metadata: Metadata = { title: "我的辅导" };

const statusLabels = { active: "进行中", expired: "已到期", revoked: "已撤销", refunded: "已退款" } as const;

export default async function TutoringPage() {
  const actor = await requireActiveMember("/tutoring");
  const [accessList, settings] = await Promise.all([listMyMentorAccess(), getMyMentorSettings()]);
  return (
    <main className="mx-auto grid max-w-5xl gap-8 px-4 py-10 md:px-6 md:py-14">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div className="grid gap-2"><span className="flex items-center gap-2 text-sm font-semibold text-primary"><GraduationCap aria-hidden size={19} weight="duotone" />账户专属辅导</span><h1 className="text-3xl font-semibold tracking-[-0.035em] md:text-4xl">我的辅导</h1><p className="max-w-[65ch] text-sm leading-6 text-muted-foreground">追踪付款声明、已发放权益、剩余提问次数和历史会话。待核对声明不代表权益已开通。</p></div><div className="flex flex-wrap gap-2"><Button asChild variant="secondary"><Link href="/mentors"><Storefront aria-hidden size={18} />导师目录</Link></Button>{settings?.profile ? <Button asChild><Link href="/mentor/manage">管理导师服务</Link></Button> : null}</div></header>
      <MentorPaymentStatus actorId={actor.id} />
      {accessList.length ? <section className="grid gap-4">{accessList.map((access) => <Link key={access.entitlement_id} href={`/tutoring/${access.thread_id}`} className="grid gap-4 rounded-xl border bg-surface p-5 hover:border-primary/45 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center"><MentorAvatar name={access.mentor_name} url={access.mentor_avatar_url} /><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-lg font-semibold">{access.mentor_name}</h2><span className={`rounded-md px-2 py-1 text-xs font-medium ${access.status === "active" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>{statusLabels[access.status]}</span></div><p className="mt-1 text-sm text-muted-foreground">{access.status === "active" ? `本周剩余 ${remainingMentorQuota(access)} / ${access.weekly_question_limit} 次` : `历史消息保留至账户，权益结束于 ${new Date(access.ends_at).toLocaleDateString("zh-CN")}`}</p></div><span className="flex items-center gap-2 text-sm font-medium text-primary"><ChatsCircle aria-hidden size={18} />打开会话<ArrowRight aria-hidden size={16} /></span></Link>)}</section> : <section className="grid place-items-center gap-4 rounded-xl border border-dashed bg-surface px-5 py-14 text-center"><span className="grid size-12 place-items-center rounded-xl bg-muted text-primary"><GraduationCap aria-hidden size={25} weight="duotone" /></span><div><h2 className="font-semibold">还没有已发放的辅导权益</h2><p className="mt-1 text-sm text-muted-foreground">导师确认收款后，专属会话会自动出现在这里。</p></div><Button asChild variant="secondary"><Link href="/mentors">查看导师方案</Link></Button></section>}
    </main>
  );
}
