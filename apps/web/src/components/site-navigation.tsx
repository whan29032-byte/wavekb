"use client";

import { usePathname } from "next/navigation";
import { BookOpenText, ChatsCircle, Coins, GraduationCap, Newspaper, Trophy } from "@phosphor-icons/react";
import { ReadingPriorityLink as Link } from "@/components/reading-priority-link";

const items = [
  {
    href: "/knowledge",
    label: "知识库",
    ariaLabel: "知识库",
    icon: BookOpenText,
    labelClass: "",
    matches: (pathname: string) => pathname === "/knowledge" || pathname.startsWith("/knowledge/"),
  },
  {
    href: "/community/idea_sharing",
    label: "社区",
    ariaLabel: "社区",
    icon: ChatsCircle,
    labelClass: "",
    matches: (pathname: string) => pathname === "/community" || pathname.startsWith("/community/"),
  },
  {
    href: "/mentors",
    label: "导师",
    ariaLabel: "导师",
    icon: GraduationCap,
    labelClass: "",
    matches: (pathname: string) => pathname === "/mentors" || pathname.startsWith("/mentors/") || pathname.startsWith("/tutoring"),
  },
  {
    href: "/leaderboard",
    label: "收益榜",
    ariaLabel: "交易收益排行榜",
    icon: Trophy,
    labelClass: "hidden xl:inline",
    matches: (pathname: string) => pathname === "/leaderboard",
  },
  {
    href: "/rewards",
    label: "积分商城",
    ariaLabel: "积分商城",
    icon: Coins,
    labelClass: "hidden xl:inline",
    matches: (pathname: string) => pathname === "/rewards",
  },
  {
    href: "/research",
    label: "机构研报",
    ariaLabel: "机构研报",
    icon: Newspaper,
    labelClass: "hidden xl:inline",
    prefetch: false,
    matches: (pathname: string) => pathname === "/research" || pathname.startsWith("/research/"),
  },
] as const;

export function SiteNavigation() {
  const pathname = usePathname();
  return (
    <nav aria-label="主导航" className="hidden items-center gap-1 lg:flex">
      {items.map((item) => {
        const Icon = item.icon;
        const active = pathname ? item.matches(pathname) : false;
        return (
          <Link
            key={item.href}
            href={item.href}
            prefetch={"prefetch" in item ? item.prefetch : undefined}
            aria-label={item.ariaLabel}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] px-3 py-2 text-sm font-medium transition-colors ${active ? "bg-primary-selected text-primary" : "text-muted-foreground hover:bg-surface-subtle hover:text-foreground"}`}
          >
            <Icon aria-hidden size={18} weight="duotone" />
            <span className={item.labelClass}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
