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
};

export function KnowledgeExplorer({ items }: { items: KnowledgeListItem[] }) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    if (!normalized) return items.slice(0, 18);
    return items
      .filter((item) => `${item.title} ${item.searchText}`.toLocaleLowerCase("zh-CN").includes(normalized))
      .slice(0, 30);
  }, [items, query]);

  return (
    <section className="grid gap-4" aria-labelledby="knowledge-explorer-title">
      <div className="grid gap-2">
        <h2 id="knowledge-explorer-title" className="text-2xl font-semibold tracking-tight">查找知识条目</h2>
        <div className="relative max-w-xl">
          <MagnifyingGlass aria-hidden size={19} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Label htmlFor="knowledge-search" className="sr-only">搜索知识标题和正文</Label>
          <Input id="knowledge-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如：锯齿、延长、失效条件" className="pl-10" />
        </div>
      </div>
      {results.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {results.map((item) => (
            <Link key={item.id} href={`/knowledge/${item.id}`} className="grid gap-1 rounded-xl border bg-surface p-4 hover:border-primary/45">
              <strong className="text-sm font-semibold leading-6">{item.title}</strong>
              <span className="text-xs text-muted-foreground">{item.kind === "core" ? "核心知识" : "已核验辅助资料"}</span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed bg-surface p-6 text-sm text-muted-foreground">没有匹配的条目。可以换一个结构名称或规则关键词。</div>
      )}
    </section>
  );
}
