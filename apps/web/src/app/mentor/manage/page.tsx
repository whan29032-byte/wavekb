import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@wavekb/ui";
import { MentorManagement } from "@/components/mentor-management";
import { requireActiveMember } from "@/lib/auth/dal";
import { getMyMentorSettings, listMyMentorPaymentClaims, listMyMentorStudents } from "@/lib/mentor/server-repository";

export const metadata: Metadata = { title: "导师服务管理" };

export default async function MentorManagePage() {
  await requireActiveMember("/mentor/manage");
  const settings = await getMyMentorSettings();
  if (!settings?.profile) {
    return <main className="mx-auto grid max-w-3xl gap-5 px-4 py-16 md:px-6"><ShieldCheck aria-hidden size={34} weight="duotone" className="text-primary" /><h1 className="text-2xl font-semibold">当前账号没有导师资料</h1><p className="text-sm leading-6 text-muted-foreground">管理员需要先创建并绑定导师资料。此页面不会自行提升账号权限。</p><Button asChild variant="secondary" className="w-fit"><Link href="/mentors"><ArrowLeft aria-hidden size={17} />返回导师目录</Link></Button></main>;
  }
  const [students, claims] = await Promise.all([listMyMentorStudents(), listMyMentorPaymentClaims()]);
  return <main className="mx-auto grid max-w-6xl gap-8 px-4 py-10 md:px-6 md:py-14"><header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div className="grid gap-2"><span className="flex items-center gap-2 text-sm font-semibold text-primary"><ShieldCheck aria-hidden size={18} weight="duotone" />导师本人管理</span><h1 className="text-3xl font-semibold tracking-[-0.035em] md:text-4xl">服务与收款管理</h1><p className="max-w-[65ch] text-sm leading-6 text-muted-foreground">管理公开方案、收款方式、付款核对和学员会话。历史订单不会因停用方案而删除。</p></div><Button asChild variant="secondary"><Link href="/mentors">查看公开导师页</Link></Button></header><MentorManagement initialSettings={settings} initialStudents={students} initialClaims={claims} /></main>;
}
