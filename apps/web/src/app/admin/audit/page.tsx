import type { Metadata } from "next";
import { ListMagnifyingGlass } from "@phosphor-icons/react/dist/ssr";
import { requireAdminActor } from "@/lib/admin/auth";
import { listAdminAudit } from "@/lib/admin/server-repository";

export const metadata: Metadata = { title: "操作日志" };

const actionLabels: Record<string, string> = { ban: "封禁账号", unban: "解除封禁", mute: "设置禁言", unmute: "解除禁言", grant_admin: "授予管理员", revoke_admin: "撤销管理员", set_uid: "修改 UID" };

export default async function AdminAuditPage() {
  const actor = await requireAdminActor("/admin/audit");
  if (!actor) return null;
  const entries = await listAdminAudit();
  return <main className="grid gap-6 p-4 md:p-6 lg:p-8"><header className="grid gap-2"><span className="flex items-center gap-2 text-sm font-semibold text-primary"><ListMagnifyingGlass aria-hidden size={18} weight="duotone" />只读治理记录</span><h1 className="text-3xl font-semibold tracking-[-0.035em]">操作日志</h1><p className="max-w-[68ch] text-sm leading-6 text-muted-foreground">最近 100 条封禁、禁言、权限和 UID 变更。记录由数据库写入，页面不提供删除能力。</p></header>{entries.length ? <section className="overflow-hidden rounded-xl border bg-surface" aria-label="治理审计记录">{entries.map((entry, index) => <article key={entry.id} className={`grid gap-3 p-4 md:grid-cols-[10rem_minmax(0,1fr)_auto] md:items-start ${index ? "border-t" : ""}`}><strong className="text-sm text-primary">{actionLabels[entry.action] || entry.action}</strong><div className="min-w-0"><p className="text-sm"><strong>{entry.actor_name}</strong> 对 <strong>{entry.target_name}</strong> 执行操作</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{entry.reason || "未填写原因"}，目标 UID {entry.target_uid || "未设置"}</p></div><time className="text-xs tabular-nums text-muted-foreground" dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString("zh-CN")}</time></article>)}</section> : <div className="rounded-xl border border-dashed bg-surface p-7 text-sm text-muted-foreground">暂无治理操作记录。</div>}</main>;
}
