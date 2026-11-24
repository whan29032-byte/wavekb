"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowsClockwise, CaretRight, ChartLineUp, LockKey, WarningCircle } from "@phosphor-icons/react";
import { Button } from "@wavekb/ui";
import { ExchangeAccountManager } from "./exchange-account-manager";
import { browserTimezone, getTradingWorkbench, type TradingWorkbenchView } from "@/lib/trading/workbench-repository";
import type { TradingRange } from "@wavekb/domain/trading-review";

const providerLabels: Record<string, string> = { binance: "Binance", okx: "OKX", bybit: "Bybit", bitget: "Bitget", exness: "Exness" };
const money = (value: string | null) => value === null ? "—" : new Intl.NumberFormat("zh-CN", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(value));

export function TradingWorkbenchDashboard({ actorId }: { actorId: string }) {
  const [range, setRange] = useState<TradingRange>("30d");
  const [provider, setProvider] = useState("");
  const [connectionId, setConnectionId] = useState("");
  const [data, setData] = useState<TradingWorkbenchView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const tradeLinks = useRef<Array<HTMLAnchorElement | null>>([]);
  const timezone = browserTimezone();

  useEffect(() => {
    let active = true; setLoading(true); setError("");
    void getTradingWorkbench({ range, provider: provider || undefined, connectionId: connectionId || undefined, timezone })
      .then((value) => { if (active) setData(value); })
      .catch(() => { if (active) setError("交易数据暂时无法读取，请稍后重试。"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [range, provider, connectionId, timezone, refreshKey]);

  const availableAccounts = (data?.connections ?? []).filter((item) => !provider || item.provider === provider);
  function moveTradeFocus(index: number, key: string) {
    if (key !== "ArrowDown" && key !== "ArrowUp") return;
    const next = key === "ArrowDown" ? Math.min(index + 1, tradeLinks.current.length - 1) : Math.max(index - 1, 0);
    tradeLinks.current[next]?.focus();
  }

  return <main data-testid="workbench-dashboard" className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:px-8">
    <header className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
      <div className="grid gap-2"><span className="flex items-center gap-2 text-sm font-semibold text-primary"><LockKey size={18} weight="duotone" />仅当前账号可见</span><h1 className="text-3xl font-semibold tracking-[-0.04em] md:text-5xl">交易工作台</h1><p className="max-w-2xl text-sm leading-6 text-muted-foreground">自动同步多平台只读交易记录，统一查看权益、盈利与每笔交易复盘。</p></div>
      <details className="rounded-xl border bg-surface p-4"><summary className="cursor-pointer font-semibold">管理交易账户</summary><div className="mt-5 max-w-4xl"><ExchangeAccountManager actorId={actorId} /></div></details>
    </header>

    <section className="grid gap-4 rounded-xl border bg-surface p-4 sm:grid-cols-3" aria-label="工作台筛选">
      <label className="grid gap-2 text-sm font-medium">统计范围<select aria-label="统计范围" value={range} onChange={(event) => setRange(event.target.value as TradingRange)} className="h-11 rounded-lg border bg-surface px-3"><option value="7d">近 7 天</option><option value="30d">近 30 天</option><option value="90d">近 90 天</option><option value="all">全部可用</option></select></label>
      <label className="grid gap-2 text-sm font-medium">交易平台<select aria-label="交易平台" value={provider} onChange={(event) => { setProvider(event.target.value); setConnectionId(""); }} className="h-11 rounded-lg border bg-surface px-3"><option value="">全部平台</option>{Object.entries(providerLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="grid gap-2 text-sm font-medium">交易账户<select aria-label="交易账户" value={connectionId} onChange={(event) => setConnectionId(event.target.value)} className="h-11 rounded-lg border bg-surface px-3"><option value="">全部账户</option>{availableAccounts.map((item) => <option key={item.id} value={item.id}>{item.account_label} {item.account_identifier_mask}</option>)}</select></label>
    </section>

    {loading && !data ? <p role="status" className="rounded-xl border border-dashed p-8 text-sm text-muted-foreground">正在读取已发布交易数据…</p> : null}
    {error ? <div role="alert" className="flex items-center gap-3 rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm"><WarningCircle size={20} />{error}<Button type="button" variant="secondary" onClick={() => setRefreshKey((value) => value + 1)}><ArrowsClockwise />重试</Button></div> : null}
    {data ? <>
      {data.status.kind === "no_connections" ? <section className="rounded-xl border border-dashed p-8 text-center"><h2 className="text-xl font-semibold">先连接一个只读交易账户</h2><p className="mt-2 text-sm text-muted-foreground">支持 Binance、OKX、Bybit、Bitget 和 Exness。</p></section> : null}
      {data.status.messages.length ? <section className="grid gap-2 rounded-xl border border-amber-300/50 bg-amber-50/50 p-4 text-sm dark:bg-amber-950/10" aria-label="同步和覆盖状态">{data.status.messages.map((message) => <p key={message} className="flex items-start gap-2"><WarningCircle className="mt-0.5 shrink-0" size={18} />{message}</p>)}</section> : null}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-6" aria-label="核心指标">{data.headline_metrics.map((item) => <article key={item.key} data-testid={`headline-${item.key}`} className="rounded-xl border bg-surface p-4"><span className="text-xs text-muted-foreground">{item.label}</span><strong className="mt-2 block text-xl tabular-nums">{item.value}</strong></article>)}</section>

      <section className="grid gap-4 lg:grid-cols-2"><article className="rounded-xl border bg-surface p-5"><h2 className="text-xl font-semibold">合并权益与累计净盈利</h2><div className="mt-4 max-h-64 overflow-auto"><table className="w-full text-sm"><thead><tr className="text-left text-muted-foreground"><th className="py-2">时间</th><th>权益</th><th>净盈利</th></tr></thead><tbody>{data.series.slice(-12).map((point) => <tr key={point.at} className="border-t"><td className="py-2">{new Date(point.at).toLocaleString("zh-CN")}</td><td>{money(point.equity_usd)}</td><td>{money(point.cumulative_profit_usd)}</td></tr>)}</tbody></table></div></article><article className="rounded-xl border bg-surface p-5"><h2 className="text-xl font-semibold">交易日历</h2><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">{data.calendar.map((day) => <div key={day.local_date} className="rounded-lg bg-muted p-3"><strong className="text-sm">{day.local_date}</strong><span className="mt-1 block text-xs text-muted-foreground">{day.trade_count} 笔 · {money(day.net_pnl_usd)}</span></div>)}</div></article></section>

      <section className="grid gap-4"><h2 className="text-xl font-semibold">归因分析</h2><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{Object.entries(data.attributions).map(([name, items]) => <article key={name} className="rounded-xl border bg-surface p-4"><h3 className="font-semibold">{{ provider: "平台", account: "账户", symbol: "品种", direction: "方向", session: "时段" }[name]}</h3><ul className="mt-3 grid gap-2 text-sm">{items.slice(0, 5).map((item) => <li key={item.key} className="flex justify-between gap-2"><span className="truncate">{item.label}</span><span className="tabular-nums">{money(item.net_pnl_usd)}</span></li>)}</ul></article>)}</div></section>

      <section className="grid gap-4"><div><h2 className="text-xl font-semibold">最近交易周期</h2><p className="mt-1 text-sm text-muted-foreground">按当前范围、平台和账户筛选后的完整周期。</p></div><ul role="list" aria-label="最近交易周期" className="grid gap-2">{data.trades.map((trade, index) => <li key={trade.id}><Link ref={(node) => { tradeLinks.current[index] = node; }} onKeyDown={(event) => moveTradeFocus(index, event.key)} href={`/workbench/trades/${trade.id}`} className="grid gap-3 rounded-xl border bg-surface p-4 hover:border-primary/45 focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div><div className="flex flex-wrap items-center gap-2"><strong>{trade.symbol}</strong><span className="rounded-md bg-muted px-2 py-1 text-xs">{providerLabels[trade.provider]}</span><span className="text-xs text-muted-foreground">{trade.direction === "long" ? "多头" : "空头"} · {trade.account_label}</span></div><p className="mt-2 text-xs text-muted-foreground">{new Date(trade.opened_at).toLocaleString("zh-CN")} · {trade.review_status === "none" ? "待复盘" : trade.review_status === "needs_reconciliation" ? "需处理复盘冲突" : "已复盘"}</p></div><span className="flex items-center justify-between gap-3 font-semibold tabular-nums sm:justify-end">{money(trade.usd_net_pnl)}<CaretRight /></span></Link></li>)}</ul></section>

      <nav className="grid grid-cols-2 gap-2 rounded-xl border bg-surface p-4 sm:grid-cols-4" aria-label="工作台次级入口"><Link className="rounded-lg p-3 text-sm font-medium hover:bg-muted" href="/workbench/entries/new?kind=journal">私人记录</Link><Link className="rounded-lg p-3 text-sm font-medium hover:bg-muted" href="/workbench/entries/new?kind=draft">研究草稿</Link><Link className="rounded-lg p-3 text-sm font-medium hover:bg-muted" href="/workbench/analysis/new?step=0">历史分析工具</Link><Link className="rounded-lg p-3 text-sm font-medium hover:bg-muted" href="/workbench/ai"><ChartLineUp className="mr-2 inline" />AI 模型设置</Link></nav>
    </> : null}
  </main>;
}
