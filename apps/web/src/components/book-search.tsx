"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { Input, Label } from "@wavekb/ui";

export type BookSearchItem = {
  id: string;
  title: string;
  text: string;
  meta: string;
  href: string;
};

const numeralAliases: Record<string, string> = { 一: "1", 二: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9" };

function normalizeForSearch(value: string) {
  return value
    .toLocaleLowerCase("zh-CN")
    .replace(/第([一二三四五六七八九])(?=[浪章节])/g, (_, numeral: string) => `第${numeralAliases[numeral] || numeral}`);
}

function resultSnippet(text: string, query: string) {
  const compact = text.replace(/\s+/g, " ").trim();
  const index = normalizeForSearch(compact).indexOf(normalizeForSearch(query));
  if (index < 0) return compact.slice(0, 116);
  const start = Math.max(0, index - 38);
  const end = Math.min(compact.length, index + query.length + 72);
  return `${start ? "…" : ""}${compact.slice(start, end)}${end < compact.length ? "…" : ""}`;
}

function Highlight({ text, query }: { text: string; query: string }) {
  const index = normalizeForSearch(text).indexOf(normalizeForSearch(query));
  if (index < 0) return text;
  return <>{text.slice(0, index)}<mark className="rounded-sm bg-primary/15 px-0.5 text-foreground">{text.slice(index, index + query.length)}</mark>{text.slice(index + query.length)}</>;
}

export function BookSearch({ bookId, items, placeholder = "搜索本书章节、概念和正文", initialQuery = "" }: { bookId: string; items: BookSearchItem[]; placeholder?: string; initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery.slice(0, 80));

  const results = useMemo(() => {
    const normalized = normalizeForSearch(query.trim());
    if (!normalized) return [];
    return items
      .filter((item) => normalizeForSearch(`${item.title} ${item.text} ${item.meta}`).includes(normalized))
      .slice(0, 24);
  }, [items, query]);

  function updateQuery(value: string) {
    const nextQuery = value.slice(0, 80);
    setQuery(nextQuery);
    const url = new URL(window.location.href);
    if (nextQuery.trim()) url.searchParams.set("q", nextQuery);
    else url.searchParams.delete("q");
    window.history.replaceState(window.history.state, "", url);
  }

  return (
    <section className="grid gap-3 border-y py-5" aria-labelledby={`${bookId}-search-title`}>
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div className="grid gap-2">
          <Label id={`${bookId}-search-title`} htmlFor={`${bookId}-search`} className="text-sm font-semibold">搜索本书</Label>
          <div className="relative max-w-2xl">
            <MagnifyingGlass aria-hidden size={19} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input id={`${bookId}-search`} type="search" value={query} onChange={(event) => updateQuery(event.target.value)} placeholder={placeholder} className="pl-10" />
          </div>
        </div>
        <Link href="/knowledge#knowledge-search" className="text-sm font-medium text-primary hover:underline">搜索全部知识库</Link>
      </div>

      {query.trim() ? results.length ? (
        <div className="divide-y overflow-hidden rounded-lg border bg-surface" aria-live="polite">
          {results.map((item) => {
            const snippet = resultSnippet(item.text, query.trim());
            return (
              <Link key={item.id} href={item.href} className="grid gap-1 px-4 py-3 hover:bg-muted">
                <span className="flex flex-wrap items-baseline justify-between gap-2"><strong className="text-sm"><Highlight text={item.title} query={query.trim()} /></strong><span className="text-xs text-muted-foreground">{item.meta}</span></span>
                <span className="text-xs leading-5 text-muted-foreground"><Highlight text={snippet} query={query.trim()} /></span>
              </Link>
            );
          })}
        </div>
      ) : <p className="text-sm text-muted-foreground" role="status">没有找到匹配内容，可以尝试结构名称、规则或原书术语。</p> : <p className="text-xs text-muted-foreground">搜索结果仅来自当前图书；关键词会保存在页面地址中。</p>}
    </section>
  );
}
