"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { Button } from "@wavekb/ui";
import type { TradingWorkbenchView } from "@/lib/trading/workbench-repository";

const weekdays = ["一", "二", "三", "四", "五", "六", "日"];
const monthName = new Intl.DateTimeFormat("zh-CN", { timeZone: "UTC", year: "numeric", month: "long" });
const fullAmount = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "USD", signDisplay: "exceptZero" });
const compactAmount = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 2, signDisplay: "exceptZero" });
const green = ["bg-success/10", "bg-success/20", "bg-success/30"];
const red = ["bg-destructive/10", "bg-destructive/20", "bg-destructive/30"];

type CalendarProps = Pick<TradingWorkbenchView, "calendar" | "timezone" | "trades">;

function dateKey(date: Date, formatter: Intl.DateTimeFormat) {
  if (!Number.isFinite(date.getTime())) return "";
  const parts = formatter.formatToParts(date);
  return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type)?.value).join("-");
}

function shiftMonth(month: string, delta: number) {
  const first = new Date(`${month}-01T00:00:00Z`);
  first.setUTCMonth(first.getUTCMonth() + delta);
  return first.toISOString().slice(0, 7);
}

function usd(value: string | null | undefined) {
  const amount = value?.trim() ? Number(value) : NaN;
  return Number.isFinite(amount) ? amount : null;
}

function formatPnl(amount: number, compact = false) {
  if (amount !== 0 && Math.abs(amount) < 0.01) {
    if (compact) return amount > 0 ? "+<.01" : "−<.01";
    return `${amount > 0 ? "盈利" : "亏损"}不足 US$0.01`;
  }
  return compact ? compactAmount.format(amount) : fullAmount.format(amount);
}

function tone(amount: number | null, maximum: number) {
  if (amount === null || amount === 0) return "bg-surface-subtle";
  const level = Math.max(0, Math.min(2, Math.ceil((Math.abs(amount) / maximum) * 3) - 1));
  return (amount > 0 ? green : red)[level];
}

export function TradingPnlCalendar({ calendar, timezone, trades }: CalendarProps) {
  const heading = useId();
  const [requestedMonth, setRequestedMonth] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const localDate = useMemo(() => new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }), [timezone]);
  const observed = calendar.filter(({ local_date }) => /^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(local_date));
  const months = observed.map(({ local_date }) => local_date.slice(0, 7)).sort();
  const firstMonth = months[0] ?? dateKey(new Date(), localDate).slice(0, 7);
  const latestMonth = months.at(-1) ?? firstMonth;
  const month = requestedMonth && requestedMonth >= firstMonth && requestedMonth <= latestMonth ? requestedMonth : latestMonth;
  const first = new Date(`${month}-01T00:00:00Z`);
  const offset = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const entries = new Map(observed.filter(({ local_date }) => local_date.startsWith(month)).map((day) => [day.local_date, day]));
  const maximum = Math.max(0, ...Array.from(entries.values(), ({ net_pnl_usd }) => Math.abs(usd(net_pnl_usd) ?? 0)));
  const active = selected?.startsWith(month) ? selected : null;
  const selectedAmount = active ? usd(entries.get(active)?.net_pnl_usd) : null;
  const selectedTrades = active ? trades.filter((trade) => dateKey(new Date(trade.closed_at ?? trade.opened_at), localDate) === active) : [];

  function moveMonth(direction: number) {
    setRequestedMonth(shiftMonth(month, direction));
    setSelected(null);
  }

  return <section aria-labelledby={heading} className="min-w-0 rounded-card border bg-surface p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 id={heading} className="text-xl font-semibold">交易日历</h2>
      <p className="text-xs text-muted-foreground">每日盈亏（USD） · {timezone}</p>
    </div>
    <div className="my-3 flex items-center justify-between gap-2">
      <Button type="button" size="icon" variant="ghost" aria-label="上一月" disabled={month <= firstMonth} onClick={() => moveMonth(-1)}><CaretLeft size={18} aria-hidden /></Button>
      <span aria-live="polite" className="font-semibold tabular-nums">{monthName.format(first)}</span>
      <Button type="button" size="icon" variant="ghost" aria-label="下一月" disabled={month >= latestMonth} onClick={() => moveMonth(1)}><CaretRight size={18} aria-hidden /></Button>
    </div>
    <div className="grid grid-cols-7 gap-1" role="group" aria-label="月度盈亏">
      {weekdays.map((day) => <span key={day} className="py-1 text-center text-xs text-muted-foreground">{day}</span>)}
      {Array.from({ length: offset }, (_, index) => <span key={`blank-${index}`} aria-hidden />)}
      {Array.from({ length: days }, (_, index) => {
        const date = `${month}-${String(index + 1).padStart(2, "0")}`;
        const data = entries.get(date);
        const amount = usd(data?.net_pnl_usd);
        const label = data ? `${date}，${data.trade_count} 笔，${amount === null ? "缺少估值" : formatPnl(amount)}` : `${date}，暂无记录`;
        return <button type="button" key={date} title={label} aria-label={label} aria-pressed={active === date}
          onClick={() => setSelected(date)}
          className={`grid min-h-12 min-w-0 content-center gap-0.5 rounded-control px-0.5 py-1 text-center text-foreground tabular-nums hover:ring-1 hover:ring-ring focus-visible:ring-2 focus-visible:ring-ring aria-pressed:ring-2 aria-pressed:ring-primary ${tone(amount, maximum)}`}>
          <span className="text-xs font-medium" aria-hidden>{index + 1}</span>
          <span className="truncate text-[0.6875rem] font-semibold leading-tight sm:text-xs" aria-hidden>{amount === null ? "—" : formatPnl(amount, true)}</span>
        </button>;
      })}
    </div>
    <p className="mt-3 text-xs text-muted-foreground">绿色为盈利，红色为亏损；颜色越深，本月同一统计范围内的盈亏绝对值越大。</p>
    <div className="mt-3 border-t pt-3" aria-live="polite">
      {active ? <>
        <p className="flex flex-wrap items-center justify-between gap-2 text-sm"><strong>{active}</strong>{selectedAmount === null ? null : <span className="tabular-nums">{formatPnl(selectedAmount)}</span>}</p>
        {selectedTrades.length ? <ul aria-label="当日交易" className="mt-2 grid gap-1.5">
          {selectedTrades.map((trade) => {
            const amount = usd(trade.usd_net_pnl);
            return <li key={trade.id}>
              <Link href={`/workbench/trades/${trade.id}`} className="flex min-h-9 items-center justify-between gap-2 rounded-control bg-surface-subtle px-2 py-1 text-sm hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                <span className="min-w-0 truncate">{trade.symbol} <span className="text-xs text-muted-foreground">{trade.account_label}</span></span>
                <span className="shrink-0 tabular-nums">{amount === null ? "—" : formatPnl(amount)}</span>
              </Link>
            </li>;
          })}
        </ul> : <p className="mt-1 text-xs text-muted-foreground">当前筛选下没有当天的交易记录。</p>}
      </> : <p className="text-xs text-muted-foreground">{observed.length ? "选择日期查看当天的交易复盘。" : "当前筛选下暂无每日盈亏记录。"}</p>}
    </div>
  </section>;
}
