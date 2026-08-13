import type { Metadata } from "next";
import { Storefront } from "@phosphor-icons/react/dist/ssr";
import { AdminDirectory } from "@/components/admin-directory";
import { requireAdminActor } from "@/lib/admin/auth";
import { listAdminDirectory } from "@/lib/admin/server-repository";

export const metadata: Metadata = { title: "首页推荐管理" };

export default async function AdminDirectoryPage() {
  const actor = await requireAdminActor("/admin/directory");
  if (!actor) return null;
  const resources = await listAdminDirectory();
  return <main className="grid gap-6 p-4 md:p-6 lg:p-8"><header className="grid gap-2"><span className="flex items-center gap-2 text-sm font-semibold text-primary"><Storefront aria-hidden size={18} weight="duotone" />网关验证公开资源</span><h1 className="text-3xl font-semibold tracking-[-0.035em]">首页推荐</h1><p className="max-w-[72ch] text-sm leading-6 text-muted-foreground">管理首页展示的 X 博主与 Discord 波浪社区。外部地址、头像和平台类型由内网网关重新校验。</p></header><AdminDirectory initialResources={resources} /></main>;
}
