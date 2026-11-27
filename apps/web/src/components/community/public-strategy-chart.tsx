"use client";

import type {
  PublicMarker,
  PublicStrategyProjection,
  TradeChartCandleSeriesBasis,
} from "@wavekb/domain/trading-review";
import { Button } from "@wavekb/ui";
import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import {
  createWaveKbChartEngine,
  WAVEKB_DRAWING_DOCUMENT_SCHEMA,
  type WaveKbChartCandle,
  type WaveKbChartEngine,
  type WaveKbChartMarker,
  type WaveKbChartTheme,
  type WaveKbFrozenIndicatorSeries,
} from "@/lib/trading/chart-engine";

export interface PublicStrategyChartProps {
  projection: PublicStrategyProjection;
  activeMarkerKey?: string;
  commentsPostId?: string;
}

type PreparedMarker = {
  marker: PublicMarker;
  candleIndex: number;
  candleTime: number;
  price: number;
};

type PreparedChart = {
  basis: TradeChartCandleSeriesBasis | null;
  candles: WaveKbChartCandle[];
  chartedMarkers: PreparedMarker[];
  chartedMarkerKeys: Set<string>;
  gaps: Array<{ from: number; to: number }>;
  clusters: Array<{ id: string; time: number; count: number }>;
  frozenSeries: Array<Omit<WaveKbFrozenIndicatorSeries, "color">>;
};

type Preparation = { ok: true; value: PreparedChart } | { ok: false; message: string };

const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

const roleLabels: Record<PublicMarker["allocation_role"], string> = {
  open: "开仓",
  add: "加仓",
  reduce: "减仓",
  close: "平仓",
  reverse_open: "反手新开",
};

const roleShortLabels: Record<PublicMarker["allocation_role"], string> = {
  open: "开",
  add: "加",
  reduce: "减",
  close: "平",
  reverse_open: "反",
};

const coverageLabels: Record<PublicStrategyProjection["coverage"]["status"], string> = {
  complete: "行情覆盖完整",
  partial: "行情仅覆盖部分范围",
  gapped: "行情存在缺口",
  stale: "快照使用当时的缓存行情",
  unavailable: "快照行情不可用",
  empty: "快照范围没有行情",
};

const sourceLabels: Record<NonNullable<PublicStrategyProjection["coverage"]["source"]>, string> = {
  public_api: "交易平台公开行情",
  signed_account: "账户签名行情",
};

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

function selectedBasis(projection: PublicStrategyProjection): TradeChartCandleSeriesBasis | null {
  const bases = new Set(projection.candles.map(({ series_basis }) => series_basis));
  if (projection.price_type === "both") {
    const preferred = projection.direction === "long" ? "bid" : "ask";
    if (bases.has(preferred)) return preferred;
    if (bases.has("bid")) return "bid";
    if (bases.has("ask")) return "ask";
    return null;
  }
  return bases.has(projection.price_type) ? projection.price_type : null;
}

function prepareChart(projection: PublicStrategyProjection): Preparation {
  try {
    const basis = selectedBasis(projection);
    const source = basis === null ? [] : projection.candles
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
    const chartedMarkers = projection.markers.flatMap((marker): PreparedMarker[] => {
      const occurredAt = unixTime(marker.occurred_at);
      const candleIndex = intervals.findIndex(({ openTime, closeTime }) => occurredAt >= openTime && occurredAt < closeTime);
      return candleIndex === -1 ? [] : [{
        marker,
        candleIndex,
        candleTime: intervals[candleIndex]!.openTime,
        price: decimal(marker.price),
      }];
    });
    const markerCounts = new Map<number, number>();
    for (const { candleTime } of chartedMarkers) markerCounts.set(candleTime, (markerCounts.get(candleTime) ?? 0) + 1);
    const frozenSeries = projection.indicators.flatMap((indicator) => indicator.series.map((series, index) => ({
      id: `${indicator.id}:${index}`,
      ...(indicator.pane_index === undefined ? {} : { paneIndex: indicator.pane_index }),
      points: series.points.map(({ time, value }) => ({ time: unixTime(time), value: value === null ? null : decimal(value) })),
    })));
    return {
      ok: true,
      value: {
        basis,
        candles,
        chartedMarkers,
        chartedMarkerKeys: new Set(chartedMarkers.map(({ marker }) => marker.marker_key)),
        gaps: projection.coverage.gaps
          .filter((gap) => gap.series_basis === basis)
          .map(({ from, to }) => ({ from: unixTime(from), to: unixTime(to) })),
        clusters: [...markerCounts].flatMap(([time, count]) => count > 1 ? [{ id: `cluster:${time}`, time, count }] : []),
        frozenSeries,
      },
    };
  } catch {
    return { ok: false, message: "快照图表数据格式异常，静态摘要与成交列表仍可查看。" };
  }
}

function markerShape(marker: PublicMarker): WaveKbChartMarker["shape"] {
  switch (marker.allocation_role) {
    case "open": return marker.side === "buy" ? "arrowUp" : "arrowDown";
    case "add": return "circle";
    case "reduce": return "diamond";
    case "close": return "square";
    case "reverse_open": return "flag";
  }
}

function chartMarkers(
  prepared: PreparedChart,
  selectedMarkerKey: string | null,
  theme: WaveKbChartTheme,
): WaveKbChartMarker[] {
  return prepared.chartedMarkers.map(({ marker, candleTime, price }) => {
    const selected = marker.marker_key === selectedMarkerKey;
    return {
      id: `fill:${marker.marker_key}`,
      time: candleTime,
      price,
      position: "atPrice" as const,
      shape: markerShape(marker),
      size: selected ? "big" as const : "medium" as const,
      color: marker.side === "buy" ? theme.positive : theme.negative,
      text: selected ? `${roleShortLabels[marker.allocation_role]} ✓` : roleShortLabels[marker.allocation_role],
      textColor: theme.axisText,
      bold: selected,
    };
  }).sort((left, right) => left.time - right.time || Number(left.bold === true) - Number(right.bold === true));
}

function colorOf(
  element: HTMLElement | null,
  property: "backgroundColor" | "color" | "borderTopColor",
  fallback: string,
) {
  if (element === null || typeof window === "undefined") return fallback;
  const value = window.getComputedStyle(element)[property];
  return value && value !== "transparent" && value !== "rgba(0, 0, 0, 0)" ? value : fallback;
}

function revealMarker(engine: WaveKbChartEngine, prepared: PreparedChart, markerKey: string) {
  const target = prepared.chartedMarkers.find(({ marker }) => marker.marker_key === markerKey);
  if (!target) return;
  const viewport = engine.getViewport();
  if (target.candleIndex >= viewport.from && target.candleIndex <= viewport.to) return;
  const span = viewport.to - viewport.from;
  if (Number.isFinite(span) && span > 0) {
    engine.setViewport({ from: target.candleIndex - span / 2, to: target.candleIndex + span / 2 });
  }
}

function clampViewport(engine: WaveKbChartEngine, candleCount: number, viewport: { from: number; to: number }) {
  if (candleCount === 0 || !Number.isFinite(viewport.from) || !Number.isFinite(viewport.to) || viewport.from >= viewport.to) return;
  const maximum = candleCount - 1;
  const span = viewport.to - viewport.from;
  const next = span >= maximum
    ? { from: 0, to: maximum }
    : {
      from: Math.max(0, Math.min(viewport.from, maximum - span)),
      to: Math.min(maximum, Math.max(viewport.to, span)),
    };
  if (next.from !== viewport.from || next.to !== viewport.to) engine.setViewport(next);
}

function amount(value: { amount: string; currency: string } | undefined) {
  return value === undefined ? "未提供" : `${value.amount} ${value.currency}`;
}

export function PublicStrategyChart({ projection, activeMarkerKey, commentsPostId }: PublicStrategyChartProps) {
  const titleId = useId();
  const chartElementRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<WaveKbChartEngine | null>(null);
  const selectedRef = useRef<string | null>(null);
  const surfaceProbeRef = useRef<HTMLSpanElement | null>(null);
  const foregroundProbeRef = useRef<HTMLSpanElement | null>(null);
  const gridProbeRef = useRef<HTMLSpanElement | null>(null);
  const primaryProbeRef = useRef<HTMLSpanElement | null>(null);
  const positiveProbeRef = useRef<HTMLSpanElement | null>(null);
  const negativeProbeRef = useRef<HTMLSpanElement | null>(null);
  const warningProbeRef = useRef<HTMLSpanElement | null>(null);
  const infoProbeRef = useRef<HTMLSpanElement | null>(null);
  const [selection, setSelection] = useState<{
    projection: PublicStrategyProjection;
    markerKey: string;
  } | null>(null);
  const [failedProjection, setFailedProjection] = useState<PublicStrategyProjection | null>(null);
  const [themeRevision, setThemeRevision] = useState(0);
  const preparation = useMemo(() => prepareChart(projection), [projection]);
  const selectedMarkerKey = selection?.projection === projection
    ? selection.markerKey
    : projection.markers.some(({ marker_key }) => marker_key === activeMarkerKey)
      ? activeMarkerKey ?? null
      : null;

  const readTheme = useCallback((): WaveKbChartTheme => {
    return {
      background: colorOf(surfaceProbeRef.current, "backgroundColor", "#ffffff"),
      grid: colorOf(gridProbeRef.current, "borderTopColor", "#e6ebf1"),
      axisText: colorOf(foregroundProbeRef.current, "color", "#18212c"),
      axisLine: colorOf(foregroundProbeRef.current, "borderTopColor", "#d8dee7"),
      primary: colorOf(primaryProbeRef.current, "backgroundColor", "#3f6f9f"),
      positive: colorOf(positiveProbeRef.current, "backgroundColor", "#1d6e4e"),
      negative: colorOf(negativeProbeRef.current, "backgroundColor", "#b4232e"),
    };
  }, []);

  const installFrozenSeries = useCallback((engine: WaveKbChartEngine, prepared: PreparedChart, theme: WaveKbChartTheme) => {
    if (typeof engine.setFrozenIndicatorSeries !== "function") throw new Error("frozen indicator renderer unavailable");
    const palette = [
      theme.primary,
      theme.positive,
      colorOf(warningProbeRef.current, "backgroundColor", "#995c00"),
      colorOf(infoProbeRef.current, "backgroundColor", "#24689b"),
      theme.negative,
    ];
    engine.setFrozenIndicatorSeries(prepared.frozenSeries.map((series, index) => ({
      ...series,
      color: palette[index % palette.length]!,
    })));
  }, []);

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
    if (engine === null || preparation.ok !== true) return;
    const theme = readTheme();
    engine.setTheme(theme);
    engine.setMarkers(chartMarkers(preparation.value, selectedMarkerKey, theme));
    installFrozenSeries(engine, preparation.value, theme);
  }, [installFrozenSeries, preparation, readTheme, selectedMarkerKey, themeRevision]);

  useEffect(() => {
    if (preparation.ok !== true || preparation.value.candles.length === 0) {
      engineRef.current = null;
      return;
    }
    const container = chartElementRef.current;
    if (container === null) return;

    let cancelled = false;
    let engine: WaveKbChartEngine | null = null;
    let unsubscribeMarkerClicks: (() => void) | null = null;
    let unsubscribeViewport: (() => void) | null = null;
    let resizeObserver: ResizeObserver | null = null;
    const dispose = () => {
      resizeObserver?.disconnect();
      resizeObserver = null;
      unsubscribeMarkerClicks?.();
      unsubscribeMarkerClicks = null;
      unsubscribeViewport?.();
      unsubscribeViewport = null;
      const current = engine;
      engine = null;
      if (engineRef.current === current) engineRef.current = null;
      current?.destroy();
    };

    void createWaveKbChartEngine(container, { timezone: "UTC", ariaLabel: "公开策略 K 线图" })
      .then(async (created) => {
        if (cancelled) {
          created.destroy();
          return;
        }
        engine = created;
        engineRef.current = created;
        const theme = readTheme();
        created.setTheme(theme);
        created.setCandles(preparation.value.candles);
        created.setCandleGaps(preparation.value.gaps);
        created.setMarkers(chartMarkers(preparation.value, selectedRef.current, theme));
        created.setFillClusters(preparation.value.clusters);
        installFrozenSeries(created, preparation.value, theme);
        await created.setDrawings({
          schemaVersion: WAVEKB_DRAWING_DOCUMENT_SCHEMA,
          drawings: projection.drawings.map((drawing) => ({ ...drawing, locked: true })),
        });
        if (cancelled) {
          dispose();
          return;
        }
        created.setViewport(null);
        unsubscribeMarkerClicks = created.subscribeMarkerClicks((markerId) => {
          if (markerId === null) {
            setSelection(null);
            return;
          }
          if (markerId.startsWith("cluster:")) {
            const time = Number(markerId.slice("cluster:".length));
            const first = preparation.value.chartedMarkers.find(({ candleTime }) => candleTime === time);
            if (first) setSelection({ projection, markerKey: first.marker.marker_key });
            return;
          }
          if (!markerId.startsWith("fill:")) return;
          const markerKey = markerId.slice("fill:".length);
          if (preparation.value.chartedMarkerKeys.has(markerKey)) setSelection({ projection, markerKey });
        });
        unsubscribeViewport = created.subscribeViewport((viewport) => {
          clampViewport(created, preparation.value.candles.length, viewport);
        });
        if (typeof ResizeObserver !== "undefined") {
          resizeObserver = new ResizeObserver((entries) => {
            const { width, height } = entries[0]?.contentRect ?? container.getBoundingClientRect();
            if (width > 0 && height > 0) created.resize(width, height, window.devicePixelRatio || 1);
          });
          resizeObserver.observe(container);
        }
      })
      .catch(() => {
        dispose();
        if (!cancelled) setFailedProjection(projection);
      });

    return () => {
      cancelled = true;
      dispose();
    };
  }, [installFrozenSeries, preparation, projection, readTheme]);

  const prepared = preparation.ok ? preparation.value : null;
  const engineError = failedProjection === projection;
  const annotationByMarker = new Map(projection.public_annotations.map((annotation) => [annotation.marker_key, annotation]));

  function selectMarker(markerKey: string) {
    setSelection({ projection, markerKey });
    const engine = engineRef.current;
    if (engine && prepared) revealMarker(engine, prepared, markerKey);
  }

  return (
    <section className="grid gap-4" aria-labelledby={titleId}>
      <span aria-hidden className="pointer-events-none absolute size-px overflow-hidden opacity-0">
        <span ref={surfaceProbeRef} className="bg-surface" />
        <span ref={foregroundProbeRef} className="border-t border-border text-foreground" />
        <span ref={gridProbeRef} className="border-t border-border-subtle" />
        <span ref={primaryProbeRef} className="bg-primary" />
        <span ref={positiveProbeRef} className="bg-success" />
        <span ref={negativeProbeRef} className="bg-destructive" />
        <span ref={warningProbeRef} className="bg-warning" />
        <span ref={infoProbeRef} className="bg-info" />
      </span>

      <header className="grid gap-3 rounded-card border bg-surface p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
        <div className="min-w-0">
          <p className="text-sm font-medium text-primary">不可变公开快照</p>
          <h2 id={titleId} className="mt-1 break-words text-xl font-semibold">公开策略图</h2>
          <p className="mt-1 flex flex-wrap gap-x-2 text-sm text-muted-foreground">
            <span>{projection.provider.toUpperCase()}</span>
            <span>{projection.symbol}</span>
            <span>{projection.timeframe}</span>
            <span>{projection.direction === "long" ? "多头" : "空头"}</span>
          </p>
        </div>
        <p className="rounded-full border bg-muted px-3 py-1 text-sm text-muted-foreground">
          {projection.snapshot_status === "closed" ? "已平仓快照" : "开放周期快照"}
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="公开字段摘要">
        <div className="rounded-card border bg-surface p-3">
          <p className="text-xs text-muted-foreground">固定范围与周期</p>
          <p className="mt-1 break-words text-sm font-medium tabular-nums">{projection.timeframe}</p>
          <p className="mt-1 break-all text-xs text-muted-foreground"><time dateTime={projection.range.from}>{projection.range.from}</time> 至 <time dateTime={projection.range.to}>{projection.range.to}</time></p>
        </div>
        <div className="rounded-card border bg-surface p-3">
          <p className="text-xs text-muted-foreground">仓位数量</p>
          <p className="mt-1 text-sm font-medium tabular-nums">{projection.show_quantity && projection.quantity ? projection.quantity : "仓位数量未公开"}</p>
        </div>
        <div className="rounded-card border bg-surface p-3">
          <p className="text-xs text-muted-foreground">绝对盈亏</p>
          <p className="mt-1 text-sm font-medium tabular-nums">{projection.show_absolute_pnl ? amount(projection.absolute_pnl) : "绝对盈亏未公开"}</p>
        </div>
        <div className="rounded-card border bg-surface p-3">
          <p className="text-xs text-muted-foreground">{projection.price_return_label}</p>
          <p className="mt-1 text-sm font-semibold tabular-nums">{projection.price_return_rate === null ? "无法可靠计算" : `${projection.price_return_rate}%`}</p>
        </div>
      </div>

      {projection.warnings.includes("hidden_value_may_be_inferred") ? (
        <p className="rounded-card border border-warning/30 bg-warning-surface p-3 text-sm text-warning" role="status">
          当前只公开数量或绝对盈亏其中一项，另一项可能被近似推断。
        </p>
      ) : null}
      {projection.coverage.status !== "complete" ? (
        <p className="rounded-card border border-warning/30 bg-warning-surface p-3 text-sm text-warning" role="status">
          {coverageLabels[projection.coverage.status]}
        </p>
      ) : null}
      {preparation.ok === false ? (
        <p className="rounded-card border border-destructive/30 bg-destructive-surface p-3 text-sm text-destructive" role="alert">
          {preparation.message}
        </p>
      ) : null}
      {engineError ? (
        <p className="rounded-card border border-destructive/30 bg-destructive-surface p-3 text-sm text-destructive" role="alert">
          图表未能加载，以下静态摘要与成交列表仍可查看。
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(18rem,.85fr)]">
        <div className="min-w-0">
          <div
            ref={chartElementRef}
            className="h-[26rem] min-h-72 overflow-hidden rounded-card border bg-surface"
            aria-label="公开策略 K 线图；只能在已存储范围内缩放和平移"
          />
          {prepared?.candles.length === 0 ? (
            <p className="-mt-52 px-6 text-center text-sm text-muted-foreground">暂无可绘制 K 线；静态成交列表仍可查看。</p>
          ) : null}
          {projection.coverage.gaps.length > 0 ? (
            <details className="mt-2 text-sm text-muted-foreground">
              <summary className="min-h-11 cursor-pointer py-2 text-warning focus-visible:outline-2 focus-visible:outline-ring">
                行情缺口（{projection.coverage.gaps.length} 段，UTC）
              </summary>
              <ul className="grid gap-1 pb-2 tabular-nums">
                {projection.coverage.gaps.map(({ from, to, series_basis }) => (
                  <li key={`${series_basis}:${from}`} className="flex flex-wrap gap-x-2">
                    <span>{series_basis.toUpperCase()}</span>
                    <time dateTime={from}>{from}</time><span>至</span><time dateTime={to}>{to}</time>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>

        <aside className="grid content-start gap-3" aria-label="快照静态摘要">
          <section className="rounded-card border bg-surface p-3">
            <h3 className="font-semibold">快照数据</h3>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground tabular-nums">
              <span>{projection.candles.length} 根 K 线</span>
              <span>{projection.markers.length} 笔成交</span>
              <span>{projection.indicators.length} 个指标</span>
              <span>{projection.drawings.length} 个公开画线</span>
            </div>
            <p className="mt-2 text-sm">{coverageLabels[projection.coverage.status]}</p>
            <p className="mt-1 break-words text-xs text-muted-foreground">
              {projection.coverage.source ? sourceLabels[projection.coverage.source] : "未记录行情来源"}
              {projection.coverage.fetched_at ? <>；快照行情时间 <time dateTime={projection.coverage.fetched_at}>{projection.coverage.fetched_at}</time></> : null}
            </p>
          </section>

          {projection.indicators.length > 0 ? (
            <details className="rounded-card border bg-surface p-3">
              <summary className="min-h-11 cursor-pointer py-2 font-semibold focus-visible:outline-2 focus-visible:outline-ring">已保存指标输出</summary>
              <ul className="grid gap-2 text-sm">
                {projection.indicators.map((indicator) => {
                  const points = indicator.series.flatMap((series) => series.points);
                  const latest = points.findLast(({ value }) => value !== null);
                  return (
                    <li key={indicator.id} className="border-t pt-2">
                      <p className="font-medium">{indicator.indicator_id.toUpperCase()}</p>
                      <p className="break-words text-muted-foreground tabular-nums">
                        {indicator.series.length} 组已存储序列；最新值 {latest?.value ?? "无"}{latest ? <>（<time dateTime={latest.time}>{latest.time}</time>）</> : null}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </details>
          ) : null}

          {projection.drawings.length > 0 ? (
            <details className="rounded-card border bg-surface p-3">
              <summary className="min-h-11 cursor-pointer py-2 font-semibold focus-visible:outline-2 focus-visible:outline-ring">只读公开画线</summary>
              <ul className="grid gap-2 text-sm">
                {projection.drawings.map((drawing) => (
                  <li key={drawing.id} className="border-t pt-2">
                    <p className="font-medium">{drawing.tool}</p>
                    <p className="text-muted-foreground">{drawing.points.length} 个固定锚点{drawing.text?.value ? `；${drawing.text.value}` : ""}</p>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </aside>
      </div>

      <section className="grid gap-3" aria-labelledby={`${titleId}-markers`}>
        <div>
          <h3 id={`${titleId}-markers`} className="text-lg font-semibold">公开成交列表</h3>
          <p className="mt-1 text-sm text-muted-foreground">图表只是可视化；此列表保留快照中的每一笔公开成交事实。</p>
        </div>
        <ol className="grid gap-2 sm:grid-cols-2">
          {projection.markers.map((marker) => {
            const annotation = annotationByMarker.get(marker.marker_key);
            const selected = marker.marker_key === selectedMarkerKey;
            return (
              <li key={marker.marker_key} className="min-w-0 rounded-card border bg-surface p-3">
                <Button
                  type="button"
                  variant={selected ? "soft" : "outline"}
                  aria-pressed={selected}
                  className="min-h-11 w-full min-w-0 justify-start whitespace-normal text-left"
                  onClick={() => selectMarker(marker.marker_key)}
                >
                  <span className="min-w-0">
                    <span className="block font-semibold">{roleLabels[marker.allocation_role]} · 价格 {marker.price}</span>
                    <span className="mt-1 block break-all text-xs font-normal text-muted-foreground"><time dateTime={marker.occurred_at}>{marker.occurred_at}</time></span>
                  </span>
                </Button>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">方向</dt><dd>{marker.side === "buy" ? "买入" : "卖出"} / {marker.position_side === "long" ? "多头" : marker.position_side === "short" ? "空头" : "双向"}</dd>
                  <dt className="text-muted-foreground">流动性</dt><dd>{marker.liquidity === "maker" ? "Maker" : marker.liquidity === "taker" ? "Taker" : "未知"}</dd>
                  <dt className="text-muted-foreground">数量</dt><dd className="tabular-nums">{projection.show_quantity ? marker.quantity ?? "未提供" : "未公开"}</dd>
                  <dt className="text-muted-foreground">绝对盈亏</dt><dd className="tabular-nums">{projection.show_absolute_pnl ? amount(marker.absolute_pnl) : "未公开"}</dd>
                </dl>
                {selected && commentsPostId ? (
                  <Link
                    className="mt-3 inline-flex min-h-11 items-center rounded-control border px-3 text-sm font-medium text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    href={`/community/post/${encodeURIComponent(commentsPostId)}?marker=${encodeURIComponent(marker.marker_key)}#comments-title`}
                  >
                    讨论这笔成交
                  </Link>
                ) : null}
                {annotation ? (
                  <div className="mt-3 border-t pt-3 text-sm">
                    <p className="whitespace-pre-wrap break-words">{annotation.body}</p>
                    {annotation.tags.length > 0 ? <p className="mt-1 break-words text-muted-foreground">{annotation.tags.join("、")}</p> : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      </section>
    </section>
  );
}
