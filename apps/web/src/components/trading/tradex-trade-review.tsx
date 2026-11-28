"use client";

import { useId, useMemo, useRef, useState } from "react";
import type { FillMarkerAnnotationV1, TradeChartProjection } from "@wavekb/domain/trading-review";
import { Button } from "@wavekb/ui";
import type { TradeXMarket } from "@/lib/trading/tradex-bridge";
import { fitTradeXTimeframe, toTradeXMarkers } from "@/lib/trading/tradex-fill-markers";
import { getTradeChart } from "@/lib/trading/workbench-repository";
import { createFillAnnotationDraftScope, FillAnnotationEditor, hasDraftForStrategyShare } from "./fill-annotation-editor";
import { TradexMarketFrame } from "./tradex-market-frame";
import { ShareStrategyDialog } from "./share-strategy-dialog";

const actions = { open: "开仓", add: "加仓", reduce: "减仓", close: "平仓", reverse_open: "反手开仓" };
const pageSize = 50;

export function TradexTradeReview({ origin, market, projection, shareEnabled = false }: { origin: string; market: TradeXMarket; projection: TradeChartProjection; shareEnabled?: boolean }) {
  const [showMarkers, setShowMarkers] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [savedNotes, setSavedNotes] = useState(new Map<string, FillMarkerAnnotationV1 | null>());
  const [draftScope] = useState(createFillAnnotationDraftScope);
  const [sharing, setSharing] = useState<{ source: TradeChartProjection; open: boolean } | null>(null);
  const [sharePending, setSharePending] = useState(false);
  const [shareError, setShareError] = useState("");
  const shareRequest = useRef(false);
  const [viewTime] = useState(() => Date.now());
  const title = useId();
  const fills = useMemo(() => projection.markers.map((fill) => savedNotes.has(fill.fill_id)
    ? { ...fill, annotation: savedNotes.get(fill.fill_id) ?? null } : fill), [projection, savedNotes]);
  const frameMarket = useMemo(() => fitTradeXTimeframe(market, projection.markers, viewTime), [market, projection.markers, viewTime]);
  const markers = useMemo(() => toTradeXMarkers(frameMarket, projection), [frameMarket, projection]);
  const index = selected ? Number(selected.slice(1)) - 1 : -1;
  const selectedFill = fills[index];

  function select(marker: string) {
    const number = Number(marker.slice(1));
    if (!Number.isSafeInteger(number) || number < 1 || number > fills.length) return;
    setSelected(marker);
    setPage(Math.floor((number - 1) / pageSize));
  }

  function rememberAnnotation(fillId: string, annotation: FillMarkerAnnotationV1 | null) {
    setSavedNotes((previous) => new Map(previous).set(fillId, annotation));
  }

  async function openShare() {
    if (shareRequest.current) return;
    if (hasDraftForStrategyShare(draftScope, projection.cycle_id)) {
      setShareError("请保存成交备忘录，再分享复盘。");
      return;
    }
    setShareError("");
    if (sharing) { setSharing({ ...sharing, open: true }); return; }
    shareRequest.current = true;
    setSharePending(true);
    try {
      const source = await getTradeChart(projection.cycle_id, { timeframe: projection.timeframe, ...projection.range });
      if (source.cycle_id !== projection.cycle_id || source.cycle_revision !== projection.cycle_revision || source.timeframe !== projection.timeframe) {
        setShareError("成交版本已变化。请重新载入复盘后再分享。");
        return;
      }
      setSharing({ source, open: true });
    } catch { setShareError("未能准备分享，请稍后重试。"); }
    finally { shareRequest.current = false; setSharePending(false); }
  }

  return <section aria-labelledby={title} className="grid min-w-0 gap-4">
    <header className="grid gap-2 sm:flex sm:items-center sm:justify-between">
      <div><h2 id={title} className="text-xl font-semibold">实时行情与成交标记</h2><p className="text-sm text-muted-foreground">币安 U 本位成交价。实时行情不依赖账户同步。</p></div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex min-h-11 w-fit items-center gap-2 text-sm"><input type="checkbox" checked={showMarkers} onChange={(event) => setShowMarkers(event.target.checked)} />显示本笔交易的成交</label>
        {shareEnabled ? <Button type="button" variant="secondary" onClick={() => void openShare()} disabled={sharePending}>{sharePending ? "正在准备分享…" : "分享复盘"}</Button> : null}
      </div>
    </header>
    {shareError ? <p role="alert" className="text-sm text-danger">{shareError}</p> : null}
    {shareEnabled ? <p className="text-sm text-muted-foreground">分享的是本笔交易的历史快照，不包含实时图上新增的画线或指标。要分享已保存的画线和指标，请在历史复盘中操作。</p> : null}
    {shareEnabled && sharing ? <ShareStrategyDialog projection={sharing.source} fills={sharing.source.markers}
      layout={{ version: sharing.source.chart_state?.version ?? 0, indicators: [], drawings: [] }} open={sharing.open}
      onClose={(keepReceipt) => setSharing(keepReceipt ? { ...sharing, open: false } : null)} /> : null}
    {frameMarket.timeframe !== projection.timeframe ? <p className="text-sm text-muted-foreground">已选较长周期，让较早的成交也能显示在图上。你仍可以切换周期。</p> : null}
    <TradexMarketFrame origin={origin} market={frameMarket} markers={showMarkers ? markers : []} onSelectMarker={select} lockSymbol />
    {selectedFill ? <FillAnnotationEditor key={`${projection.cycle_revision}:${selectedFill.fill_id}`} cycleId={projection.cycle_id}
      cycleRevision={projection.cycle_revision} fill={selectedFill} onSaved={rememberAnnotation} draftScope={draftScope} /> : null}
    {fills.length ? <details open className="rounded-card border bg-surface p-4">
      <summary className="min-h-8 cursor-pointer font-medium">逐笔成交（{fills.length} 笔）</summary>
      <p className="text-sm text-muted-foreground">同一根 K 线的成交也可逐笔选择。图上范围之外的成交可在下方历史复盘查看。</p>
      <ol start={page * pageSize + 1} className="mt-2 divide-y">
        {fills.slice(page * pageSize, (page + 1) * pageSize).map((fill, offset) => {
          const id = `m${page * pageSize + offset + 1}`;
          return <li key={fill.marker_key}><button type="button" aria-pressed={id === selected} onClick={() => select(id)}
            className="grid min-h-11 w-full grid-cols-[auto_1fr_auto] items-center gap-2 rounded-control px-2 text-left text-sm tabular-nums hover:bg-muted aria-pressed:bg-primary-selected">
            <span className="font-medium">{actions[fill.allocation_role]}</span><time dateTime={fill.occurred_at}>{new Date(fill.occurred_at).toLocaleString("zh-CN")}</time><span>{fill.price} USDT</span>
          </button></li>;
        })}
      </ol>
      {fills.length > pageSize ? <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>上一页</Button>
        <Button type="button" variant="secondary" disabled={(page + 1) * pageSize >= fills.length} onClick={() => setPage(page + 1)}>下一页</Button>
      </div> : null}
    </details> : null}
  </section>;
}
