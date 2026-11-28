"use client";

import {
  TRADE_CHART_DRAWING_TOOL_IDS,
  TRADE_CHART_DRAWING_TOOL_SCHEMAS,
  TRADE_CHART_INDICATOR_IDS,
  TRADE_CHART_MAX_DRAWINGS,
  TRADE_CHART_MAX_INDICATORS,
  TRADE_CHART_STATE_SCHEMA_VERSION,
  type ChartStateV1,
  type DrawingSpecV1,
  type IndicatorSpecV1,
  type TradeChartDrawingToolId,
  type TradeChartIndicatorId,
  type TradeChartProjection,
} from "@wavekb/domain/trading-review";
import { Button, Field, Input, Label } from "@wavekb/ui";
import { useEffect, useId, useRef, useState } from "react";
import {
  WAVEKB_DRAWING_DOCUMENT_SCHEMA,
  type WaveKbChartEngine,
  type WaveKbChartViewport,
} from "@/lib/trading/chart-engine";
import {
  getTradeChart,
  saveTradeChartState,
  TradingRepositoryError,
  type SaveTradeChartStateInput,
} from "@/lib/trading/workbench-repository";

const indicatorNames = {
  sma: "SMA", ema: "EMA", wma: "WMA", hma: "HMA", vwap: "VWAP",
  bollinger: "布林带 Bollinger", rsi: "RSI", macd: "MACD", stochastic: "随机指标 Stochastic",
  adx: "ADX / DMI", atr: "ATR", supertrend: "Supertrend", ichimoku: "一目均衡表 Ichimoku",
  donchian: "唐奇安通道 Donchian", "keltner-channel": "肯特纳通道 Keltner",
  "chandelier-exit": "吊灯止损 Chandelier Exit", zigzag: "ZigZag", "williams-fractals": "威廉分形",
  "pivot-points": "枢轴点 Pivot Points", cpr: "CPR", obv: "OBV", mfi: "MFI",
  "chaikin-money-flow": "CMF",
} satisfies Record<TradeChartIndicatorId, string>;

const drawingNames = {
  "trend-line": "趋势线", ray: "射线", "horizontal-line": "水平线", "vertical-line": "垂直线",
  rectangle: "矩形", text: "文字", "long-position": "做多风险收益", "short-position": "做空风险收益",
  "fib-retracement": "斐波那契回撤", "fib-extension": "斐波那契扩展", "fib-time-zone": "斐波那契时间投射",
  "fib-fan": "斐波那契扇形", "fib-channel": "斐波那契通道",
  "elliott-impulse": "艾略特推动浪", "elliott-correction": "艾略特调整浪", "elliott-triangle": "艾略特三角形",
  "elliott-double-combo": "艾略特双重组合", "elliott-triple-combo": "艾略特三重组合",
} satisfies Record<TradeChartDrawingToolId, string>;

const volumeStudies = new Set<TradeChartIndicatorId>(["vwap", "obv", "mfi", "chaikin-money-flow"]);
const matches = (query: string, id: string, name: string) =>
  `${name} ${id}`.toLowerCase().includes(query.trim().toLowerCase());

function reliableVolume(projection: TradeChartProjection): boolean {
  // Mark prices have no traded volume and Exness provides quote tick counts.
  return projection.provider !== "exness" && projection.price_type === "trade"
    && projection.candles.length > 0
    && projection.candles.every(({ volume }) => volume !== null && /^\d+(?:\.\d+)?$/.test(volume) && Number.isFinite(Number(volume)))
    && projection.candles.some(({ volume }) => Number(volume) > 0);
}

function usableViewport(viewport: WaveKbChartViewport) {
  return Number.isFinite(viewport.from) && Number.isFinite(viewport.to)
    && viewport.from >= -10_000_000_000_000 && viewport.to <= 10_000_000_000_000 && viewport.from < viewport.to;
}

function restoredIndicators(projection: TradeChartProjection): IndicatorSpecV1[] {
  const seen = new Set<string>();
  const result: IndicatorSpecV1[] = [];
  for (const { indicatorId, instanceId, settings, paneIndex } of projection.chart_state?.indicators ?? []) {
    if (!Object.hasOwn(indicatorNames, indicatorId) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(instanceId)
      || seen.has(instanceId) || result.length === TRADE_CHART_MAX_INDICATORS) continue;
    seen.add(instanceId);
    // The owner chart API validates per-indicator setting keys and bounds. Read
    // only its known DTO members and discard incompatible timeframe settings.
    const safeSettings = settings
      ? Object.fromEntries(Object.entries(settings).filter(([key, value]) => {
        if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) || ["constructor", "prototype", "toString"].includes(key)) return false;
        if (key === "timeframe" && value !== "" && value !== projection.timeframe) return false;
        if (typeof value === "number") return Number.isFinite(value);
        return typeof value === "boolean" || (typeof value === "string" && value.length <= 128
          && /^[\w #.()-]*$/.test(value) && !/expression\(|url\(/i.test(value));
      }))
      : undefined;
    result.push({
      indicatorId, instanceId,
      ...(safeSettings === undefined ? {} : { settings: safeSettings }),
      ...(Number.isInteger(paneIndex) && paneIndex! >= 0 && paneIndex! <= 15 ? { paneIndex } : {}),
    });
  }
  return result;
}

type SaveStatus = "idle" | "queued" | "saving" | "saved" | "failed" | "conflict" | "oversized" | "restore_failed";
const saveLabels: Record<SaveStatus, string> = {
  idle: "", queued: "等待自动保存…", saving: "正在保存图表…", saved: "图表已保存",
  failed: "暂时无法保存图表。", conflict: "图表已在另一处更新。本次编辑仍在当前页面，请核对后重新载入。",
  oversized: "图表内容超出保存上限，请移除部分对象后再试。",
  restore_failed: "已保存的画线暂时无法还原。请重新载入后编辑。",
};

type PanelState = {
  indicators: IndicatorSpecV1[];
  drawings: DrawingSpecV1[];
  failedIndicators: readonly string[];
  saveStatus: SaveStatus;
  tool: TradeChartDrawingToolId | null;
  actionError: string;
  ready: boolean;
};

type Session = {
  state: PanelState;
  notify: ((state: PanelState) => void) | null;
  projection: TradeChartProjection;
  engine: WaveKbChartEngine;
  hasVolume: boolean;
  viewport: WaveKbChartViewport;
  version: number;
  updatedAt: string | null;
  edit: number;
  savedEdit: number;
  studyUpdate: number;
  timer: ReturnType<typeof setTimeout> | null;
  due: boolean;
  running: boolean;
  uncertain: { input: SaveTradeChartStateInput; edit: number } | null;
};

function publish(session: Session, patch: Partial<PanelState>) {
  session.state = { ...session.state, ...patch };
  session.notify?.(session.state);
}

function flush(session: Session) {
  const { projection, state } = session;
  if (!session.due || !state.ready || session.running || session.uncertain || session.edit === session.savedEdit
    || state.saveStatus === "conflict" || state.saveStatus === "restore_failed") return;
  const edit = session.edit;
  const input: SaveTradeChartStateInput = {
    cycle_revision: projection.cycle_revision, schema_version: TRADE_CHART_STATE_SCHEMA_VERSION,
    timeframe: projection.timeframe, price_type: projection.price_type, viewport: session.viewport,
    indicators: state.indicators, drawings: state.drawings,
    expected_version: session.version, expected_updated_at: session.updatedAt,
  };
  session.due = false;
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > 32 * 1024) {
    publish(session, { saveStatus: "oversized" });
    return;
  }
  session.running = true;
  publish(session, { saveStatus: "saving" });
  void saveTradeChartState(projection.cycle_id, input).then(({ version, updated_at }) => {
    session.version = version;
    session.updatedAt = updated_at;
    session.savedEdit = edit;
    session.running = false;
    publish(session, { saveStatus: session.edit === edit ? "saved" : "queued" });
    flush(session);
  }).catch((error) => {
    session.running = false;
    const stale = isLayoutConflict(error);
    if (!stale) session.uncertain = { input, edit };
    publish(session, { saveStatus: stale ? "conflict" : "failed" });
  });
}

function isLayoutConflict(error: unknown) {
  return error instanceof TradingRepositoryError
    && (error.status === 409 || error.code === "trade_cycle_not_found" || error.code === "trade_chart_cycle_not_owned");
}

function stableJson(value: unknown) {
  return JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left < right ? -1 : left === right ? 0 : 1))
      : item);
}

function matchesSavedLayout(state: ChartStateV1, input: SaveTradeChartStateInput) {
  return state.cycle_revision === input.cycle_revision && state.timeframe === input.timeframe
    && state.price_type === input.price_type && state.schema_version === input.schema_version
    && stableJson(state.viewport) === stableJson(input.viewport)
    && stableJson(state.indicators) === stableJson(input.indicators)
    && stableJson(state.drawings) === stableJson(input.drawings);
}

async function retryLayout(session: Session) {
  if (session.running || !session.uncertain) return;
  const { edit, input } = session.uncertain;
  const { projection } = session;
  session.running = true;
  publish(session, { saveStatus: "saving" });
  try {
    const latest = await getTradeChart(projection.cycle_id, { timeframe: projection.timeframe, ...projection.range });
    const state = latest.chart_state;
    const sameCycle = latest.cycle_id === projection.cycle_id && latest.cycle_revision === projection.cycle_revision;
    if (sameCycle && state && matchesSavedLayout(state, input)) {
      session.savedEdit = edit;
      session.version = state.version;
      session.updatedAt = state.updated_at;
    } else if (!sameCycle || (state?.version ?? 0) !== session.version || (state?.updated_at ?? null) !== session.updatedAt) {
      session.uncertain = null;
      publish(session, { saveStatus: "conflict" });
      return;
    }
    session.uncertain = null;
    const unsaved = session.savedEdit !== session.edit;
    publish(session, { saveStatus: unsaved ? "queued" : "saved" });
    session.due = unsaved;
  } catch (error) {
    publish(session, { saveStatus: isLayoutConflict(error) ? "conflict" : "failed" });
  } finally {
    session.running = false;
    flush(session);
  }
}

function queue(session: Session) {
  session.edit += 1;
  if (session.uncertain || session.state.saveStatus === "conflict" || session.state.saveStatus === "restore_failed") return;
  if (session.timer !== null) clearTimeout(session.timer);
  session.due = false;
  if (!session.running) publish(session, { saveStatus: "queued" });
  session.timer = setTimeout(() => {
    session.timer = null;
    session.due = true;
    flush(session);
  }, 600);
}

function renderStudies(session: Session) {
  const requested = session.state.indicators.filter(({ indicatorId }) => session.hasVolume || !volumeStudies.has(indicatorId));
  const update = ++session.studyUpdate;
  void session.engine.setIndicators(requested).then((failed) => {
    if (session.studyUpdate === update) publish(session, { failedIndicators: failed ?? [] });
  }).catch(() => {
    if (session.studyUpdate === update) publish(session, { failedIndicators: requested.map(({ instanceId }) => instanceId) });
  });
}

export type SavedStrategyLayout = { version: number; indicators: IndicatorSpecV1[]; drawings: DrawingSpecV1[] };

export function ChartToolPanel({ projection, engine, onShare }: {
  projection: TradeChartProjection;
  engine: WaveKbChartEngine;
  onShare?: ((layout: SavedStrategyLayout) => void) | undefined;
}) {
  const labelId = useId();
  const sessionRef = useRef<Session | null>(null);
  const [indicatorQuery, setIndicatorQuery] = useState("");
  const [drawingQuery, setDrawingQuery] = useState("");
  const [view, setView] = useState<PanelState>({
    indicators: [], drawings: [], failedIndicators: [], tool: null, actionError: "", saveStatus: "idle", ready: false,
  });
  const hasVolume = reliableVolume(projection);

  useEffect(() => {
    const initial = projection.chart_state;
    const viewport = engine.getViewport();
    const session: Session = {
      projection, engine, hasVolume, notify: setView,
      state: {
        indicators: restoredIndicators(projection), drawings: [], failedIndicators: [], tool: null, actionError: "",
        saveStatus: initial ? "saved" : "idle", ready: false,
      },
      viewport: usableViewport(viewport) ? viewport : { from: -1, to: Math.max(1, projection.candles.length - 1) },
      version: initial?.version ?? 0, updatedAt: initial?.updated_at ?? null,
      edit: 0, savedEdit: 0, studyUpdate: 0, timer: null, due: false, running: false, uncertain: null,
    };
    sessionRef.current = session;
    const offDrawings = engine.subscribeDrawings(({ document, kind }) => {
      if (!session.state.ready || kind === "restore") return;
      publish(session, { drawings: [...document.drawings] });
      if (document.drawings.length >= TRADE_CHART_MAX_DRAWINGS) engine.cancelDrawingTool();
      queue(session);
    });
    const offTool = engine.subscribeDrawingTool((tool) => publish(session, { tool }));
    const offViewport = engine.subscribeViewport((next) => {
      if (!usableViewport(next)) return;
      session.viewport = next;
      if (session.state.ready) queue(session);
    });

    void Promise.resolve().then(async () => {
      if (!session.notify) return;
      if (initial?.drawings.length) {
        await engine.setDrawings({ schemaVersion: WAVEKB_DRAWING_DOCUMENT_SCHEMA, drawings: initial.drawings });
      }
      if (!session.notify) return;
      if (initial?.cycle_revision === projection.cycle_revision && initial.timeframe === projection.timeframe
        && initial.price_type === projection.price_type && usableViewport(initial.viewport)) {
        engine.setViewport(initial.viewport);
        session.viewport = initial.viewport;
      }
      publish(session, { drawings: [...engine.getDrawings().drawings], ready: true });
      renderStudies(session);
    }).catch(() => {
      publish(session, { saveStatus: "restore_failed" });
      if (session.notify) renderStudies(session);
    });

    return () => {
      sessionRef.current = null;
      session.notify = null;
      session.studyUpdate += 1;
      offDrawings();
      offTool();
      offViewport();
      if (session.timer !== null) clearTimeout(session.timer);
      if (session.state.saveStatus === "queued" || session.state.saveStatus === "saving") {
        session.due = true;
        flush(session);
      }
    };
  }, [engine, hasVolume, projection]);

  function changeIndicators(change: (current: IndicatorSpecV1[]) => IndicatorSpecV1[]) {
    const session = sessionRef.current;
    if (!session?.state.ready) return;
    publish(session, { indicators: change(session.state.indicators) });
    renderStudies(session);
    queue(session);
  }

  async function armDrawing(tool: TradeChartDrawingToolId) {
    const session = sessionRef.current;
    if (!session?.state.ready || session.state.drawings.length >= TRADE_CHART_MAX_DRAWINGS) return;
    try {
      await engine.armDrawingTool(tool);
      publish(session, { actionError: "" });
    } catch {
      publish(session, { actionError: "暂时无法开启此画线工具。" });
    }
  }

  function drawingAction(action: () => boolean) {
    const session = sessionRef.current;
    if (!session?.state.ready) return;
    try {
      action();
      publish(session, { actionError: "" });
    } catch {
      publish(session, { actionError: "无法更改画线，请检查文字内容或重新载入。" });
    }
  }

  function retrySave() {
    const session = sessionRef.current;
    if (!session || session.state.saveStatus !== "failed") return;
    void retryLayout(session);
  }

  const indicators = TRADE_CHART_INDICATOR_IDS.filter((id) => matches(indicatorQuery, id, indicatorNames[id]));
  const drawingTools = TRADE_CHART_DRAWING_TOOL_IDS.filter((id) => matches(drawingQuery, id, drawingNames[id]));
  const saveError = ["failed", "conflict", "oversized", "restore_failed"].includes(view.saveStatus);
  const indicatorCounts = new Map<TradeChartIndicatorId, number>();
  const drawingCounts = new Map<TradeChartDrawingToolId, number>();
  const readyToShare = view.ready && (view.saveStatus === "saved" || view.saveStatus === "idle") && view.tool === null;

  function openShare() {
    const session = sessionRef.current;
    if (!onShare || !session?.state.ready || session.edit !== session.savedEdit || session.running
      || session.uncertain || session.state.tool !== null) return;
    onShare({ version: session.version, indicators: session.state.indicators, drawings: session.state.drawings });
  }

  return (
    <div className="grid min-w-0 gap-2 rounded-card border bg-surface p-3" aria-label="私人图表工具">
      <div className="grid gap-2 md:grid-cols-3">
        <details className="min-w-0">
          <summary className="min-h-11 cursor-pointer rounded-control px-2 py-3 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-ring">指标</summary>
          <div className="grid gap-2 px-1 pb-2">
            <Field>
              <Label htmlFor={`${labelId}-studies`}>搜索指标</Label>
              <Input id={`${labelId}-studies`} type="search" value={indicatorQuery} onChange={(event) => setIndicatorQuery(event.target.value)} />
            </Field>
            {projection.provider === "exness" && <p className="text-xs text-muted-foreground">Exness 提供报价跳动量，成交量指标暂不可用。</p>}
            {indicators.length === 0 ? <p className="text-sm text-muted-foreground">没有匹配的指标。</p> : (
              <ul className="grid max-h-56 gap-1 overflow-auto p-1">
                {indicators.map((id) => {
                  const volumeMissing = !hasVolume && volumeStudies.has(id);
                  return <li key={id}>
                    <Button className="w-full justify-start whitespace-normal text-left" type="button" variant="ghost"
                      aria-label={`添加 ${indicatorNames[id]}`}
                      disabled={!view.ready || volumeMissing || view.indicators.length >= TRADE_CHART_MAX_INDICATORS}
                      onClick={() => changeIndicators((current) => [...current, { indicatorId: id, instanceId: crypto.randomUUID() }])}>
                      {indicatorNames[id]}{volumeMissing && " · 缺少成交量"}
                    </Button>
                  </li>;
                })}
              </ul>
            )}
          </div>
        </details>

        <details className="min-w-0">
          <summary className="min-h-11 cursor-pointer rounded-control px-2 py-3 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-ring">画线</summary>
          <div className="grid gap-2 px-1 pb-2">
            <Field>
              <Label htmlFor={`${labelId}-drawings`}>搜索画线工具</Label>
              <Input id={`${labelId}-drawings`} type="search" value={drawingQuery} onChange={(event) => setDrawingQuery(event.target.value)} />
            </Field>
            <div className="flex flex-wrap gap-1">
              <Button type="button" variant="ghost" disabled={!view.ready} onClick={() => drawingAction(() => engine.undoDrawings())}>撤销</Button>
              <Button type="button" variant="ghost" disabled={!view.ready} onClick={() => drawingAction(() => engine.redoDrawings())}>重做</Button>
              <Button type="button" variant="ghost" disabled={view.tool === null} onClick={() => drawingAction(() => engine.cancelDrawingTool())}>取消画线</Button>
            </div>
            {drawingTools.length === 0 ? <p className="text-sm text-muted-foreground">没有匹配的画线工具。</p> : (
              <ul className="grid max-h-56 gap-1 overflow-auto p-1">
                {drawingTools.map((id) => <li key={id}>
                  <Button className="w-full justify-start whitespace-normal text-left" type="button"
                    variant={view.tool === id ? "soft" : "ghost"} aria-pressed={view.tool === id}
                    disabled={!view.ready || view.drawings.length >= TRADE_CHART_MAX_DRAWINGS}
                    onClick={() => { void armDrawing(id); }}>{drawingNames[id]}</Button>
                </li>)}
              </ul>
            )}
          </div>
        </details>

        <details className="min-w-0">
          <summary className="min-h-11 cursor-pointer rounded-control px-2 py-3 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-ring">图表对象</summary>
          <ul className="grid max-h-64 gap-2 overflow-auto p-1">
            {view.indicators.map(({ indicatorId, instanceId }) => {
              const count = (indicatorCounts.get(indicatorId) ?? 0) + 1;
              indicatorCounts.set(indicatorId, count);
              const name = `${indicatorNames[indicatorId]} ${count}`;
              return <li key={instanceId} className="flex min-w-0 flex-wrap items-center justify-between gap-1 border-b text-sm">
                <span>{name}{view.failedIndicators.includes(instanceId) ? " · 计算失败" : !hasVolume && volumeStudies.has(indicatorId) ? " · 缺少成交量" : ""}</span>
                <Button type="button" variant="ghost" aria-label={`移除 ${name}`}
                  onClick={() => changeIndicators((current) => current.filter((item) => item.instanceId !== instanceId))}>移除</Button>
              </li>;
            })}
            {view.drawings.map((drawing) => {
              const count = (drawingCounts.get(drawing.tool) ?? 0) + 1;
              drawingCounts.set(drawing.tool, count);
              const name = `${drawingNames[drawing.tool]} ${count}`;
              const visible = drawing.visible !== false;
              return <li key={drawing.id} className="grid min-w-0 gap-1 border-b py-1 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <span>{name}</span>
                  <div className="flex flex-wrap gap-1">
                    <Button type="button" variant="ghost" aria-label={`${visible ? "隐藏" : "显示"} ${name}`}
                      onClick={() => drawingAction(() => engine.setDrawingVisibility(drawing.id, !visible))}>{visible ? "隐藏" : "显示"}</Button>
                    <Button type="button" variant="ghost" aria-label={`删除 ${name}`}
                      onClick={() => drawingAction(() => engine.removeDrawing(drawing.id))}>删除</Button>
                  </div>
                </div>
                {drawing.tool === "text" && <Input key={drawing.text?.value} aria-label={`${name}内容`} maxLength={2000}
                  defaultValue={drawing.text?.value ?? ""}
                  onBlur={(event) => {
                    const value = event.currentTarget.value;
                    if (value !== drawing.text?.value) drawingAction(() => engine.setDrawingText(drawing.id, value));
                  }}
                  onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />}
              </li>;
            })}
            {view.indicators.length === 0 && view.drawings.length === 0 && <li className="text-sm text-muted-foreground">尚未添加对象。</li>}
          </ul>
        </details>
      </div>
      {view.tool !== null && <p className="text-sm text-muted-foreground">
        {drawingNames[view.tool]}：请在图上选择{TRADE_CHART_DRAWING_TOOL_SCHEMAS[view.tool].pointCount}个锚点。
      </p>}
      {view.actionError && <p role="alert" className="text-sm text-destructive">{view.actionError}</p>}
      {saveError
        ? <p role="alert" className="text-sm text-destructive">{saveLabels[view.saveStatus]}</p>
        : <p role="status" aria-live="polite" className="text-xs text-muted-foreground">{saveLabels[view.saveStatus]}</p>}
      {view.saveStatus === "failed" && <Button type="button" variant="outline" className="justify-self-start" onClick={retrySave}>重试保存</Button>}
      {onShare && <Button type="button" variant="outline" className="justify-self-start" disabled={!readyToShare} onClick={openShare}>
        分享策略图
      </Button>}
    </div>
  );
}
