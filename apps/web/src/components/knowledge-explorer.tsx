"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { Input, Label } from "@wavekb/ui";

type KnowledgeListItem = {
  id: string;
  title: string;
  kind: "core" | "candidate";
  parent: string | null;
  searchText: string;
  href?: string;
};

export function KnowledgeExplorer({ items }: { items: KnowledgeListItem[] }) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    if (!normalized) return [];
    return items
      .filter((item) => `${item.title} ${item.searchText}`.toLocaleLowerCase("zh-CN").includes(normalized))
      .slice(0, 30);
  }, [items, query]);

  return (
    <section id="knowledge-search" className="grid scroll-mt-24 gap-4" aria-labelledby="knowledge-explorer-title">
      <div className="grid gap-2">
        <h2 id="knowledge-explorer-title" className="text-xl font-semibold tracking-tight">搜索全部知识库</h2>
        <div className="relative max-w-2xl">
          <MagnifyingGlass aria-hidden size={19} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Label htmlFor="knowledge-search" className="sr-only">搜索知识标题和正文</Label>
          <Input id="knowledge-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如：锯齿、延长、失效条件" className="pl-10" />
        </div>
      </div>
      {query.trim() ? results.length ? (
        <div className="divide-y border-y" aria-live="polite">
          {results.map((item) => (
            <Link key={item.id} href={item.href || `/knowledge/${item.id}`} className="flex items-center justify-between gap-4 px-1 py-3 hover:text-primary">
              <strong className="text-sm font-semibold leading-6">{item.title}</strong>
              <span className="text-xs text-muted-foreground">{item.kind === "core" ? "核心知识" : "已核验辅助资料"}</span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground" role="status">没有匹配的条目。可以换一个结构名称或规则关键词。</p>
      ) : <p className="text-xs text-muted-foreground">可以搜索规则、结构、章节、失效条件或图书名称。</p>}
    </section>
  );
}
