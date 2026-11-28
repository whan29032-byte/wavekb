"use client";

import type { TradeChartProjection, TradeChartTimeframe } from "@wavekb/domain/trading-review";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle, Sparkle, WarningCircle } from "@phosphor-icons/react";
import { Button, Field, Input, Label, Textarea } from "@wavekb/ui";
import { tradeXMarketForProjection } from "@/lib/trading/tradex-fill-markers";
import { TradexTradeReview } from "./trading/tradex-trade-review";
import {
  browserTimezone,
  getTradeChart,
  getTradeReviewAiJob,
  getTradingTrade,
  saveTradingReview,
  submitTradeReviewAi,
  TradingRepositoryError,
  type SaveTradingReviewInput,
  type TradeReviewAiOutput,
  type TradingTradeDetail,
} from "@/lib/trading/workbench-repository";

const providerLabels: Record<string, string> = { binance: "Binance", okx: "OKX", bybit: "Bybit", bitget: "Bitget", exness: "Exness" };
const selectClass = "h-11 rounded-lg border bg-surface px-3 text-sm";
const books = [
  ["all", "全部已发布知识库"],
  ["elliott-wave-principle-eleventh-edition", "《艾略特波浪理论》第 11 版"],
  ["elliott-wave-principle-tenth-edition", "《艾略特波浪理论》第 10 版"],
  ["elliott-wave-natural-law", "《艾略特波浪理论：自然法则》"],
  ["chan-theory-complete", "《缠中说禅》"],
] as const;

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

const DynamicOpenAlgoTradeChart = dynamic(
  () => import("./trading/openalgo-trade-chart").then(({ OpenAlgoTradeChart }) => OpenAlgoTradeChart),
  {
    ssr: false,
    loading: () => <p className="rounded-xl border bg-surface p-4 text-sm text-muted-foreground" role="status">正在准备交互式图表…</p>,
  },
);

function initialChartRequest(openedAt: string, closedAt: string | null) {
  const opened = Date.parse(openedAt);
  const closed = closedAt === null ? Date.now() : Date.parse(closedAt);
  const duration = Math.max(5 * 60_000, closed - opened);
  const timeframe: TradeChartTimeframe = duration < 2 * 60 * 60_000
    ? "1m"
    : duration <= 24 * 60 * 60_000
      ? "5m"
      : duration <= 3 * 24 * 60 * 60_000
        ? "15m"
        : duration <= 7 * 24 * 60 * 60_000
          ? "1h"
          : duration <= 30 * 24 * 60 * 60_000
            ? "4h"
            : "1d";
  const context = Math.max(60_000, Math.round(duration * 0.2));
  return {
    timeframe,
    from: new Date(opened - context).toISOString(),
    to: new Date(closed + context).toISOString(),
  };
}

export function TradingTradeReview({ tradeId, chartEnabled = false, shareEnabled = false, liveMarketOrigin = null }: {
  tradeId: string;
  chartEnabled?: boolean;
  shareEnabled?: boolean;
  liveMarketOrigin?: string | null;
}) {
  const [detail, setDetail] = useState<TradingTradeDetail | null>(null);
  const [draft, setDraft] = useState<SaveTradingReviewInput | null>(null);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState("正在读取交易事实…");
  const [error, setError] = useState("");
  const [knowledgeBook, setKnowledgeBook] = useState("all");
  const [aiStatus, setAiStatus] = useState("");
  const [aiError, setAiError] = useState("");
  const [aiOutput, setAiOutput] = useState<TradeReviewAiOutput | null>(null);
  const [aiStale, setAiStale] = useState(false);
  const [chartResult, setChartResult] = useState<{
    requestKey: string;
    projection: TradeChartProjection | null;
    loadError: "rate_limited" | "unavailable" | null;
  }>({ requestKey: "", projection: null, loadError: null });
  const [chartReloadToken, setChartReloadToken] = useState(0);
  const [liveCycle, setLiveCycle] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getTradingTrade(tradeId, browserTimezone()).then((value) => {
      if (!active) return;
      setDetail(value);
      setDraft({
        expected_cycle_revision: value.trade.revision,
        reason: value.review?.reason ?? "",
        plan_compliance: value.review?.plan_compliance ?? "unset",
        next_improvement: value.review?.next_improvement ?? "",
        tags: value.review?.tags ?? [],
        planned_stop_price: value.review?.planned_stop_price ?? null,
        planned_risk_amount: value.review?.planned_risk_amount ?? null,
      });
      setStatus(value.review ? "已载入复盘" : "尚未填写复盘");
    }).catch(() => {
      if (active) { setError("交易事实暂时无法读取。"); setStatus(""); }
    });
    return () => { active = false; };
  }, [tradeId]);

  const chartCycleId = detail?.trade.id;
  const chartCycleRevision = detail?.trade.revision;
  const chartOpenedAt = detail?.trade.opened_at;
  const chartClosedAt = detail?.trade.closed_at;
  const chartRequestKey = chartEnabled && chartCycleId && chartCycleId === tradeId && chartOpenedAt && chartCycleRevision !== undefined
    ? [chartCycleId, chartCycleRevision, chartOpenedAt, chartClosedAt ?? "open", chartReloadToken].join(":")
    : null;
  const chartProjection = chartRequestKey !== null && chartResult.requestKey === chartRequestKey ? chartResult.projection : null;
  const chartLoadError = chartRequestKey !== null && chartResult.requestKey === chartRequestKey ? chartResult.loadError : null;
  const chartLoading = chartRequestKey !== null && chartResult.requestKey !== chartRequestKey;
  const tradeXMarket = chartProjection && liveMarketOrigin ? tradeXMarketForProjection(chartProjection) : null;

  useEffect(() => {
    if (chartRequestKey === null || !chartCycleId || !chartOpenedAt) return;
    let active = true;
    const input = initialChartRequest(chartOpenedAt, chartClosedAt ?? null);
    void getTradeChart(chartCycleId, input).then((value) => {
      if (!active) return;
      setChartResult({ requestKey: chartRequestKey, projection: value, loadError: null });
    }).catch((cause) => {
      if (!active) return;
      const code = cause instanceof TradingRepositoryError ? cause.code : "";
      const rateLimited = cause instanceof TradingRepositoryError && (cause.status === 429 || code.includes("rate_limit"));
      setChartResult({
        requestKey: chartRequestKey,
        projection: null,
        loadError: rateLimited ? "rate_limited" : "unavailable",
      });
    });
    return () => { active = false; };
  }, [chartClosedAt, chartCycleId, chartOpenedAt, chartRequestKey]);

  useEffect(() => {
    if (!draft || !dirty) return;
    const timer = window.setTimeout(() => {
      setDirty(false);
      setStatus("正在自动保存…");
      setError("");
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

  function patch(value: Partial<SaveTradingReviewInput>) {
    setDraft((current) => current ? { ...current, ...value } : current);
    setStatus("等待自动保存…");
    setDirty(true);
  }

  async function generateAiReview() {
    if (!detail) return;
    setAiError("");
    setAiOutput(null);
    setAiStale(false);
    setAiStatus("正在提交 AI 复盘…");
    try {
      let job = await submitTradeReviewAi(
        tradeId,
        detail.trade.revision,
        knowledgeBook === "all" ? "all" : { book_ids: [knowledgeBook] },
      );
      for (let attempt = 0; attempt < 45 && !["succeeded", "failed", "cancelled"].includes(job.status); attempt += 1) {
        if (attempt > 0) await wait(1_000);
        job = await getTradeReviewAiJob(job.id);
      }
      if (job.status !== "succeeded" || !job.output_payload) throw new Error(job.error_code || "trade_review_unavailable");
      setAiOutput(job.output_payload);
      setAiStale(job.stale === true);
      setAiStatus(job.stale ? "复盘已生成，但交易数据已有新版本" : "AI 复盘已生成");
    } catch {
      setAiError("AI 复盘暂时无法生成，请检查模型连接后重试。");
      setAiStatus("");
    }
  }

  if (!detail || !draft) return (
    <main className="mx-auto grid max-w-5xl gap-5 px-4 py-8">
      <Link href="/workbench" className="inline-flex items-center gap-2 text-sm"><ArrowLeft />返回交易工作台</Link>
      {error ? <p role="alert">{error}</p> : null}
      <p role="status" className="text-sm text-muted-foreground">{status}</p>
    </main>
  );

  const { trade } = detail;
  return (
    <main className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-8 sm:px-6">
      <Link href="/workbench" className="inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground hover:text-primary"><ArrowLeft />返回交易工作台</Link>
      <header className="grid gap-3 border-b pb-6">
        <div className="flex flex-wrap items-center gap-2"><span className="rounded-md bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">{providerLabels[trade.provider]}</span><span className="text-xs text-muted-foreground">{trade.account_label} · {trade.account_currency}</span></div>
        <h1 className="text-3xl font-semibold tracking-[-0.04em] md:text-5xl">{trade.symbol}</h1>
        <p className="text-sm text-muted-foreground">{trade.direction === "long" ? "多头" : "空头"} · {new Date(trade.opened_at).toLocaleString("zh-CN")} 至 {trade.closed_at ? new Date(trade.closed_at).toLocaleString("zh-CN") : "持仓中"}</p>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="统一交易事实">
        {[["开仓均价", trade.entry_price], ["平仓均价", trade.exit_price ?? "—"], ["净盈亏", `${trade.net_pnl} ${trade.account_currency}`], ["手续费", `${trade.fees} ${trade.account_currency}`]].map(([label, value]) => <article key={label} className="rounded-xl border bg-surface p-4"><span className="text-xs text-muted-foreground">{label}</span><strong className="mt-2 block tabular-nums">{value}</strong></article>)}
      </section>

      <section className="rounded-xl border bg-surface p-5">
        <h2 className="text-xl font-semibold">平台交易事实</h2>
        {trade.provider === "exness"
          ? <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2"><p>手数 {detail.provider_facts.lot_quantity}</p><p>position ID {detail.provider_facts.position_id}</p><p>Swap {detail.provider_facts.swap}</p><p>账户币种 {detail.provider_facts.account_currency}</p></div>
          : <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2"><p>合约数量 {detail.provider_facts.contract_quantity}</p><p>资金费 {detail.provider_facts.funding}</p><p>结算币种 {detail.provider_facts.settlement_currency}</p></div>}
        <details className="mt-4 border-t pt-4"><summary className="cursor-pointer text-sm font-medium">原始交易信息</summary><dl className="mt-3 grid gap-2 text-sm text-muted-foreground"><div><dt className="inline">周期 ID：</dt><dd className="inline">{trade.id}</dd></div><div><dt className="inline">数据版本：</dt><dd className="inline">{trade.revision}</dd></div><div><dt className="inline">完整性：</dt><dd className="inline">{trade.completeness}</dd></div></dl></details>
      </section>

      {chartEnabled ? <div data-testid="trade-chart-boundary">
        {tradeXMarket && liveMarketOrigin && chartProjection ? <div className="mb-6 grid gap-4">
          <Button type="button" variant="secondary" className="w-fit" aria-expanded={liveCycle === tradeId}
            onClick={() => setLiveCycle(liveCycle === tradeId ? null : tradeId)}>{liveCycle === tradeId ? "收起实时行情" : "在实时行情查看成交"}</Button>
          {liveCycle === tradeId ? <TradexTradeReview key={`${tradeId}:${chartProjection.cycle_revision}`} origin={liveMarketOrigin}
            market={tradeXMarket} projection={chartProjection} shareEnabled={shareEnabled} /> : null}
        </div> : null}
        <DynamicOpenAlgoTradeChart
          projection={chartProjection}
          loading={chartLoading}
          loadError={chartLoadError}
          shareEnabled={shareEnabled}
          onReload={() => setChartReloadToken((token) => token + 1)}
        />
      </div> : null}

      {detail.reconciliation.length || detail.review?.needs_reconciliation ? <section className="rounded-xl border border-amber-300/50 bg-amber-50/50 p-5 dark:bg-amber-950/10"><h2 className="flex items-center gap-2 font-semibold"><WarningCircle />需要处理历史复盘冲突</h2><p className="mt-2 text-sm text-muted-foreground">迟到成交改变了交易周期。旧复盘没有自动覆盖，请核对后保存当前版本。</p>{detail.reconciliation.map((item) => <blockquote key={item.cycle_id} className="mt-3 border-l-2 pl-3 text-sm">{item.reason || item.next_improvement}</blockquote>)}</section> : null}

      <section className="grid gap-5 rounded-xl border bg-surface p-5 md:p-7">
        <div><h2 className="text-xl font-semibold">极简复盘</h2><p className="mt-1 text-sm text-muted-foreground">修改后会自动保存，只记录你的主观判断，不改变交易事实。</p></div>
        <Field><Label htmlFor="trade-reason">交易理由</Label><Textarea id="trade-reason" rows={5} maxLength={5000} value={draft.reason} onChange={(event) => patch({ reason: event.target.value })} /></Field>
        <Field><Label htmlFor="trade-compliance">是否遵守计划</Label><select id="trade-compliance" aria-label="是否遵守计划" className={selectClass} value={draft.plan_compliance} onChange={(event) => patch({ plan_compliance: event.target.value as SaveTradingReviewInput["plan_compliance"] })}><option value="unset">未选择</option><option value="yes">是</option><option value="partial">部分遵守</option><option value="no">否</option></select></Field>
        <Field><Label htmlFor="trade-improvement">下次改进</Label><Textarea id="trade-improvement" rows={5} maxLength={5000} value={draft.next_improvement} onChange={(event) => patch({ next_improvement: event.target.value })} /></Field>
        <details className="rounded-lg bg-muted p-4"><summary className="cursor-pointer text-sm font-medium">计划风险（可选）</summary><div className="mt-4 grid gap-4 sm:grid-cols-2"><Field><Label htmlFor="planned-stop">计划止损价</Label><Input id="planned-stop" inputMode="decimal" value={draft.planned_stop_price ?? ""} onChange={(event) => patch({ planned_stop_price: event.target.value || null })} /></Field><Field><Label htmlFor="planned-risk">计划风险金额</Label><Input id="planned-risk" inputMode="decimal" value={draft.planned_risk_amount ?? ""} onChange={(event) => patch({ planned_risk_amount: event.target.value || null })} /></Field></div></details>
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle size={18} /><p role="status">{status}</p></div>
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      </section>

      <section className="grid gap-5 rounded-xl border bg-surface p-5 md:p-7" aria-labelledby="ai-review-title">
        <div><span className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">知识库辅助</span><h2 id="ai-review-title" className="mt-2 text-xl font-semibold">AI 复盘建议</h2><p className="mt-1 text-sm text-muted-foreground">只读取本笔交易事实和你的复盘，不会修改上面的内容，也不会给出买卖指令或收益承诺。</p></div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <Field><Label htmlFor="knowledge-book">知识库范围</Label><select id="knowledge-book" aria-label="知识库范围" className={selectClass} value={knowledgeBook} onChange={(event) => setKnowledgeBook(event.target.value)}>{books.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
          <button type="button" onClick={() => void generateAiReview()} disabled={Boolean(aiStatus && !aiOutput)} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60"><Sparkle size={18} />生成 AI 复盘建议</button>
        </div>
        {aiStatus ? <p role="status" className="text-sm text-muted-foreground">{aiStatus}</p> : null}
        {aiError ? <p role="alert" className="text-sm text-danger">{aiError}</p> : null}
        {aiStale ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">交易数据已有新版本，此结果仅对应生成时的旧版本，请重新生成。</p> : null}
        {aiOutput ? <div className="grid gap-6 border-t pt-5">
          <AiList title="事实摘要" items={aiOutput.fact_summary} />
          <AiList title="纪律观察" items={aiOutput.discipline_observations.map((item) => item.observation)} />
          <section><h3 className="font-semibold">波浪与结构假设</h3><p className="mt-2 text-sm leading-6">{aiOutput.wave_structure_hypothesis.summary}</p><p className="mt-1 text-xs text-muted-foreground">证据边界：{aiOutput.wave_structure_hypothesis.evidence_limit}</p></section>
          <AiList title="下次核对清单" items={aiOutput.next_checklist} />
          <section><h3 className="font-semibold">引用知识</h3>{aiOutput.citations.length ? <ul className="mt-2 grid gap-2">{aiOutput.citations.map((item) => <li key={item.knowledge_id}><Link href={item.href} className="text-sm font-medium text-primary hover:underline">{item.book_title} · {item.title}</Link>{item.pages.length ? <span className="ml-2 text-xs text-muted-foreground">第 {item.pages.join("、")} 页</span> : null}</li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">本次没有可验证引用。</p>}</section>
        </div> : null}
      </section>
    </main>
  );
}

function AiList({ title, items }: { title: string; items: string[] }) {
  return <section><h3 className="font-semibold">{title}</h3>{items.length ? <ul className="mt-2 grid gap-2 text-sm leading-6">{items.map((item, index) => <li key={`${index}-${item}`} className="border-l-2 pl-3">{item}</li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">暂无足够证据。</p>}</section>;
}
