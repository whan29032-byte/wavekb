import Link from "next/link";
import { Coins, ListMagnifyingGlass, ShieldCheck, Users } from "@phosphor-icons/react/dist/ssr";

const items = [
  { href: "/admin/users", label: "用户管理", copy: "账户、权限与 UID", icon: Users },
  { href: "/admin/rewards", label: "积分商城", copy: "商品、钱包与兑换", icon: Coins },
  { href: "/admin/audit", label: "操作日志", copy: "治理审计记录", icon: ListMagnifyingGlass },
] as const;

export function AdminNavigation({ actorName }: { actorName: string }) {
  return <aside className="grid content-start gap-5 border-b bg-surface p-4 lg:sticky lg:top-16 lg:h-[calc(100dvh-4rem)] lg:border-r lg:border-b-0 lg:p-5"><Link href="/admin/users" className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground"><ShieldCheck aria-hidden size={19} weight="duotone" /></span><span><strong className="block text-sm">WaveKB 管理</strong><span className="text-xs text-muted-foreground">{actorName}</span></span></Link><nav aria-label="后台导航" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-1">{items.map((item) => { const Icon = item.icon; return <Link key={item.href} href={item.href} className="flex items-start gap-3 rounded-lg border border-transparent px-3 py-2.5 text-sm hover:border-border hover:bg-muted"><Icon aria-hidden size={18} className="mt-0.5 shrink-0 text-primary" /><span><strong className="block">{item.label}</strong><span className="hidden text-xs text-muted-foreground lg:block">{item.copy}</span></span></Link>; })}</nav></aside>;
}
