"use client";

import { useEffect, useId, useRef, useState } from "react";
import NextImage from "next/image";
import { assertWaveChart, type WaveChart } from "../../../../ai-gateway/src/research/wave-chart.ts";

type Scenario = WaveChart["scenarios"][number];
const SCENARIO_LABELS = { primary: "主计数", alternative_a: "备选 A", alternative_b: "备选 B" } as const;
const BUTTON = "min-h-11 cursor-pointer rounded-lg border px-3 py-2 text-sm font-semibold active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-55";
const SVG_TAGS = new Set(["svg", "title", "desc", "g", "line", "rect", "circle", "text", "polyline", "polygon"]);
const SVG_ATTRIBUTES = new Set(["xmlns", "viewBox", "width", "height", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "points", "fill", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "text-anchor", "font-size", "font-weight", "font-family", "id", "role", "aria-labelledby", "aria-describedby", "data-testid"]);

function formatPrice(value: number) {
  if (value !== 0 && (Math.abs(value) < 0.000001 || Math.abs(value) >= 1e9)) return value.toExponential(4);
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: Math.abs(value) < 1 ? 8 : 4 }).format(value);
}

function formatAxisPrice(value: number) {
  if (value !== 0 && (Math.abs(value) < 0.001 || Math.abs(value) >= 100_000)) return value.toExponential(1);
  return new Intl.NumberFormat("zh-CN", { maximumSignificantDigits: 5 }).format(value);
}

function pointAmplitude(points: Scenario["points"], index: number) {
  if (!index) return "起点";
  const delta = points[index].price - points[index - 1].price;
  return `Δ ${delta >= 0 ? "+" : ""}${formatAxisPrice(delta)}`;
}

function placeLabels(points: Scenario["points"], x: (value: number) => number, y: (value: number) => number, left: number, right: number, top: number, bottom: number) {
  const occupied: { x: number; y: number; width: number }[] = [];
  const maxLane = Math.floor((bottom - top - 40) / 36);
  const snapY = (value: number) => top + 20 + Math.min(maxLane, Math.max(0, Math.round((value - top - 20) / 36))) * 36;
  return points.map((point, index) => {
    const px = x(point.x);
    const py = y(point.price);
    const width = Math.max(42, pointAmplitude(points, index).length * 7 + 12);
    const preferred = index % 2 === 0 ? -28 : 29;
    let position = { x: Math.min(right - width / 2, Math.max(left + width / 2, px)), y: snapY(py + preferred), width };
    for (const offset of [preferred, -preferred, -65, 66, -101, 102, ...Array.from({ length: Math.floor((bottom - top) / 36) }, (_, lane) => top + 20 + lane * 36 - py)]) {
      const candidate = { x: position.x, y: snapY(py + offset), width };
      if (occupied.every((item) => Math.abs(item.x - candidate.x) >= (item.width + candidate.width) / 2 + 4 || Math.abs(item.y - candidate.y) >= 36)) { position = candidate; break; }
    }
    occupied.push(position);
    return position;
  });
}

function formatX(value: number, mode: WaveChart["mode"]) {
  if (mode === "structure") return `结构点 ${value + 1}`;
  return new Date(value * 1000).toLocaleString("zh-CN", { timeZone: "UTC", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

function readChart(value: unknown): WaveChart | null {
  try { assertWaveChart(value); return value; } catch { return null; }
}

// Downloads serialize only this renderer's allowed primitives. No arbitrary SVG,
// external resources, raw model markup, or style sheets are accepted.
export function serializeWaveChartSvg(source: SVGSVGElement): string {
  const clone = source.cloneNode(true) as SVGSVGElement;
  const originals = [source, ...source.querySelectorAll("*")];
  const copies = [clone, ...clone.querySelectorAll("*")];
  for (let index = 0; index < originals.length; index++) {
    const original = originals[index];
    const copy = copies[index];
    if (original.namespaceURI !== "http://www.w3.org/2000/svg" || !SVG_TAGS.has(original.localName)) throw new Error("chart_export_unavailable");
    for (const attribute of [...copy.attributes]) {
      if (attribute.name === "class" || attribute.name === "style") { copy.removeAttribute(attribute.name); continue; }
      if (!SVG_ATTRIBUTES.has(attribute.name) || /(?:https?:|file:|javascript:|data:|url\s*\()/i.test(attribute.value)) throw new Error("chart_export_unavailable");
      if ((attribute.name === "fill" || attribute.name === "stroke") && attribute.value.includes("var(")) {
        const resolved = getComputedStyle(original).getPropertyValue(attribute.name).trim();
        if (!resolved || /(?:var\(|url\s*\()/i.test(resolved)) throw new Error("chart_export_unavailable");
        copy.setAttribute(attribute.name, resolved);
      }
    }
  }
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const viewBox = source.viewBox?.baseVal;
  const parts = source.getAttribute("viewBox")?.split(/\s+/).map(Number);
  const width = viewBox?.width || parts?.[2];
  const height = viewBox?.height || parts?.[3];
  if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height)) throw new Error("chart_export_unavailable");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  return new XMLSerializer().serializeToString(clone);
}

function attemptDownload(url: string, extension: "svg" | "png") {
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `wavekb-wave-analysis.${extension}`;
    document.body.appendChild(anchor);
    try { anchor.click(); } finally { anchor.remove(); }
  } catch {
    // Browser policies can block the automatic click. The generated file is
    // still available through the user-activated download link below.
  }
}

async function savePng(svg: string, width: number, height: number) {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("chart_export_unavailable")), 10_000);
      image.onload = () => { clearTimeout(timer); resolve(); };
      image.onerror = () => { clearTimeout(timer); reject(new Error("chart_export_unavailable")); };
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = width * 2;
    canvas.height = height * 2;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("chart_export_unavailable");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("chart_export_unavailable")), 10_000);
      try {
        canvas.toBlob((result) => { clearTimeout(timer); if (result) resolve(result); else reject(new Error("chart_export_unavailable")); }, "image/png");
      } catch { clearTimeout(timer); reject(new Error("chart_export_unavailable")); }
    });
    return blob;
  } finally { URL.revokeObjectURL(url); }
}

function ChartFigure({ chart, scenario }: { chart: WaveChart; scenario?: Scenario }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const container = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(640);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);
  const [generated, setGenerated] = useState<{ url: string; format: "svg" | "png"; width: number; height: number } | null>(null);
  const generatedUrl = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (generatedUrl.current) URL.revokeObjectURL(generatedUrl.current);
      generatedUrl.current = null;
    };
  }, []);
  useEffect(() => {
    const element = container.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry?.contentRect.width > 0) setWidth(Math.min(960, Math.max(280, Math.floor(entry.contentRect.width))));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const points = scenario?.points ?? [];
  const prices = [...chart.bars.flatMap((bar) => [bar.high, bar.low]), ...points.map((point) => point.price), ...(scenario?.invalidation == null ? [] : [scenario.invalidation])];
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const padding = (high - low || high * 0.01 || 1) * 0.14;
  const minPrice = low - padding;
  const maxPrice = high + padding;
  const xs = chart.mode === "ohlc" ? chart.bars.map((bar) => bar.time) : points.map((point) => point.x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const left = width < 480 ? 58 : 66;
  const right = width - 54;
  const top = 36;
  // Enough vertical lanes even when twelve valid anchors are clustered in a
  // narrow time range. Labels keep their readable size on a 375px screen.
  const bottom = top + Math.max(298, points.length * 36 + 40);
  const hasInvalidation = scenario?.invalidation != null;
  const height = bottom + (hasInvalidation ? 126 : 106);
  const x = (value: number) => left + (value - minX) / (maxX - minX || 1) * (right - left);
  const y = (price: number) => bottom - (price - minPrice) / (maxPrice - minPrice || 1) * (bottom - top);
  const tickCount = width < 480 ? 3 : 5;
  const measurement = scenario?.max_retracement;
  const measurementX = width - 28;
  const candleWidth = Math.max(1.5, Math.min(9, (right - left) / Math.max(chart.bars.length, 1) * 0.55));
  const labels = placeLabels(points, x, y, left, right, top, bottom);

  async function exportChart(format: "svg" | "png") {
    if (!svg.current || exporting) return;
    setExporting(true);
    setExportError(false);
    if (generatedUrl.current) URL.revokeObjectURL(generatedUrl.current);
    generatedUrl.current = null;
    setGenerated(null);
    try {
      const content = serializeWaveChartSvg(svg.current);
      const blob = format === "svg" ? new Blob([content], { type: "image/svg+xml;charset=utf-8" }) : await savePng(content, width, height);
      if (!mounted.current) return;
      const url = URL.createObjectURL(blob);
      if (!url.startsWith("blob:")) { URL.revokeObjectURL(url); throw new Error("chart_export_unavailable"); }
      generatedUrl.current = url;
      setGenerated({ url, format, width: width * (format === "png" ? 2 : 1), height: height * (format === "png" ? 2 : 1) });
      attemptDownload(url, format);
    } catch { if (mounted.current) setExportError(true); }
    finally { if (mounted.current) setExporting(false); }
  }

  return <>
    <div ref={container} className="min-w-0 rounded-lg border bg-surface p-2">
      <svg ref={svg} viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} fontFamily="sans-serif">
        <title id={`${id}-title`}>{chart.instrument} 波浪分析图{scenario ? `：${SCENARIO_LABELS[scenario.key]}` : "：暂无计数"}</title>
        <desc id={`${id}-description`}>{chart.mode === "ohlc" ? "用户提供的历史价格，横轴为 UTC 时间，不代表实时行情。" : "手填波浪点的结构示意图，横轴仅为结构点序号，不是时间 K 线。"}候选浪使用长虚线，存疑浪使用短点线；最大反向幅度使用垂直双向箭头，详情见下方数据表。</desc>
        <rect x={0} y={0} width={width} height={height} fill="var(--surface)" />
        {Array.from({ length: tickCount }, (_, index) => {
          const price = minPrice + (maxPrice - minPrice) * index / (tickCount - 1);
          return <g key={index}><line x1={left} x2={right} y1={y(price)} y2={y(price)} stroke="var(--border)" strokeWidth={1} /><text x={left - 7} y={y(price) + 4} textAnchor="end" fill="var(--muted-foreground)" fontSize={12}>{formatAxisPrice(price)}</text></g>;
        })}
        <text x={left} y={19} fill="var(--muted-foreground)" fontSize={12}>价格</text>
        {chart.bars.map((bar) => <g key={bar.time}>
          <line x1={x(bar.time)} x2={x(bar.time)} y1={y(bar.high)} y2={y(bar.low)} stroke="var(--muted-foreground)" strokeWidth={1} />
          <rect x={x(bar.time) - candleWidth / 2} y={y(Math.max(bar.open, bar.close))} width={candleWidth} height={Math.max(1, Math.abs(y(bar.open) - y(bar.close)))} fill={bar.close >= bar.open ? "var(--surface)" : "var(--muted-foreground)"} stroke="var(--muted-foreground)" strokeWidth={1} />
        </g>)}
        {scenario?.invalidation == null ? null : <line x1={left} x2={right} y1={y(scenario.invalidation)} y2={y(scenario.invalidation)} stroke="var(--destructive)" strokeWidth={1.5} strokeDasharray="8 5" />}
        {points.slice(1).map((point, index) => {
          const start = points[index];
          const uncertain = point.certainty === "uncertain" || start.certainty === "uncertain";
          return <line key={`segment-${index}`} data-testid={uncertain ? "uncertain-segment" : "candidate-segment"} x1={x(start.x)} y1={y(start.price)} x2={x(point.x)} y2={y(point.price)} stroke="var(--primary)" strokeWidth={2} strokeDasharray={uncertain ? "2 5" : "9 4"} strokeLinecap="round" />;
        })}
        {points.map((point, index) => {
          const py = y(point.price);
          const label = labels[index];
          return <g key={`point-${index}`}><circle cx={x(point.x)} cy={py} r={point.certainty === "uncertain" ? 4.5 : 3.5} fill="var(--surface)" stroke="var(--primary)" strokeWidth={1.5} /><line x1={x(point.x)} y1={py} x2={label.x} y2={label.y + (py > label.y ? 17 : -17)} stroke="var(--primary)" strokeWidth={0.7} /><rect data-testid="wave-point-label-box" x={label.x - label.width / 2} y={label.y - 17} width={label.width} height={34} rx={3} fill="var(--surface)" /><text x={label.x} y={label.y - 4} textAnchor="middle" fill="var(--foreground)" fontSize={12} fontWeight={600}>{point.label}{point.certainty === "uncertain" ? "?" : ""}</text><text data-testid="wave-point-amplitude" x={label.x} y={label.y + 10} textAnchor="middle" fill="var(--foreground)" fontSize={12}>{pointAmplitude(points, index)}</text></g>;
        })}
        {measurement ? <g data-testid="max-retracement-measurement">
          <line x1={x(measurement.start_x)} x2={measurementX} y1={y(measurement.start_price)} y2={y(measurement.start_price)} stroke="var(--foreground)" strokeWidth={1} strokeDasharray="3 4" />
          <line x1={x(measurement.end_x)} x2={measurementX} y1={y(measurement.end_price)} y2={y(measurement.end_price)} stroke="var(--foreground)" strokeWidth={1} strokeDasharray="3 4" />
          <line data-testid="max-retracement-arrow" x1={measurementX} x2={measurementX} y1={y(measurement.start_price)} y2={y(measurement.end_price)} stroke="var(--foreground)" strokeWidth={1.5} />
          {[Math.min(y(measurement.start_price), y(measurement.end_price)), Math.max(y(measurement.start_price), y(measurement.end_price))].map((py, index) => <polyline key={index} points={`${measurementX - 4},${py + (index ? -6 : 6)} ${measurementX},${py} ${measurementX + 4},${py + (index ? -6 : 6)}`} fill="none" stroke="var(--foreground)" strokeWidth={1.5} />)}
          <text x={measurementX} y={bottom + 20} textAnchor="middle" fill="var(--foreground)" fontSize={12}>幅度</text>
        </g> : null}
        {(minX === maxX ? [minX] : [minX, maxX]).map((value, index) => <text data-testid="time-axis-tick" key={index} x={index ? right : left} y={bottom + 20} textAnchor={index ? "end" : "start"} fill="var(--muted-foreground)" fontSize={12}>{formatX(value, chart.mode)}</text>)}
        <text x={left} y={bottom + 45} fill="var(--muted-foreground)" fontSize={12}>{chart.mode === "ohlc" ? "UTC · 用户提供历史数据" : "结构示意 · 非时间 K 线"}</text>
        <text x={left} y={bottom + 64} fill="var(--foreground)" fontSize={12}>长虚线：候选 · 点线＋?：存疑</text>
        {scenario?.invalidation == null ? null : <text data-testid="invalidation-footer" x={left} y={bottom + 83} fill="var(--destructive)" fontSize={12}>失效位 {String(scenario.invalidation)}</text>}
        {measurement ? <text x={left} y={bottom + (hasInvalidation ? 103 : 83)} fill="var(--foreground)" fontSize={12}>反向幅度 {formatAxisPrice(measurement.amount)}（{formatAxisPrice(measurement.percent)}%）</text> : null}
        <text x={left} y={bottom + (hasInvalidation ? 121 : 101)} fill="var(--muted-foreground)" fontSize={12}>标注点价格幅度，非账户回撤</text>
      </svg>
    </div>
    <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs leading-5 text-muted-foreground" aria-label="图例">
      <span className="flex items-center gap-2"><span aria-hidden className="w-7 border-t-2 border-dashed border-primary" />候选计数（长虚线）</span>
      <span className="flex items-center gap-2"><span aria-hidden className="w-7 border-t-2 border-dotted border-primary" />存疑计数（点线＋?）</span>
      {chart.mode === "ohlc" ? <span>空心：收涨；实心：收跌</span> : null}
    </div>
    {measurement ? <p className="rounded-lg bg-muted p-3 text-sm leading-6"><strong>已标注点最大反向幅度：</strong>{formatPrice(measurement.amount)}（{formatPrice(measurement.percent)}%），从 {formatPrice(measurement.start_price)} 到 {formatPrice(measurement.end_price)}。这是图上标注点之间的价格幅度，<strong>不是账户回撤</strong>，也不是完整行情窗口的最大回撤。</p> : null}
    {measurement && scenario ? <p className="text-sm leading-6 text-muted-foreground"><strong>{scenario.direction === "up" ? "上涨参考阈值（上涨顶 − 幅度）" : "下跌参考阈值（下跌底 ＋ 幅度）"}：</strong>{formatPrice(scenario.direction === "up" ? Math.max(...points.map((point) => point.price)) : Math.min(...points.map((point) => point.price)))} {scenario.direction === "up" ? "−" : "＋"} {formatPrice(measurement.amount)} = {formatPrice(measurement.threshold)}。仅为已标注点的结构参考，不是账户止损价，也不会设置交易风控。</p> : null}
    <div className="flex flex-wrap gap-2"><button type="button" className={`${BUTTON} hover:bg-muted`} disabled={exporting} onClick={() => void exportChart("svg")}>下载 SVG</button><button type="button" className={`${BUTTON} hover:bg-muted`} disabled={exporting} onClick={() => void exportChart("png")}>下载 PNG</button></div>
    <p className="text-xs leading-5 text-muted-foreground">下载在浏览器内生成，不访问外部图床；仅导出当前计数。{exporting ? " 正在生成图片…" : ""}</p>
    {generated ? <div className="grid min-w-0 gap-2 rounded-lg border bg-muted p-3">
      <p role="status" className="text-sm leading-6">已生成 {generated.format.toUpperCase()}。若浏览器未自动下载，请点击保存链接。</p>
      <a href={generated.url} download={`wavekb-wave-analysis.${generated.format}`} className="inline-flex min-h-11 w-fit items-center rounded-lg border bg-surface px-3 py-2 text-sm font-semibold text-primary hover:bg-background focus-visible:ring-2 focus-visible:ring-ring">保存已生成的 {generated.format.toUpperCase()}</a>
      {generated.format === "png" ? <details className="min-w-0 rounded-lg border bg-surface"><summary className="min-h-11 cursor-pointer px-3 py-3 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-ring">预览生成的 PNG</summary><div className="border-t p-2"><NextImage src={generated.url} alt={`${chart.instrument} ${scenario ? SCENARIO_LABELS[scenario.key] : "仅价格"}波浪分析导出预览`} width={generated.width} height={generated.height} unoptimized loading="eager" className="h-auto w-full" /></div></details> : null}
    </div> : null}
    {exportError ? <p role="alert" className="text-sm text-destructive">图片未能导出。请重试 SVG 下载，或保留下方数据表。</p> : null}
  </>;
}

function ChartData({ chart, scenario }: { chart: WaveChart; scenario?: Scenario }) {
  return <details className="min-w-0 rounded-lg border">
    <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-ring">查看图表数据与分段幅度</summary>
    <div className="grid gap-4 border-t p-3">
      {scenario ? <div className="overflow-x-auto"><table className="w-full text-left text-sm tabular-nums"><caption className="mb-2 text-left font-semibold">{SCENARIO_LABELS[scenario.key]} · 标注点与分段价格差</caption><thead><tr><th scope="col" className="p-2">标注</th><th scope="col" className="p-2">{chart.mode === "ohlc" ? "UTC 时间" : "结构点"}</th><th scope="col" className="p-2">价格</th><th scope="col" className="p-2">相邻差值</th><th scope="col" className="p-2">状态</th></tr></thead><tbody>{scenario.points.map((point, index) => <tr key={index} className="border-t"><th scope="row" className="p-2 font-medium">{point.label}</th><td className="p-2">{formatX(point.x, chart.mode)}</td><td className="p-2">{formatPrice(point.price)}</td><td className="p-2">{index ? `${point.price - scenario.points[index - 1].price >= 0 ? "+" : ""}${formatPrice(point.price - scenario.points[index - 1].price)}` : "起点"}</td><td className="p-2">{point.certainty === "uncertain" ? "存疑" : "候选"}</td></tr>)}</tbody></table></div> : <p className="text-sm text-muted-foreground">暂无可展示的浪型计数，不自动用价格枢轴冒充分析结论。</p>}
      {chart.bars.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm tabular-nums"><caption className="mb-2 text-left font-semibold">用户提供的历史价格（UTC，非实时行情）</caption><thead><tr>{["时间", "开", "高", "低", "收"].map((label) => <th key={label} scope="col" className="p-2">{label}</th>)}</tr></thead><tbody>{chart.bars.map((bar) => <tr key={bar.time} className="border-t"><th scope="row" className="p-2 font-medium">{formatX(bar.time, "ohlc")}</th>{[bar.open, bar.high, bar.low, bar.close].map((price, index) => <td key={index} className="p-2">{formatPrice(price)}</td>)}</tr>)}</tbody></table></div> : null}
    </div>
  </details>;
}

export function WaveAnalysisChart({ value }: { value: unknown }) {
  const heading = useId();
  const chart = readChart(value);
  const [selected, setSelected] = useState<Scenario["key"]>("primary");
  const scenario = chart?.scenarios.find((item) => item.key === selected) ?? chart?.scenarios[0];
  if (!chart || (!chart.bars.length && !scenario?.points.length)) return <section className="grid min-w-0 gap-2 rounded-lg border border-dashed p-4" aria-labelledby={heading}><h3 id={heading} className="font-semibold">波浪分析图</h3><p className="text-sm leading-6 text-muted-foreground">暂无可用图表数据。需要提供历史价格或明确的结构锚点；不会凭空生成行情。</p></section>;
  return <section className="grid min-w-0 gap-3 border-t pt-4" aria-labelledby={heading}>
    <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 id={heading} className="font-semibold">波浪分析图</h3><p className="mt-1 break-words text-sm text-muted-foreground">{chart.instrument} · {chart.timeframe} · {scenario?.direction === "down" ? "下行候选" : scenario ? "上行候选" : "仅价格数据"}</p></div><span className="rounded-md border px-2 py-1 text-xs leading-5">{chart.mode === "ohlc" ? "用户提供历史价格" : "结构示意 · 非时间 K 线"}</span></div>
    {chart.scenarios.length > 1 ? <div className="flex flex-wrap gap-2" role="group" aria-label="选择波浪计数">{chart.scenarios.map((item) => <button key={item.key} type="button" aria-pressed={item.key === scenario?.key} className={`${BUTTON} ${item.key === scenario?.key ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"}`} onClick={() => setSelected(item.key)}>{SCENARIO_LABELS[item.key]}</button>)}</div> : null}
    {!scenario ? <p className="text-sm leading-6 text-muted-foreground">暂无浪型计数。仅显示已提供价格，不推断主计数或备选计数。</p> : null}
    <ChartFigure key={JSON.stringify({ chart, scenario: scenario?.key ?? "prices" })} chart={chart} scenario={scenario} />
    <ChartData chart={chart} scenario={scenario} />
  </section>;
}
