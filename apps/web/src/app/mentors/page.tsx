import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ChatsCircle, CheckCircle, ShieldCheck } from "@phosphor-icons/react/dist/ssr";
import { formatMentorPrice, remainingMentorQuota } from "@wavekb/domain";
import { Button } from "@wavekb/ui";
import { MentorAvatar } from "@/components/mentor-avatar";
import { getCurrentUser } from "@/lib/auth/dal";
import { publicSupabaseConfig } from "@/lib/env";
import { getMyMentorSettings, listMentorCatalog, listMyMentorAccess } from "@/lib/mentor/server-repository";

export const metadata: Metadata = { title: "导师辅导", description: "查看 WaveKB 平台导师、透明方案和专属辅导权益。" };

export default async function MentorsPage() {
  if (!publicSupabaseConfig().configured) {
    return <main className="mx-auto grid max-w-4xl gap-3 px-4 py-16 md:px-6"><h1 className="text-2xl font-semibold">导师专区尚未连接 Supabase</h1><p className="text-sm text-muted-foreground">配置预览环境后即可读取导师目录，旧站不受影响。</p></main>;
  }
  const actor = await getCurrentUser();
  const [catalog, accessList, settings] = await Promise.all([
    listMentorCatalog(),
    actor ? listMyMentorAccess() : Promise.resolve([]),
    actor ? getMyMentorSettings() : Promise.resolve(null),
  ]);
  const activeAccess = accessList.filter((item) => item.status === "active");

  return (
    <main className="mx-auto grid max-w-6xl gap-10 px-4 py-10 md:px-6 md:py-14">
      <section className="grid gap-7 rounded-xl border bg-surface p-6 md:grid-cols-[minmax(0,1.45fr)_minmax(17rem,.75fr)] md:p-9">
        <div className="grid content-center gap-4"><span className="flex items-center gap-2 text-sm font-semibold text-primary"><ShieldCheck aria-hidden size={19} weight="duotone" />平台审核资料与服务方案</span><h1 className="max-w-[18ch] text-3xl font-semibold tracking-[-0.04em] md:text-5xl">和导师一起拆解卡住你的那一浪</h1><p className="max-w-[62ch] text-sm leading-7 text-muted-foreground">按方案开通专属对话。价格、有效期和每周提问次数在付款前明确展示，历史讨论继续保存在账户中。</p><div className="flex flex-wrap gap-2"><Button asChild><Link href="/community/question_answers">先在社区提问</Link></Button>{actor ? <Button asChild variant="secondary"><Link href="/tutoring"><ChatsCircle aria-hidden size={18} />我的辅导</Link></Button> : <Button asChild variant="secondary"><Link href="/login?next=%2Fmentors">登录账户</Link></Button>}</div></div>
        <aside className="grid content-center gap-4 rounded-xl bg-muted p-5" aria-label="辅导服务说明"><div className="grid gap-1"><strong className="text-2xl tabular-nums">{catalog.length}</strong><span className="text-sm text-muted-foreground">当前可查看导师</span></div><div className="grid gap-2 text-sm"><span className="flex items-center gap-2"><CheckCircle aria-hidden size={18} className="text-primary" />导师确认收款后发放权益</span><span className="flex items-center gap-2"><CheckCircle aria-hidden size={18} className="text-primary" />额度由服务器按自然周核验</span><span className="flex items-center gap-2"><CheckCircle aria-hidden size={18} className="text-primary" />付款声明可以追踪状态</span></div>{settings?.profile ? <Button asChild variant="secondary"><Link href="/mentor/manage">管理我的导师服务</Link></Button> : null}</aside>
      </section>

      {activeAccess.length ? <section className="grid gap-4" aria-labelledby="active-tutoring-title"><header><h2 id="active-tutoring-title" className="text-2xl font-semibold">正在进行的辅导</h2><p className="mt-1 text-sm text-muted-foreground">继续打开已有专属会话，不需要重复购买。</p></header><div className="grid gap-3 sm:grid-cols-2">{activeAccess.map((access) => <Link key={access.entitlement_id} href={`/tutoring/${access.thread_id}`} className="flex items-center gap-4 rounded-xl border bg-surface p-4 hover:border-primary/45"><MentorAvatar name={access.mentor_name} url={access.mentor_avatar_url} /><span className="min-w-0 flex-1"><strong className="block truncate">{access.mentor_name}</strong><span className="text-sm text-muted-foreground">本周剩余 {remainingMentorQuota(access)} 次</span></span><ArrowRight aria-hidden size={18} className="text-primary" /></Link>)}</div></section> : null}

      <section className="grid gap-5" aria-labelledby="mentor-directory-title"><header><h2 id="mentor-directory-title" className="text-2xl font-semibold">导师目录</h2><p className="mt-1 max-w-[65ch] text-sm leading-6 text-muted-foreground">先查看研究方向、凭证与具体方案，再决定是否进入付款步骤。</p></header>{catalog.length ? <div className="grid gap-4 md:grid-cols-2">{catalog.map((mentor) => { const access = activeAccess.find((item) => item.mentor_id === mentor.mentor_id); const firstOffer = mentor.offers.find((offer) => offer.active !== false); return <article key={mentor.mentor_id} className="grid gap-5 rounded-xl border bg-surface p-5"><div className="flex items-start gap-4"><MentorAvatar name={mentor.display_name} url={mentor.avatar_url} /><div className="min-w-0"><span className="text-xs font-semibold text-primary">{mentor.verification_label || "平台认证导师"}</span><h3 className="mt-1 text-xl font-semibold">{mentor.display_name}</h3><p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">{mentor.headline || "提供波浪结构、计数与复盘辅导。"}</p></div></div>{mentor.specialties.length ? <div className="flex flex-wrap gap-2" aria-label="研究方向">{mentor.specialties.slice(0, 6).map((item) => <span key={item} className="rounded-md bg-muted px-2 py-1 text-xs font-medium">{item}</span>)}</div> : null}<div className="mt-auto flex items-end justify-between gap-4 border-t pt-4"><div><span className="block text-xs text-muted-foreground">{access ? "已开通" : "辅导价格"}</span><strong className="mt-1 block text-lg">{access ? `本周剩余 ${remainingMentorQuota(access)} 次` : firstOffer ? `${formatMentorPrice(firstOffer.price_cents, firstOffer.currency)} 起` : "暂未上架"}</strong></div><Button asChild variant={access ? "primary" : "secondary"}><Link href={access ? `/tutoring/${access.thread_id}` : `/mentors/${mentor.mentor_id}`}>{access ? "进入对话" : "查看方案"}<ArrowRight aria-hidden size={17} /></Link></Button></div></article>; })}</div> : <div className="rounded-xl border border-dashed bg-surface p-8 text-sm text-muted-foreground">导师正在入驻。管理员上架并启用资料后会在这里显示。</div>}</section>
    </main>
  );
}
