import type { Metadata } from "next";
import Link from "next/link";
import { ShieldWarning } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@wavekb/ui";
import { AdminNavigation } from "@/components/admin-navigation";
import { getAdminActor } from "@/lib/admin/auth";
import { getCurrentUser } from "@/lib/auth/dal";

export const metadata: Metadata = { title: { default: "管理后台", template: "%s | WaveKB 管理后台" }, robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await getAdminActor();
  if (!actor) {
    const user = await getCurrentUser();
    if (!user) return children;
    return <main className="mx-auto grid max-w-3xl gap-4 px-4 py-16 md:px-6"><ShieldWarning aria-hidden size={34} weight="duotone" className="text-destructive" /><h1 className="text-2xl font-semibold">没有后台访问权限</h1><p className="text-sm leading-6 text-muted-foreground">当前账号不是有效管理员。页面没有请求用户列表或其他后台数据。</p><Button asChild variant="secondary" className="w-fit"><Link href="/">返回网站</Link></Button></main>;
  }
  return <div className="mx-auto grid max-w-[100rem] lg:grid-cols-[15rem_minmax(0,1fr)]"><AdminNavigation actorName={actor.displayName} /><div className="min-w-0">{children}</div></div>;
}
