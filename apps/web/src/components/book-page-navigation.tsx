"use client";

import { useEffect, useState } from "react";
import { Input, Label } from "@wavekb/ui";
import { BOOK_LOCATION_EVENT, BookReadingLink, navigateToBookTarget, scrollToBookTarget } from "./book-reading-link";

export function BookPageNavigation({ bookId, pageNumbers }: { bookId: string; pageNumbers: number[] }) {
  const [currentPage, setCurrentPage] = useState<number | null>(null);
  const [requestedPage, setRequestedPage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    function syncLocation(scroll = false) {
      const match = /^#page-(\d+)$/.exec(window.location.hash);
      const page = match ? Number(match[1]) : null;
      if (scroll && window.location.hash) scrollToBookTarget(window.location.hash);
      const nextPage = page !== null && pageNumbers.includes(page) ? page : null;
      setCurrentPage(nextPage);
      setRequestedPage(nextPage === null ? "" : String(nextPage));
      setError("");
    }
    const fromNavigation = () => syncLocation();
    const fromHistory = () => syncLocation(true);
    // Late hydration must not move focus away from a control the reader has already chosen.
    const activeElement = document.activeElement;
    const restoreInitialFocus = activeElement === null || activeElement === document.body || activeElement === document.documentElement;
    syncLocation(restoreInitialFocus);
    window.addEventListener(BOOK_LOCATION_EVENT, fromNavigation);
    window.addEventListener("hashchange", fromHistory);
    window.addEventListener("popstate", fromHistory);
    return () => {
      window.removeEventListener(BOOK_LOCATION_EVENT, fromNavigation);
      window.removeEventListener("hashchange", fromHistory);
      window.removeEventListener("popstate", fromHistory);
    };
  }, [pageNumbers]);

  if (!pageNumbers.length) return null;
  const index = currentPage === null ? 0 : pageNumbers.indexOf(currentPage);
  const windowStart = Math.max(0, Math.min(index - 3, pageNumbers.length - 7));
  const visiblePages = pageNumbers.slice(windowStart, windowStart + 7);
  const controlClass = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border px-3 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

  return <div className="grid gap-3 sm:col-span-2">
    <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
      event.preventDefault();
      const page = /^\d+$/.test(requestedPage) ? Number(requestedPage) : NaN;
      if (!pageNumbers.includes(page)) {
        setError(`请输入本书已有页码（${pageNumbers[0]}–${pageNumbers[pageNumbers.length - 1]}）。`);
        return;
      }
      if (!navigateToBookTarget(`#page-${page}`)) setError("未找到该页正文，请刷新页面后重试。");
    }}>
      <div className="grid gap-1.5">
        <Label htmlFor={`${bookId}-jump-page`} className="text-xs font-medium">跳至页码</Label>
        <Input id={`${bookId}-jump-page`} type="text" inputMode="numeric" pattern="[0-9]*" value={requestedPage} onChange={(event) => { setRequestedPage(event.target.value); setError(""); }} aria-invalid={Boolean(error)} aria-describedby={error ? `${bookId}-jump-error` : `${bookId}-jump-hint`} className="min-h-11 w-24 tabular-nums" />
      </div>
      <button type="submit" className={`${controlClass} bg-primary text-primary-foreground hover:bg-primary-hover`}>跳转</button>
      {index > 0 ? <BookReadingLink href={`#page-${pageNumbers[index - 1]}`} className={controlClass}>上一页</BookReadingLink> : <span aria-disabled="true" className={`${controlClass} text-muted-foreground opacity-50`}>上一页</span>}
      {index < pageNumbers.length - 1 ? <BookReadingLink href={`#page-${pageNumbers[index + 1]}`} className={controlClass}>下一页</BookReadingLink> : <span aria-disabled="true" className={`${controlClass} text-muted-foreground opacity-50`}>下一页</span>}
    </form>
    <p id={`${bookId}-jump-hint`} className="text-xs text-muted-foreground" role="status">{currentPage === null ? `共 ${pageNumbers.length} 页，可输入页码直接定位。` : `当前定位：第 ${currentPage} 页 / 共 ${pageNumbers.length} 页。`}</p>
    {error ? <p id={`${bookId}-jump-error`} role="alert" className="text-sm text-destructive">{error}</p> : null}
    <div className="flex flex-wrap gap-2" aria-label="正文页码">
      {visiblePages.map((page) => <BookReadingLink key={page} href={`#page-${page}`} aria-label={`生成 · 第 ${page} 页`} aria-current={page === currentPage ? "page" : undefined} className={`${controlClass} ${page === currentPage ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground"}`}>{page}</BookReadingLink>)}
    </div>
  </div>;
}
