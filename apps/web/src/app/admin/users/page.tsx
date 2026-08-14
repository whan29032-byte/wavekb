import type { Metadata } from "next";
import { FunnelSimple, ShieldCheck } from "@phosphor-icons/react/dist/ssr";
import { Button, Input } from "@wavekb/ui";
import { AdminUsers } from "@/components/admin-users";
import { AdminUserRewards } from "@/components/admin-rewards";
import { requireAdminActor } from "@/lib/admin/auth";
import { getAdminSummary, listAdminUsers } from "@/lib/admin/server-repository";
import { getAdminRewardStore } from "@/lib/admin/rewards-server-repository";

export const metadata: Metadata = { title: "用户管理" };

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<{ query?: string; status?: string; role?: string; page?: string }> }) {
  const params = await searchParams;
  const actor = await requireAdminActor("/admin/users");
  if (!actor) return null;
  const page = Math.max(1, Number(params.page || 1));
  const [summary, result, rewards] = await Promise.all([getAdminSummary(), listAdminUsers({ ...params, page, limit: 25 }), getAdminRewardStore()]);
  const queryString = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => typeof entry[1] === "string")).toString();
  return <main className="grid gap-8 p-4 md:p-6 lg:p-8"><header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between"><div className="grid gap-2"><span className="flex items-center gap-2 text-sm font-semibold text-primary"><ShieldCheck aria-hidden size={18} weight="duotone" />服务端管理员权限</span><h1 className="text-3xl font-semibold tracking-[-0.035em]">用户管理</h1><p className="max-w-[70ch] text-sm leading-6 text-muted-foreground">账户、UID、权限、积分与身份权益集中管理，敏感操作保留审计记录。</p></div><form className="grid gap-2 sm:grid-cols-[minmax(13rem,1fr)_auto_auto_auto]" action="/admin/users"><Input type="search" name="query" defaultValue={params.query || ""} placeholder="搜索 UID、昵称或邮箱" aria-label="搜索用户" /><select name="status" defaultValue={params.status || "all"} className="h-10 rounded-lg border bg-background px-3 text-sm"><option value="all">全部状态</option><option value="active">正常</option><option value="muted">禁言中</option><option value="banned">已封禁</option></select><select name="role" defaultValue={params.role || "all"} className="h-10 rounded-lg border bg-background px-3 text-sm"><option value="all">全部权限</option><option value="user">普通用户</option><option value="admin">管理员</option></select><Button type="submit"><FunnelSimple aria-hidden size={17} />筛选</Button></form></header><AdminUsers summary={summary} users={result.users} total={result.total} page={result.page} limit={result.limit} queryString={queryString} /><AdminUserRewards actorId={actor.id} initialStore={rewards} /></main>;
}
