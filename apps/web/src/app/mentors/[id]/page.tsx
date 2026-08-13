import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Certificate, ChatsCircle, CheckCircle } from "@phosphor-icons/react/dist/ssr";
import { remainingMentorQuota } from "@wavekb/domain";
import { Button } from "@wavekb/ui";
import { MentorAvatar } from "@/components/mentor-avatar";
import { MentorCheckout } from "@/components/mentor-checkout";
import { getCurrentUser } from "@/lib/auth/dal";
import { getMentorDetail, listMentorPaymentMethods, listMyMentorAccess } from "@/lib/mentor/server-repository";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const mentor = await getMentorDetail(id);
  return { title: mentor ? `${mentor.display_name}导师` : "导师详情", description: mentor?.headline || "查看导师辅导方案。" };
}

export default async function MentorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const mentor = await getMentorDetail(id);
  if (!mentor) notFound();
  const actor = await getCurrentUser();
  const [accessList, paymentMethods] = await Promise.all([
    actor ? listMyMentorAccess() : Promise.resolve([]),
    actor ? listMentorPaymentMethods(id) : Promise.resolve([]),
  ]);
  const access = accessList.find((item) => item.mentor_id === id && item.status === "active");

  return (
    <main className="mx-auto grid max-w-6xl gap-8 px-4 py-10 md:px-6 md:py-14">
      <Button asChild variant="ghost" className="w-fit"><Link href="/mentors"><ArrowLeft aria-hidden size={17} />返回导师目录</Link></Button>
      <section className="grid gap-7 rounded-xl border bg-surface p-6 md:grid-cols-[minmax(0,1.2fr)_minmax(18rem,.8fr)] md:p-8"><div className="grid content-start gap-5"><div className="flex items-start gap-4"><MentorAvatar name={mentor.display_name} url={mentor.avatar_url} size="large" /><div><span className="flex items-center gap-2 text-sm font-semibold text-primary"><Certificate aria-hidden size={18} weight="duotone" />{mentor.verification_label || "平台认证导师"}</span><h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] md:text-4xl">{mentor.display_name}</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">{mentor.headline || "提供波浪结构、计数与复盘辅导。"}</p></div></div><p className="max-w-[68ch] whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{mentor.bio || "导师暂未填写详细介绍。"}</p>{mentor.specialties.length ? <div className="flex flex-wrap gap-2">{mentor.specialties.map((item) => <span key={item} className="rounded-md bg-muted px-2.5 py-1.5 text-xs font-medium">{item}</span>)}</div> : null}</div><aside className="grid content-start gap-4 rounded-xl bg-muted p-5"><div><h2 className="font-semibold">服务信息</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">所有方案均以当前页面展示的 USDT 价格、周期和周额度为准。</p></div><div className="grid gap-2 text-sm"><span className="flex items-center gap-2"><CheckCircle aria-hidden size={17} className="text-primary" />语言：{mentor.languages.join("、") || "中文"}</span>{mentor.credentials.slice(0, 4).map((credential) => <span key={credential} className="flex items-start gap-2"><CheckCircle aria-hidden size={17} className="mt-0.5 shrink-0 text-primary" />{credential}</span>)}</div>{access ? <div className="grid gap-3 border-t pt-4"><strong>已开通专属辅导</strong><span className="text-sm text-muted-foreground">本周剩余 {remainingMentorQuota(access)} 次</span><Button asChild><Link href={`/tutoring/${access.thread_id}`}><ChatsCircle aria-hidden size={18} />进入对话</Link></Button></div> : null}</aside></section>
      {access ? <section className="rounded-xl border border-primary/25 bg-primary/8 p-5 text-sm leading-6">你已经拥有这位导师的有效权益。继续使用现有会话即可，不需要重复购买。</section> : <MentorCheckout actorId={actor?.id ?? null} mentorName={mentor.display_name} offers={mentor.offers} paymentMethods={paymentMethods} returnPath={`/mentors/${id}`} />}
    </main>
  );
}
