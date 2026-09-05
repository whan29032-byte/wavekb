import Link from "next/link";
import { Button } from "@wavekb/ui";
import { paginationHref, parsePage, type PaginationQuery } from "@/lib/pagination";

export function Pagination({ page, hasNext, pathname, query, pageKey = "page" }: {
  page: number; hasNext: boolean; pathname: string; query?: PaginationQuery; pageKey?: string;
}) {
  const current = parsePage(page);
  return <nav aria-label="分页" className="flex flex-wrap items-center justify-center gap-3">
    {current > 1 ? <Button asChild variant="secondary"><Link href={paginationHref(pathname, current - 1, query, pageKey)}>上一页</Link></Button> : null}
    <span className="text-sm tabular-nums text-muted-foreground">第 {current} 页</span>
    {hasNext ? <Button asChild variant="secondary"><Link href={paginationHref(pathname, current + 1, query, pageKey)}>下一页</Link></Button> : null}
  </nav>;
}
