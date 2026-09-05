"use client";

import Link from "next/link";
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

  return <div ref={root} className="md:hidden">
    <button ref={trigger} type="button" aria-label={open ? "收起主导航" : "展开主导航"} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="grid size-11 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">{open ? <X aria-hidden size={20} /> : <List aria-hidden size={20} />}</button>
    {open ? <nav id={id} aria-label="移动主导航" className="absolute inset-x-4 top-full mt-2 grid gap-1 rounded-xl border bg-surface p-2 shadow-xl">
      {[["知识库", "/knowledge"], ["社区", "/community/idea_sharing"], ["导师", "/mentors"], ["积分商城", "/rewards"], ["机构研报", "/research"]].map(([label, href]) => <Link key={href} href={href} prefetch={href === "/research" ? false : undefined} aria-current={pathname?.startsWith(href) ? "page" : undefined} onClick={() => setOpen(false)} className="flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold hover:bg-muted aria-[current=page]:bg-muted aria-[current=page]:text-primary">{label}</Link>)}
    </nav> : null}
  </div>;
}
