"use client";

import type {
  FillMarker,
  FillMarkerAnnotationV1,
  TradeChartGapV1,
  TradeChartCandleSeriesBasis,
  TradeChartProjection,
} from "@wavekb/domain/trading-review";
import { Button } from "@wavekb/ui";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  createWaveKbChartEngine,
  type WaveKbChartCandle,
  type WaveKbChartEngine,
  type WaveKbChartMarker,
  type WaveKbChartTheme,
} from "@/lib/trading/chart-engine";
import { FillList } from "./fill-list";
import { createFillAnnotationDraftScope, FillAnnotationEditor, hasDraftForStrategyShare, type FillAnnotationDraftScope } from "./fill-annotation-editor";
import { ChartToolPanel, type SavedStrategyLayout } from "./chart-tool-panel";
import { ShareStrategyDialog } from "./share-strategy-dialog";

type ChartLoadError = "rate_limited" | "unavailable" | null;

export interface OpenAlgoTradeChartProps {
  projection: TradeChartProjection | null;
  loading?: boolean;
  loadError?: ChartLoadError;
  onReload?: () => void;
  shareEnabled?: boolean;
  draftScope?: FillAnnotationDraftScope;
}

type PreparedFill = {
  fill: FillMarker;
  candleTime: number;
  candleIndex: number;
  price: number;
};

type PreparedChart = {
  basis: TradeChartCandleSeriesBasis | null;
  candles: WaveKbChartCandle[];
  chartedFills: PreparedFill[];
  chartedMarkerKeys: Set<string>;
  gapMarkerKeys: Set<string>;
  gaps: TradeChartGapV1[];
  fillsByCandle: Map<number, FillMarker[]>;
};

type Preparation =
  | { ok: true; value: PreparedChart }
  | { ok: false; message: string };

const roleLabels: Record<FillMarker["allocation_role"], string> = {
  open: "开仓",
  add: "加仓",
  reduce: "减仓",
  close: "平仓",
  reverse_open: "反手新开",
};

const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

function decimal(value: string): number {
  if (!DECIMAL.test(value)) throw new Error("invalid decimal");
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("unsafe decimal");
  return parsed;
}

function unixTime(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("invalid timestamp");
  return Math.floor(parsed / 1_000);
}

function selectedBasis(projection: TradeChartProjection): TradeChartCandleSeriesBasis | null {
  const bases = new Set(projection.candles.map(({ series_basis }) => series_basis));
  if (projection.price_type === "both") {
    if (bases.has("bid")) return "bid";
    if (bases.has("ask")) return "ask";
    return null;
  }
  return bases.has(projection.price_type) ? projection.price_type : null;
}

function prepareChart(projection: TradeChartProjection): Preparation {
  try {
    const basis = selectedBasis(projection);
    const source = basis === null
      ? []
      : projection.candles
        .filter((candle) => candle.series_basis === basis)
        .sort((left, right) => Date.parse(left.open_time) - Date.parse(right.open_time));
    const intervals = source.map((candle) => {
      const openTime = unixTime(candle.open_time);
      const closeTime = unixTime(candle.close_time);
      if (closeTime <= openTime) throw new Error("invalid interval");
      return { candle, openTime, closeTime };
    });
    const candles = intervals.map(({ candle, openTime }) => ({
      time: openTime,
      open: decimal(candle.open),
      high: decimal(candle.high),
      low: decimal(candle.low),
      close: decimal(candle.close),
      ...(candle.volume === null ? {} : { volume: decimal(candle.volume) }),
    }));
    const gaps = intervals.length === 0 ? [] : projection.coverage.gaps.filter((gap) => gap.series_basis === basis);
    const numericGaps = gaps.map(({ from, to }) => ({ from: unixTime(from), to: unixTime(to) }));
    const gapMarkerKeys = new Set<string>();
    const chartedFills = projection.markers.flatMap((fill): PreparedFill[] => {
      const occurredAt = unixTime(fill.occurred_at);
      const candleIndex = intervals.findIndex(({ openTime, closeTime }) => occurredAt >= openTime && occurredAt < closeTime);
      if (candleIndex === -1) {
        if (numericGaps.some(({ from, to }) => occurredAt >= from && occurredAt < to)) gapMarkerKeys.add(fill.marker_key);
        return [];
      }
      return [{ fill, candleTime: intervals[candleIndex]!.openTime, candleIndex, price: decimal(fill.price) }];
    });
    const fillsByCandle = new Map<number, FillMarker[]>();
    for (const item of chartedFills) {
      const fills = fillsByCandle.get(item.candleTime) ?? [];
      fills.push(item.fill);
      fillsByCandle.set(item.candleTime, fills);
    }
    return {
      ok: true,
      value: {
        basis,
        candles,
        chartedFills,
        chartedMarkerKeys: new Set(chartedFills.map(({ fill }) => fill.marker_key)),
        gapMarkerKeys,
        gaps,
        fillsByCandle,
      },
    };
  } catch {
    return { ok: false, message: "图表数据格式异常，逐笔成交仍可查看。" };
  }
}

function markerShape(fill: FillMarker): WaveKbChartMarker["shape"] {
  switch (fill.allocation_role) {
    case "open": return fill.side === "buy" ? "arrowUp" : "arrowDown";
    case "add": return "circle";
    case "reduce": return "diamond";
    case "close": return "square";
    case "reverse_open": return "flag";
  }
}

function markerText(fill: FillMarker): string {
  switch (fill.allocation_role) {
    case "open": return "开";
    case "add": return "加";
    case "reduce": return "减";
    case "close": return "平";
    case "reverse_open": return "反";
  }
}

function chartMarkers(
  prepared: PreparedChart,
  selectedMarkerKey: string | null,
  theme: WaveKbChartTheme,
): WaveKbChartMarker[] {
  const markers = prepared.chartedFills.map(({ fill, candleTime, price }): WaveKbChartMarker => {
    const selected = fill.marker_key === selectedMarkerKey;
    return {
      id: `fill:${fill.marker_key}`,
      time: candleTime,
      price,
      position: "atPrice",
      shape: markerShape(fill),
      size: selected ? "big" : "medium",
      color: fill.side === "buy" ? theme.positive : theme.negative,
      text: selected ? `${markerText(fill)} ✓` : markerText(fill),
      textColor: theme.axisText,
      bold: selected,
    };
  });
  return markers.sort((left, right) => left.time - right.time || Number(left.bold === true) - Number(right.bold === true));
}

function revealFill(engine: WaveKbChartEngine, prepared: PreparedChart, markerKey: string) {
  const target = prepared.chartedFills.find(({ fill }) => fill.marker_key === markerKey);
  if (!target) return;
  const { candleIndex } = target;
  const viewport = engine.getViewport();
  if (candleIndex >= viewport.from && candleIndex <= viewport.to) return;
  const span = viewport.to - viewport.from;
  if (Number.isFinite(span) && span > 0) {
    engine.setViewport({ from: candleIndex - span / 2, to: candleIndex + span / 2 });
  }
}

function colorOf(element: HTMLElement | null, property: "backgroundColor" | "color" | "borderTopColor", fallback: string) {
  if (element === null || typeof window === "undefined") return fallback;
  const value = window.getComputedStyle(element)[property];
  return value && value !== "transparent" && value !== "rgba(0, 0, 0, 0)" ? value : fallback;
}

function coverageMessage(projection: TradeChartProjection, loadError: ChartLoadError): string | null {
  if (loadError === "rate_limited" || projection.warnings.includes("rate_limited")) {
    return "行情接口已限流，当前结果可能不完整";
  }
  if (loadError === "unavailable" || projection.coverage.status === "unavailable") return "行情暂不可用";
  if (projection.coverage.status === "stale" || projection.warnings.includes("stale_cache")) {
    return "当前显示缓存行情，可能不是最新";
  }
  if (projection.coverage.status === "gapped" || projection.warnings.includes("historical_gap")) return "行情存在缺口";
  if (projection.coverage.status === "partial" || projection.warnings.includes("partial_coverage")) {
    return "行情仅覆盖部分时间范围";
  }
  if (projection.coverage.status === "empty" || projection.warnings.includes("empty_range")) return "所选范围暂无行情";
  return null;
}

export function OpenAlgoTradeChart({
  projection,
  loading = false,
  loadError = null,
  onReload,
  shareEnabled = false,
  draftScope: sharedDrafts,
}: OpenAlgoTradeChartProps) {
  const chartElementRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<WaveKbChartEngine | null>(null);
  const selectedRef = useRef<string | null>(null);
  const surfaceProbeRef = useRef<HTMLSpanElement | null>(null);
  const foregroundProbeRef = useRef<HTMLSpanElement | null>(null);
  const gridProbeRef = useRef<HTMLSpanElement | null>(null);
  const primaryProbeRef = useRef<HTMLSpanElement | null>(null);
  const positiveProbeRef = useRef<HTMLSpanElement | null>(null);
  const negativeProbeRef = useRef<HTMLSpanElement | null>(null);
  const [selectedMarkerKey, setSelectedMarkerKey] = useState<string | null>(null);
  const [failedProjection, setFailedProjection] = useState<TradeChartProjection | null>(null);
  const [themeRevision, setThemeRevision] = useState(0);
  const [localDrafts] = useState(createFillAnnotationDraftScope);
  const annotationDraftScope = sharedDrafts ?? localDrafts;
  const [share, setShare] = useState<{ projection: TradeChartProjection; layout: SavedStrategyLayout; open: boolean } | null>(null);
  const [shareError, setShareError] = useState("");
  const [readyChart, setReadyChart] = useState<{
    projection: TradeChartProjection;
    engine: WaveKbChartEngine;
  } | null>(null);
  const [savedNotes, setSavedNotes] = useState<{
    projection: TradeChartProjection;
    byFillId: ReadonlyMap<string, FillMarkerAnnotationV1 | null>;
  } | null>(null);
  const preparation = useMemo(() => projection === null ? null : prepareChart(projection), [projection]);

  function readTheme(): WaveKbChartTheme {
    return {
      background: colorOf(surfaceProbeRef.current, "backgroundColor", "#ffffff"),
      grid: colorOf(gridProbeRef.current, "borderTopColor", "#e6ebf1"),
      axisText: colorOf(foregroundProbeRef.current, "color", "#18212c"),
      axisLine: colorOf(foregroundProbeRef.current, "borderTopColor", "#d8dee7"),
      primary: colorOf(primaryProbeRef.current, "backgroundColor", "#3f6f9f"),
      positive: colorOf(positiveProbeRef.current, "backgroundColor", "#1d6e4e"),
      negative: colorOf(negativeProbeRef.current, "backgroundColor", "#b4232e"),
    };
  }

  useEffect(() => {
    selectedRef.current = selectedMarkerKey;
  }, [selectedMarkerKey]);

  useEffect(() => {
    const refresh = () => setThemeRevision((revision) => revision + 1);
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const observer = typeof MutationObserver === "undefined" ? null : new MutationObserver(refresh);
    observer?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-wavekb-mode", "data-wavekb-theme"],
    });
    media?.addEventListener("change", refresh);
    return () => {
      observer?.disconnect();
      media?.removeEventListener("change", refresh);
    };
  }, []);

  useEffect(() => {
    const engine = engineRef.current;
    if (engine === null || preparation?.ok !== true) return;
    const theme = readTheme();
    engine.setTheme(theme);
    engine.setMarkers(chartMarkers(preparation.value, selectedMarkerKey, theme));
  }, [preparation, selectedMarkerKey, themeRevision]);

  useEffect(() => {
    if (projection === null || preparation?.ok !== true || preparation.value.candles.length === 0) {
      engineRef.current = null;
      return;
    }
    const container = chartElementRef.current;
    if (container === null) return;

    let cancelled = false;
    let engine: WaveKbChartEngine | null = null;
    let unsubscribeMarkerClicks: (() => void) | null = null;
    let resizeObserver: ResizeObserver | null = null;
    const disposeEngine = () => {
      resizeObserver?.disconnect();
      resizeObserver = null;
      unsubscribeMarkerClicks?.();
      unsubscribeMarkerClicks = null;
      const current = engine;
      engine = null;
      if (engineRef.current === current) engineRef.current = null;
      current?.destroy();
    };
    void createWaveKbChartEngine(container, { timezone: "UTC", ariaLabel: "成交 K 线图" })
      .then((created) => {
        if (cancelled) {
          created.destroy();
          return;
        }
        engine = created;
        engineRef.current = created;
        const theme = readTheme();
        created.setTheme(theme);
        created.setCandles(preparation.value.candles);
        created.setCandleGaps(preparation.value.gaps.map(({ from, to }) => ({ from: unixTime(from), to: unixTime(to) })));
        created.setMarkers(chartMarkers(preparation.value, selectedRef.current, theme));
        created.setFillClusters([...preparation.value.fillsByCandle].flatMap(([time, fills]) =>
          fills.length > 1 ? [{ id: `cluster:${time}`, time, count: fills.length }] : [],
        ));
        const savedChart = projection.chart_state;
        created.setViewport(savedChart?.cycle_revision === projection.cycle_revision
          && savedChart.timeframe === projection.timeframe ? savedChart.viewport : null);
        if (selectedRef.current !== null) revealFill(created, preparation.value, selectedRef.current);
        unsubscribeMarkerClicks = created.subscribeMarkerClicks((markerId) => {
          if (markerId === null) {
            setSelectedMarkerKey(null);
            return;
          }
          if (markerId.startsWith("cluster:")) {
            const first = preparation.value.fillsByCandle.get(Number(markerId.slice("cluster:".length)))?.[0];
            if (first) setSelectedMarkerKey(first.marker_key);
            return;
          }
          if (!markerId.startsWith("fill:")) return;
          const markerKey = markerId.slice("fill:".length);
          if (preparation.value.chartedMarkerKeys.has(markerKey)) setSelectedMarkerKey(markerKey);
        });
        if (typeof ResizeObserver !== "undefined") {
          resizeObserver = new ResizeObserver((entries) => {
            const { width, height } = entries[0]?.contentRect ?? container.getBoundingClientRect();
            if (width > 0 && height > 0) created.resize(width, height, window.devicePixelRatio || 1);
          });
          resizeObserver.observe(container);
        }
        setReadyChart({ projection, engine: created });
      })
      .catch(() => {
        disposeEngine();
        if (!cancelled) setFailedProjection(projection);
      });

    return () => {
      cancelled = true;
      disposeEngine();
    };
  }, [preparation, projection]);

  const prepared = preparation?.ok === true ? preparation.value : null;
  const fills = projection === null ? [] : projection.markers.map((fill) =>
    savedNotes?.projection === projection && savedNotes.byFillId.has(fill.fill_id)
      ? { ...fill, annotation: savedNotes.byFillId.get(fill.fill_id) ?? null }
      : fill,
  );
  const selectedFill = fills.find(({ marker_key }) => marker_key === selectedMarkerKey) ?? null;
  const selectedPrepared = prepared?.chartedFills.find(({ fill }) => fill.marker_key === selectedMarkerKey);
  const selectedCluster = selectedPrepared === undefined
    ? []
    : prepared?.fillsByCandle.get(selectedPrepared.candleTime) ?? [];
  const statusMessage = projection === null ? null : coverageMessage(projection, loadError);
  const shownBasis = prepared?.basis;
  const engineError = projection !== null && failedProjection === projection ? "图表未能加载，逐笔成交仍可查看。" : null;

  function selectFill(markerKey: string) {
    setSelectedMarkerKey(markerKey);
    const engine = engineRef.current;
    if (engine && prepared) revealFill(engine, prepared, markerKey);
  }

  function rememberAnnotation(fillId: string, annotation: FillMarkerAnnotationV1 | null) {
    if (projection === null) return;
    setSavedNotes((previous) => {
      const byFillId = new Map(previous?.projection === projection ? previous.byFillId : undefined);
      byFillId.set(fillId, annotation);
      return { projection, byFillId };
    });
  }

  function openShare(layout: SavedStrategyLayout) {
    if (projection === null) return;
    if (hasDraftForStrategyShare(annotationDraftScope, projection.cycle_id)) {
      setShareError("请保存成交备忘录，再分享策略图。");
      return;
    }
    setShareError("");
    setShare((current) => current?.projection === projection
      ? { ...current, open: true }
      : { projection, layout, open: true });
  }

  return (
    <section className="grid gap-4" aria-labelledby="trade-chart-title">
      <span aria-hidden className="pointer-events-none absolute size-px overflow-hidden opacity-0">
        <span ref={surfaceProbeRef} className="bg-surface" />
        <span ref={foregroundProbeRef} className="border-t border-border text-foreground" />
        <span ref={gridProbeRef} className="border-t border-border-subtle" />
        <span ref={primaryProbeRef} className="bg-primary" />
        <span ref={positiveProbeRef} className="bg-success" />
        <span ref={negativeProbeRef} className="bg-destructive" />
      </span>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="trade-chart-title" className="text-xl font-semibold">逐笔成交图表</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {projection?.price_type === "both" && shownBasis === "bid"
              ? "双报价 · 当前显示 Bid（买价）"
              : projection?.price_type === "both" && shownBasis === "ask"
                ? "双报价 · 当前显示 Ask（卖价）"
                : shownBasis === null || shownBasis === undefined
                  ? "等待可用行情"
                  : `${shownBasis.toUpperCase()} 行情`}
          </p>
        </div>
        {onReload ? (
          <Button type="button" variant="outline" onClick={onReload}>
            重新加载
          </Button>
        ) : null}
      </header>

      {loading ? <p className="rounded-xl border bg-surface p-4 text-sm text-muted-foreground" role="status">行情加载中…</p> : null}
      {loadError === "unavailable" && projection === null
        ? <p className="rounded-xl border border-dashed bg-surface p-4 text-sm text-warning" role="status">行情暂不可用</p>
        : null}
      {loadError === "rate_limited" && projection === null
        ? <p className="rounded-xl border border-dashed bg-surface p-4 text-sm text-warning" role="status">行情接口已限流，请稍后重试</p>
        : null}
      {statusMessage ? <p className="rounded-xl border border-warning/30 bg-warning-surface p-3 text-sm text-warning" role="status">{statusMessage}</p> : null}
      {preparation?.ok === false ? <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{preparation.message}</p> : null}
      {engineError ? <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{engineError}</p> : null}
      {shareError ? <p role="alert" className="text-sm text-destructive">{shareError}</p> : null}
      {shareEnabled && projection !== null && share?.projection === projection && (
        <ShareStrategyDialog projection={projection} layout={share.layout} fills={fills} open={share.open}
          onClose={(keepReceipt) => setShare((current) => current && keepReceipt ? { ...current, open: false } : null)} />
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(18rem,.85fr)]">
        <div className="min-w-0">
          {readyChart?.projection === projection ? (
            <ChartToolPanel projection={readyChart.projection} engine={readyChart.engine}
              onShare={shareEnabled && readyChart.projection.candles.length > 0 ? openShare : undefined} />
          ) : null}
          <div
            ref={chartElementRef}
            className="h-[26rem] min-h-72 overflow-hidden rounded-xl border bg-surface"
            aria-label="成交 K 线图"
          />
          {projection !== null && !loading && prepared?.candles.length === 0
            ? <p className="-mt-52 px-6 text-center text-sm text-muted-foreground">暂无可绘制 K 线；逐笔成交仍可查看。</p>
            : null}
          {prepared && prepared.gaps.length > 0 ? (
            <details className="mt-2 text-sm text-muted-foreground">
              <summary className="min-h-11 cursor-pointer py-2 text-warning focus-visible:outline-2 focus-visible:outline-ring">
                行情缺口（{prepared.gaps.length} 段，UTC）
              </summary>
              <ul className="max-h-48 space-y-1 overflow-auto pb-2 tabular-nums">
                {prepared.gaps.map(({ from, to }) => (
                  <li key={from} className="flex flex-wrap gap-x-2">
                    <time dateTime={from}>{from}</time>
                    <span>至</span>
                    <time dateTime={to}>{to}</time>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>

        <aside className="grid content-start gap-4" aria-label="成交详情">
          {selectedFill !== null && selectedCluster.length > 1 ? (
            <section className="grid gap-2 rounded-xl border bg-surface p-3">
              <h3 className="font-semibold">同 K 线成交（{selectedCluster.length} 笔）</h3>
              {selectedCluster.map((fill) => (
                <Button
                  key={fill.marker_key}
                  type="button"
                  variant={fill.marker_key === selectedMarkerKey ? "soft" : "outline"}
                  aria-pressed={fill.marker_key === selectedMarkerKey}
                  className="min-w-0 justify-start whitespace-normal break-all text-left"
                  onClick={() => selectFill(fill.marker_key)}
                >
                  选择{roleLabels[fill.allocation_role]} · {fill.price}
                </Button>
              ))}
            </section>
          ) : null}
          {projection && projection.unmatched_annotations?.length ? (
            <details className="rounded-card border border-warning/30 bg-warning-surface p-3">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-warning">
                需要确认的备忘录（{projection.unmatched_annotations.length}）
              </summary>
              <p className="mb-2 text-sm">原成交已变更，以下备忘录暂时没有关联到新成交。</p>
              <ul className="grid gap-2 text-sm">
                {projection.unmatched_annotations.map((note) => (
                  <li key={note.id} className="grid gap-1 border-t pt-2">
                    <p className="whitespace-pre-wrap break-words">{note.body || "无文字备注"}</p>
                    {note.tags.length > 0 ? <p className="break-words text-muted-foreground">{note.tags.join("、")}</p> : null}
                    {note.image_count > 0 ? <p className="text-muted-foreground">{note.image_count} 张私有图片</p> : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {projection && selectedFill ? (
            <FillAnnotationEditor
              key={`${projection.cycle_id}:${projection.cycle_revision}:${selectedFill.fill_id}`}
              cycleId={projection.cycle_id}
              cycleRevision={projection.cycle_revision}
              fill={selectedFill}
              onSaved={rememberAnnotation}
              draftScope={annotationDraftScope}
            />
          ) : null}
          {projection !== null ? (
            <FillList
              fills={fills}
              selectedMarkerKey={selectedMarkerKey}
              chartedMarkerKeys={engineError ? new Set<string>() : prepared?.chartedMarkerKeys ?? new Set<string>()}
              gapMarkerKeys={prepared?.gapMarkerKeys}
              onSelect={selectFill}
            />
          ) : !loading ? <p className="text-sm text-muted-foreground">{loadError ? "暂时无法读取逐笔成交。" : "暂无逐笔成交。"}</p> : null}
        </aside>
      </div>
    </section>
  );
}
