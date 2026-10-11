import Link from "next/link";
import type { ReactNode } from "react";
import { youtubePolicyVersion } from "@/lib/youtube/contracts";

export const policyLinkClass = "text-primary underline underline-offset-4 hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-4";

export function SitePolicyPage({ title, summary, children }: { title: string; summary: string; children: ReactNode }) {
  return <main className="mx-auto grid max-w-3xl gap-8 px-4 py-8 md:px-6 md:py-12">
    <header className="grid gap-3 border-b pb-6">
      <p className="text-sm font-medium text-primary">WaveKB · 数据与使用说明</p>
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="max-w-[70ch] text-base leading-7 text-muted-foreground">{summary}</p>
      <p className="break-words text-sm leading-6 text-muted-foreground">更新日期：2026 年 10 月 11 日 · YouTube 功能政策版本：<span className="break-all">{youtubePolicyVersion}</span></p>
    </header>
    <article className="grid gap-8 text-base leading-7 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_p+p]:mt-3 [&_li+li]:mt-2 [&_section]:scroll-mt-24">{children}</article>
    <nav aria-label="政策页面导航" className="flex flex-wrap gap-x-6 gap-y-2 border-t pt-4 text-sm">
      <Link className={`${policyLinkClass} flex min-h-11 items-center`} href="/">返回 WaveKB</Link>
      <Link className={`${policyLinkClass} flex min-h-11 items-center`} href="/privacy">隐私政策</Link>
      <Link className={`${policyLinkClass} flex min-h-11 items-center`} href="/terms">服务条款</Link>
      <a className={`${policyLinkClass} flex min-h-11 items-center break-all`} href="mailto:whan29032@gmail.com">联系 WaveKB</a>
    </nav>
  </main>;
}
