import type { Metadata } from "next";
import { GraduationCap } from "@phosphor-icons/react/dist/ssr";
import { AdminMentors } from "@/components/admin-mentors";
import { requireAdminActor } from "@/lib/admin/auth";
import { getAdminMentorStore } from "@/lib/admin/mentors-server-repository";

export const metadata: Metadata = { title: "导师与辅导订单" };

export default async function AdminMentorsPage() {
  const actor = await requireAdminActor("/admin/mentors");
  if (!actor) return null;
  const store = await getAdminMentorStore();
  return <main className="grid gap-6 p-4 md:p-6 lg:p-8"><header className="grid gap-2"><span className="flex items-center gap-2 text-sm font-semibold text-primary"><GraduationCap aria-hidden size={18} weight="duotone" />RLS 保护的导师资源</span><h1 className="text-3xl font-semibold tracking-[-0.035em]">导师与辅导订单</h1><p className="max-w-[74ch] text-sm leading-6 text-muted-foreground">管理导师身份、USDT 方案、收款方式和订单权益。订单状态使用乐观锁更新，防止覆盖其他管理员刚完成的核对。</p></header><AdminMentors actorId={actor.id} initialStore={store} /></main>;
}
