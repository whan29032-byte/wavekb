import type { Metadata } from "next";
import { GraduationCap } from "@phosphor-icons/react/dist/ssr";
import { PageHeader } from "@wavekb/ui";
import { AdminMentors } from "@/components/admin-mentors";
import { requireAdminActor } from "@/lib/admin/auth";
import { getAdminMentorStore } from "@/lib/admin/mentors-server-repository";

export const metadata: Metadata = { title: "导师与辅导订单" };

export default async function AdminMentorsPage() {
  const actor = await requireAdminActor("/admin/mentors");
  if (!actor) return null;
  const store = await getAdminMentorStore();
  return <main className="grid gap-6 p-4 md:p-6 lg:p-8"><PageHeader eyebrow="Mentor operations" title="导师与辅导订单" description="管理导师身份、USDT 方案、收款方式和订单权益。订单状态使用乐观锁更新，防止覆盖其他管理员刚完成的核对。" icon={<GraduationCap aria-hidden size={18} weight="duotone" className="text-primary" />} /><AdminMentors actorId={actor.id} initialStore={store} /></main>;
}
