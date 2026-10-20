"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Certificate, ChartLineUp, Coins, Cpu, GraduationCap, ListMagnifyingGlass, Pulse, ShieldCheck, Storefront, Users } from "@phosphor-icons/react";

const items = [
  { href: "/admin/users", label: "用户管理", copy: "账户、UID、权限与积分", icon: Users },
  { href: "/admin/memberships", label: "会员管理", copy: "方案、有效期与授予审计", icon: Certificate },
  { href: "/admin/rewards", label: "积分商城", copy: "商品、权益与兑换", icon: Coins },
  { href: "/admin/engagement", label: "互动与展示", copy: "浏览、点赞与权重加成", icon: Pulse },
  { href: "/admin/directory", label: "首页推荐", copy: "X 与 Discord 目录", icon: Storefront },
  { href: "/admin/mentors", label: "导师与订单", copy: "方案、收款与权益", icon: GraduationCap },
  { href: "/admin/trading", label: "交易排行", copy: "连接、同步与异常治理", icon: ChartLineUp },
  { href: "/admin/ai", label: "AI 治理", copy: "网关、费用与备用接口", icon: Cpu },
  { href: "/admin/audit", label: "操作日志", copy: "治理审计记录", icon: ListMagnifyingGlass },
] as const;

export function AdminNavigation({ actorName }: { actorName: string }) {
  const pathname = usePathname();
  return <aside className="grid content-start gap-5 border-b border-border bg-surface p-4 lg:sticky lg:top-16 lg:h-[calc(100dvh-4rem)] lg:border-r lg:border-b-0 lg:p-5"><Link href="/admin/users" className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-[var(--radius-control)] bg-primary text-primary-foreground shadow-[var(--shadow-xs)]"><ShieldCheck aria-hidden size={19} weight="duotone" /></span><span><strong className="block text-sm">WaveKB 管理</strong><span className="text-xs text-muted-foreground">{actorName}</span></span></Link><nav aria-label="后台导航" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-1">{items.map((item) => { const Icon = item.icon; const active = pathname === item.href || pathname?.startsWith(`${item.href}/`); return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={`flex items-start gap-3 rounded-[var(--radius-control)] border px-3 py-2.5 text-sm transition-colors ${active ? "border-primary/20 bg-primary-selected" : "border-transparent hover:border-border hover:bg-surface-subtle"}`}><Icon aria-hidden size={18} className="mt-0.5 shrink-0 text-primary" /><span><strong className="block">{item.label}</strong><span className="hidden text-xs text-muted-foreground lg:block">{item.copy}</span></span></Link>; })}</nav></aside>;
}
