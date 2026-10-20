"use client";

import { ReadingPriorityLink as Link } from "@/components/reading-priority-link";
import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { List, X } from "@phosphor-icons/react";

export function MobileNavigation() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const pathname = usePathname();

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [open]);

  const items = [
    { label: "知识库", href: "/knowledge", matches: (path: string) => path.startsWith("/knowledge") },
    { label: "交易收益榜", href: "/leaderboard", matches: (path: string) => path.startsWith("/leaderboard") },
    { label: "社区", href: "/community/idea_sharing", matches: (path: string) => path.startsWith("/community") },
    { label: "导师", href: "/mentors", matches: (path: string) => path.startsWith("/mentors") || path.startsWith("/tutoring") },
    { label: "积分商城", href: "/rewards", matches: (path: string) => path.startsWith("/rewards") },
    { label: "机构研报", href: "/research", matches: (path: string) => path.startsWith("/research"), prefetch: false },
  ] as const;

  return <div ref={root} className="lg:hidden">
    <button ref={trigger} type="button" aria-label={open ? "收起主导航" : "展开主导航"} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="grid size-11 cursor-pointer place-items-center rounded-[var(--radius-control)] text-muted-foreground transition-colors hover:bg-surface-subtle hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">{open ? <X aria-hidden size={20} /> : <List aria-hidden size={20} />}</button>
    {open ? <nav id={id} aria-label="移动主导航" className="absolute inset-x-4 top-full mt-2 grid gap-1 rounded-[var(--radius-card)] border bg-popover p-2 shadow-[var(--shadow-floating)]">
      {items.map((item) => {
        const active = pathname ? item.matches(pathname) : false;
        return <Link key={item.href} href={item.href} prefetch={"prefetch" in item ? item.prefetch : undefined} aria-current={active ? "page" : undefined} onClick={() => setOpen(false)} className="flex min-h-11 items-center rounded-[var(--radius-control)] px-3 text-sm font-semibold transition-colors hover:bg-surface-subtle aria-[current=page]:bg-primary-selected aria-[current=page]:text-primary">{item.label}</Link>;
      })}
    </nav> : null}
  </div>;
}
