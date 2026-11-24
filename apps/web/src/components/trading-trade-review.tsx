"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { Field, Input, Label, Textarea } from "@wavekb/ui";
import { browserTimezone, getTradingTrade, saveTradingReview, TradingRepositoryError, type SaveTradingReviewInput, type TradingTradeDetail } from "@/lib/trading/workbench-repository";

const providerLabels: Record<string, string> = { binance: "Binance", okx: "OKX", bybit: "Bybit", bitget: "Bitget", exness: "Exness" };
const selectClass = "h-11 rounded-lg border bg-surface px-3 text-sm";

export function TradingTradeReview({ tradeId }: { tradeId: string }) {
  const [detail, setDetail] = useState<TradingTradeDetail | null>(null);
  const [draft, setDraft] = useState<SaveTradingReviewInput | null>(null);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState("正在读取交易事实…");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void getTradingTrade(tradeId, browserTimezone()).then((value) => {
      if (!active) return;
      setDetail(value);
      setDraft({ expected_cycle_revision: value.trade.revision, reason: value.review?.reason ?? "", plan_compliance: value.review?.plan_compliance ?? "unset", next_improvement: value.review?.next_improvement ?? "", tags: value.review?.tags ?? [], planned_stop_price: value.review?.planned_stop_price ?? null, planned_risk_amount: value.review?.planned_risk_amount ?? null });
      setStatus(value.review ? "已载入复盘" : "尚未填写复盘");
    }).catch(() => { if (active) { setError("交易事实暂时无法读取。"); setStatus(""); } });
    return () => { active = false; };
  }, [tradeId]);

  useEffect(() => {
    if (!draft || !dirty) return;
    setStatus("等待自动保存…");
    const timer = window.setTimeout(() => {
      setDirty(false); setStatus("正在自动保存…"); setError("");
      void saveTradingReview(tradeId, draft).then((saved) => {
        setDetail((current) => current ? { ...current, review: saved, trade: { ...current.trade, review_status: "saved" } } : current);
        setStatus("已自动保存");
      }).catch((cause) => {
        if (cause instanceof TradingRepositoryError && cause.code === "stale_trade_cycle_revision") {
          setError("交易数据已更新，需要重新载入事实后再保存。");
        } else setError("自动保存失败，请检查网络后继续编辑。");
        setStatus("保存未完成");
      });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [dirty, draft, tradeId]);

  function patch(value: Partial<SaveTradingReviewInput>) { setDraft((current) => current ? { ...current, ...value } : current); setDirty(true); }
  if (!detail || !draft) return <main className="mx-auto grid max-w-5xl gap-5 px-4 py-8"><Link href="/workbench" className="inline-flex items-center gap-2 text-sm"><ArrowLeft />返回交易工作台</Link>{error ? <p role="alert">{error}</p> : null}<p role="status" className="text-sm text-muted-foreground">{status}</p></main>;

  const { trade } = detail;
  return <main className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-8 sm:px-6">
    <Link href="/workbench" className="inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground hover:text-primary"><ArrowLeft />返回交易工作台</Link>
    <header className="grid gap-3 border-b pb-6"><div className="flex flex-wrap items-center gap-2"><span className="rounded-md bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">{providerLabels[trade.provider]}</span><span className="text-xs text-muted-foreground">{trade.account_label} · {trade.account_currency}</span></div><h1 className="text-3xl font-semibold tracking-[-0.04em] md:text-5xl">{trade.symbol}</h1><p className="text-sm text-muted-foreground">{trade.direction === "long" ? "多头" : "空头"} · {new Date(trade.opened_at).toLocaleString("zh-CN")} 至 {trade.closed_at ? new Date(trade.closed_at).toLocaleString("zh-CN") : "持仓中"}</p></header>

    <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="统一交易事实">{[["开仓均价", trade.entry_price], ["平仓均价", trade.exit_price ?? "—"], ["净盈亏", `${trade.net_pnl} ${trade.account_currency}`], ["手续费", `${trade.fees} ${trade.account_currency}`]].map(([label, value]) => <article key={label} className="rounded-xl border bg-surface p-4"><span className="text-xs text-muted-foreground">{label}</span><strong className="mt-2 block tabular-nums">{value}</strong></article>)}</section>

    <section className="rounded-xl border bg-surface p-5"><h2 className="text-xl font-semibold">平台交易事实</h2>{trade.provider === "exness" ? <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2"><p>手数 {detail.provider_facts.lot_quantity}</p><p>position ID {detail.provider_facts.position_id}</p><p>Swap {detail.provider_facts.swap}</p><p>账户币种 {detail.provider_facts.account_currency}</p></div> : <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2"><p>合约数量 {detail.provider_facts.contract_quantity}</p><p>资金费 {detail.provider_facts.funding}</p><p>结算币种 {detail.provider_facts.settlement_currency}</p></div>}<details className="mt-4 border-t pt-4"><summary className="cursor-pointer text-sm font-medium">原始交易信息</summary><dl className="mt-3 grid gap-2 text-sm text-muted-foreground"><div><dt className="inline">周期 ID：</dt><dd className="inline">{trade.id}</dd></div><div><dt className="inline">数据版本：</dt><dd className="inline">{trade.revision}</dd></div><div><dt className="inline">完整性：</dt><dd className="inline">{trade.completeness}</dd></div></dl></details></section>

    {detail.reconciliation.length || detail.review?.needs_reconciliation ? <section className="rounded-xl border border-amber-300/50 bg-amber-50/50 p-5 dark:bg-amber-950/10"><h2 className="flex items-center gap-2 font-semibold"><WarningCircle />需要处理历史复盘冲突</h2><p className="mt-2 text-sm text-muted-foreground">迟到成交改变了交易周期。旧复盘没有自动覆盖，请核对后保存当前版本。</p>{detail.reconciliation.map((item) => <blockquote key={item.cycle_id} className="mt-3 border-l-2 pl-3 text-sm">{item.reason || item.next_improvement}</blockquote>)}</section> : null}

    <section className="grid gap-5 rounded-xl border bg-surface p-5 md:p-7"><div><h2 className="text-xl font-semibold">极简复盘</h2><p className="mt-1 text-sm text-muted-foreground">修改后会自动保存，只记录你的主观判断，不改变交易事实。</p></div><Field><Label htmlFor="trade-reason">交易理由</Label><Textarea id="trade-reason" rows={5} maxLength={5000} value={draft.reason} onChange={(event) => patch({ reason: event.target.value })} /></Field><Field><Label htmlFor="trade-compliance">是否遵守计划</Label><select id="trade-compliance" aria-label="是否遵守计划" className={selectClass} value={draft.plan_compliance} onChange={(event) => patch({ plan_compliance: event.target.value as SaveTradingReviewInput["plan_compliance"] })}><option value="unset">未选择</option><option value="yes">是</option><option value="partial">部分遵守</option><option value="no">否</option></select></Field><Field><Label htmlFor="trade-improvement">下次改进</Label><Textarea id="trade-improvement" rows={5} maxLength={5000} value={draft.next_improvement} onChange={(event) => patch({ next_improvement: event.target.value })} /></Field><details className="rounded-lg bg-muted p-4"><summary className="cursor-pointer text-sm font-medium">计划风险（可选）</summary><div className="mt-4 grid gap-4 sm:grid-cols-2"><Field><Label htmlFor="planned-stop">计划止损价</Label><Input id="planned-stop" inputMode="decimal" value={draft.planned_stop_price ?? ""} onChange={(event) => patch({ planned_stop_price: event.target.value || null })} /></Field><Field><Label htmlFor="planned-risk">计划风险金额</Label><Input id="planned-risk" inputMode="decimal" value={draft.planned_risk_amount ?? ""} onChange={(event) => patch({ planned_risk_amount: event.target.value || null })} /></Field></div></details><div className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle size={18} /><p role="status">{status}</p></div>{error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}</section>
  </main>;
}
