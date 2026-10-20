import type { Metadata } from "next";
import { ChartLineUp } from "@phosphor-icons/react/dist/ssr";
import { PageHeader } from "@wavekb/ui";
import { AdminEngagementSettings } from "@/components/admin-engagement-settings";
import { requireAdminActor } from "@/lib/admin/auth";
import { getAdminEngagementSettings } from "@/lib/admin/engagement-server-repository";

export const metadata: Metadata = { title: "互动与展示" };

export default async function AdminEngagementPage() {
  const actor = await requireAdminActor("/admin/engagement");
  if (!actor) return null;
  const settings = await getAdminEngagementSettings();
  return (
    <main className="grid gap-6 p-4 md:p-6 lg:p-8">
      <PageHeader
        eyebrow="Community display governance"
        title="互动与展示"
        description="调节浏览/点赞展示加成、真实点赞积分和活跃权重。虚拟数据与真实积分完全隔离，关闭开关即可恢复只显示真实计数。"
        icon={<ChartLineUp aria-hidden size={18} weight="duotone" className="text-primary" />}
      />
      <AdminEngagementSettings actorId={actor.id} initialSettings={settings} />
    </main>
  );
}
