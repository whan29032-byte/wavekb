import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildWaveChart, type ChartSpec, type WaveChart } from "../../../../ai-gateway/src/research/wave-chart.ts";
import { serializeWaveChartSvg, WaveAnalysisChart } from "./wave-analysis-chart";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const bars = [100, 110, 104, 126, 116, 137].map((close, index) => ({ time: 1_760_000_000 + index * 3600, open: close - 1, high: close + 2, low: close - 2, close }));
const spec: ChartSpec = { scenarios: [
  { key: "primary", direction: "up", points: bars.map((_, bar_index) => ({ bar_index, field: "close", label: String(bar_index) as "0", certainty: bar_index === 2 ? "uncertain" : "candidate" })), invalidation: { bar_index: 0, field: "low" } },
  { key: "alternative_a", direction: "down", points: [1, 2, 3, 4].map((bar_index, index) => ({ bar_index, field: "close", label: ["A", "B", "C", "X"][index] as "A", certainty: "uncertain" })), invalidation: null },
] };
const chart = buildWaveChart({ instrument: "BTCUSDT", primary_timeframe: "1h", step_data: { 0: { chart_data: { schema_version: "wavekb-chart-input-v1", bars } } } }, { step: 0, chartSpec: spec }) as WaveChart;
const structure = buildWaveChart({ instrument: "BTCUSDT", primary_timeframe: "1h", step_data: { 1: { direction: "up", w1_start: 100, w1_end: 110, w2_end: 104, w3_end: 126, w4_end: 116, w5_end: 137 } } }, { step: 1 }) as WaveChart;

describe("controlled wave analysis renderer", () => {
  it("draws only named candidate and uncertain waves, with an accessible chart and table", () => {
    render(<WaveAnalysisChart value={chart} />);
    const image = screen.getByRole("img", { name: "BTCUSDT 波浪分析图：主计数" });
    expect(image.querySelectorAll('[data-testid="candidate-segment"]').length).toBe(3);
    expect(image.querySelectorAll('[data-testid="uncertain-segment"]').length).toBe(2);
    expect(image.querySelector('[data-testid="uncertain-segment"]')?.getAttribute("stroke-dasharray")).toBe("2 5");
    expect(screen.getByText("候选计数（长虚线）")).toBeDefined();
    expect(screen.getByText("存疑计数（点线＋?）")).toBeDefined();
    expect(within(image).getByText("Δ +22")).toBeDefined();
    expect(within(image).getByText("Δ -10")).toBeDefined();
    const labelled = screen.getByRole("table", { name: "主计数 · 标注点与分段价格差" });
    expect(within(labelled).getByText("+22")).toBeDefined();
    expect(within(labelled).getByText("-10")).toBeDefined();
    expect(within(labelled).getByText("存疑")).toBeDefined();
    expect(screen.getByRole("table", { name: "用户提供的历史价格（UTC，非实时行情）" })).toBeDefined();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("measures maximum reverse amplitude with a vertical arrow and two horizontal endpoint references", () => {
    render(<WaveAnalysisChart value={chart} />);
    const arrow = screen.getByTestId("max-retracement-arrow");
    expect(arrow.getAttribute("x1")).toBe(arrow.getAttribute("x2"));
    expect(arrow.getAttribute("y1")).not.toBe(arrow.getAttribute("y2"));
    const references = screen.getByTestId("max-retracement-measurement").querySelectorAll("line:not([data-testid])");
    expect(references).toHaveLength(2);
    for (const reference of references) expect(reference.getAttribute("y1")).toBe(reference.getAttribute("y2"));
    expect(screen.getByText("不是账户回撤")).toBeDefined();
    expect(screen.getByText(/不是完整行情窗口的最大回撤/)).toBeDefined();
    expect(screen.getByText("上涨参考阈值（上涨顶 − 幅度）：")).toBeDefined();
    expect(screen.getByText(/137 − 10 = 127/)).toBeDefined();
  });

  it("switches to a selected alternative without promoting it to confirmed evidence", () => {
    render(<WaveAnalysisChart value={chart} />);
    fireEvent.click(screen.getByRole("button", { name: "备选 A" }));
    expect(screen.getByRole("button", { name: "备选 A" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "主计数" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("img", { name: "BTCUSDT 波浪分析图：备选 A" })).toBeDefined();
    expect(screen.getByRole("table", { name: "备选 A · 标注点与分段价格差" })).toBeDefined();
    expect(screen.getByText(/下行候选/)).toBeDefined();
    expect(screen.getByText("下跌参考阈值（下跌底 ＋ 幅度）：")).toBeDefined();
    expect(screen.queryByText("已确认")).toBeNull();
  });

  it("clearly separates manually supplied structure points from historical time candles", () => {
    render(<WaveAnalysisChart value={structure} />);
    expect(screen.getAllByText("结构示意 · 非时间 K 线")).toHaveLength(2);
    expect(screen.getAllByText("结构点 1").length).toBeGreaterThan(0);
    expect(screen.queryByRole("table", { name: "用户提供的历史价格（UTC，非实时行情）" })).toBeNull();
    expect(screen.getByRole("table", { name: "主计数 · 标注点与分段价格差" })).toBeDefined();
  });

  it("renders supplied prices with no generated wave count when no scenario was provided", () => {
    render(<WaveAnalysisChart value={{ ...chart, scenarios: [] }} />);
    expect(screen.getByRole("img", { name: "BTCUSDT 波浪分析图：暂无计数" })).toBeDefined();
    expect(screen.getByText("暂无浪型计数。仅显示已提供价格，不推断主计数或备选计数。")).toBeDefined();
    expect(screen.queryByTestId("candidate-segment")).toBeNull();
    expect(screen.queryByTestId("max-retracement-arrow")).toBeNull();
  });

  it.each([
    null, undefined, {}, { ...chart, schema_version: "unknown" }, { ...chart, mode: "forecast" },
    { ...chart, instrument: "https://private.example/secret" }, { ...chart, timeframe: "../secret.md" },
    { ...chart, data_origin: "live_bitget" }, { ...chart, local_path: "/Users/private/source.pdf" },
    { ...chart, source_metadata: { title: "PRIVATE_TITLE" } },
    { ...chart, bars: [...chart.bars, { ...chart.bars[0], close: Infinity }] },
    { ...chart, scenarios: [{ ...chart.scenarios[0], points: [{ ...chart.scenarios[0].points[0], label: "PRIVATE_TITLE" }, ...chart.scenarios[0].points.slice(1)] }] },
    { ...chart, scenarios: [{ ...chart.scenarios[0], max_retracement: { ...chart.scenarios[0].max_retracement, amount: 999 } }] },
  ])("fails closed on malformed, unsupported, or private data without echoing it: %j", (value) => {
    render(<WaveAnalysisChart value={value} />);
    expect(screen.getByText(/暂无可用图表数据/)).toBeDefined();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByRole("button", { name: "下载 SVG" })).toBeNull();
    expect(document.body.textContent).not.toMatch(/PRIVATE_TITLE|private\.example|\/Users\/private/);
  });

  it("retains safe responsive width with readable text and no chart animation", () => {
    let resize: ResizeObserverCallback | undefined;
    vi.stubGlobal("ResizeObserver", class { constructor(callback: ResizeObserverCallback) { resize = callback; } observe() {} disconnect() {} });
    render(<WaveAnalysisChart value={chart} />);
    act(() => resize?.([{ contentRect: { width: 327 } } as ResizeObserverEntry], {} as ResizeObserver));
    expect(screen.getByRole("img").getAttribute("viewBox")).toBe("0 0 327 460");
    expect(screen.getByRole("img").querySelector("animate,animateTransform")).toBeNull();
    for (const button of screen.getAllByRole("button")) expect(button.className).toContain("min-h-11");
  });

  it("does not duplicate the time tick when a single historical candle is provided", () => {
    render(<WaveAnalysisChart value={{ ...chart, bars: [chart.bars[0]], scenarios: [] }} />);
    expect(screen.getAllByTestId("time-axis-tick")).toHaveLength(1);
    expect(screen.getByRole("img").innerHTML).not.toMatch(/NaN|Infinity/);
  });

  it.each([300, 375, 960])("keeps the invalidation number in a separate exportable footer below all plotted labels at %ipx", (width) => {
    let resize: ResizeObserverCallback | undefined;
    vi.stubGlobal("ResizeObserver", class { constructor(callback: ResizeObserverCallback) { resize = callback; } observe() {} disconnect() {} });
    render(<WaveAnalysisChart value={chart} />);
    act(() => resize?.([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver));
    const footer = screen.getByTestId("invalidation-footer");
    expect(footer.textContent).toBe("失效位 98");
    expect(Number(footer.getAttribute("y"))).toBe(417);
    for (const box of screen.getAllByTestId("wave-point-label-box")) expect(Number(box.getAttribute("y")) + Number(box.getAttribute("height"))).toBeLessThan(Number(footer.getAttribute("y")));
    const image = screen.getByRole("img");
    expect(image.getAttribute("viewBox")).toBe(`0 0 ${width} 460`);
    for (const text of image.querySelectorAll("text")) expect(Number(text.getAttribute("y"))).toBeLessThan(460);
    expect(Number(footer.getAttribute("x")) + footer.textContent!.length * 12).toBeLessThan(width);
  });

  it("keeps every segment amplitude and twelve clustered label boxes non-overlapping at mobile width with 128 bars", () => {
    let resize: ResizeObserverCallback | undefined;
    vi.stubGlobal("ResizeObserver", class { constructor(callback: ResizeObserverCallback) { resize = callback; } observe() {} disconnect() {} });
    const manyBars = Array.from({ length: 128 }, (_, index) => ({ time: 1_760_000_000 + (index < 127 ? index : 86_400), open: 100 + index % 9, high: 112, low: 98, close: 100 + index % 10 }));
    const denseLabels = ["0", "1", "2", "3", "4", "5", "A", "B", "C", "W", "X", "Y"] as const;
    const chartWithDenseLabels = buildWaveChart({ ...analysisFixture(), step_data: { 0: { chart_data: { schema_version: "wavekb-chart-input-v1", bars: manyBars } } } }, { step: 0, chartSpec: { scenarios: [{ ...spec.scenarios[0], points: manyBars.slice(0, 12).map((_, bar_index) => ({ bar_index, field: "close", label: denseLabels[bar_index], certainty: "uncertain" })), invalidation: null }] } });
    render(<WaveAnalysisChart value={chartWithDenseLabels} />);
    act(() => resize?.([{ contentRect: { width: 295 } } as ResizeObserverEntry], {} as ResizeObserver));
    expect(screen.getAllByTestId("wave-point-amplitude")).toHaveLength(12);
    const boxes = screen.getAllByTestId("wave-point-label-box").map((box) => ({ x: Number(box.getAttribute("x")), y: Number(box.getAttribute("y")), w: Number(box.getAttribute("width")), h: Number(box.getAttribute("height")) }));
    for (let i = 0; i < boxes.length; i++) {
      expect(boxes[i].x).toBeGreaterThanOrEqual(0);
      expect(boxes[i].x + boxes[i].w).toBeLessThanOrEqual(295);
      for (let j = i + 1; j < boxes.length; j++) expect(boxes[i].x + boxes[i].w <= boxes[j].x || boxes[j].x + boxes[j].w <= boxes[i].x || boxes[i].y + boxes[i].h <= boxes[j].y || boxes[j].y + boxes[j].h <= boxes[i].y).toBe(true);
    }
    expect(within(screen.getByRole("table", { name: "用户提供的历史价格（UTC，非实时行情）" })).getAllByRole("row")).toHaveLength(129);
  });
});

function analysisFixture() { return { instrument: "BTCUSDT", primary_timeframe: "1h" }; }

function mockDownloadSupport() {
  let counter = 0;
  const create = vi.fn((blob: Blob) => { void blob; return `blob:synthetic-chart-${++counter}`; });
  const revoke = vi.fn();
  vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: create, revokeObjectURL: revoke }));
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  vi.spyOn(window, "getComputedStyle").mockImplementation(() => ({ getPropertyValue: (name: string) => name === "fill" ? "rgb(255, 255, 255)" : "rgb(24, 33, 44)" }) as CSSStyleDeclaration);
  return { create, revoke };
}

describe("safe browser-only wave image downloads", () => {
  it("serializes a permitted self-contained SVG with actual colors and no private data or external resource", () => {
    mockDownloadSupport();
    render(<WaveAnalysisChart value={chart} />);
    const xml = serializeWaveChartSvg(screen.getByRole("img") as unknown as SVGSVGElement);
    expect(xml).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(xml).toContain('width="640"');
    expect(xml).not.toMatch(/var\(|class=|<script|<image|<foreignObject|href=|url\(/);
    expect(xml).toContain("标注点价格幅度，非账户回撤");
    expect(xml).toContain("Δ +22");
    expect(xml).toContain("Δ -10");
    expect(xml).toContain("失效位 98");
  });

  it("retains a user-saveable SVG link without calling fetch and revokes its URL on unmount", () => {
    const { create, revoke } = mockDownloadSupport();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { unmount } = render(<WaveAnalysisChart value={chart} />);
    fireEvent.click(screen.getByRole("button", { name: "下载 SVG" }));
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("已生成 SVG");
    const link = screen.getByRole("link", { name: "保存已生成的 SVG" });
    expect(link.getAttribute("href")).toBe("blob:synthetic-chart-1");
    expect(link.getAttribute("download")).toBe("wavekb-wave-analysis.svg");
    expect(document.querySelectorAll("a[download]")).toHaveLength(1);
    expect(revoke).not.toHaveBeenCalled();
    unmount();
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:synthetic-chart-1");
  });

  it.each(["script", "image", "foreignObject", "a"])('rejects an injected %s primitive rather than exporting it', (tag) => {
    mockDownloadSupport();
    render(<WaveAnalysisChart value={chart} />);
    const image = screen.getByRole("img") as unknown as SVGSVGElement;
    image.appendChild(document.createElementNS("http://www.w3.org/2000/svg", tag));
    expect(() => serializeWaveChartSvg(image)).toThrow("chart_export_unavailable");
  });

  it("rejects an injected external URL or event handler", () => {
    mockDownloadSupport();
    render(<WaveAnalysisChart value={chart} />);
    const image = screen.getByRole("img") as unknown as SVGSVGElement;
    image.querySelector("line")?.setAttribute("onload", "PRIVATE_SCRIPT");
    expect(() => serializeWaveChartSvg(image)).toThrow("chart_export_unavailable");
  });

  it("reports a generic SVG download failure without exposing exception text", () => {
    const { create } = mockDownloadSupport();
    create.mockImplementation(() => { throw new Error("PRIVATE_CREDENTIAL"); });
    render(<WaveAnalysisChart value={chart} />);
    fireEvent.click(screen.getByRole("button", { name: "下载 SVG" }));
    expect(screen.getByRole("alert").textContent).toContain("图片未能导出");
    expect(document.body.textContent).not.toContain("PRIVATE_CREDENTIAL");
  });

  it("fails PNG image decode safely and revokes the temporary blob URL", async () => {
    const { revoke } = mockDownloadSupport();
    vi.stubGlobal("Image", class { onerror?: () => void; set src(_value: string) { queueMicrotask(() => this.onerror?.()); } });
    render(<WaveAnalysisChart value={chart} />);
    fireEvent.click(screen.getByRole("button", { name: "下载 PNG" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("图片未能导出"));
    expect(revoke).toHaveBeenCalledWith("blob:synthetic-chart-1");
    expect(screen.getByRole("button", { name: "下载 PNG" }).hasAttribute("disabled")).toBe(false);
  });

  it("generates a PNG only from its safe SVG blob and saves the resulting local canvas image", async () => {
    const { create, revoke } = mockDownloadSupport();
    const decodedUrls: string[] = [];
    vi.stubGlobal("Image", class { onload?: () => void; set src(value: string) { decodedUrls.push(value); queueMicrotask(() => this.onload?.()); } });
    const draw = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: draw } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(new Blob(["synthetic bitmap"], { type: "image/png" })));
    const { unmount } = render(<WaveAnalysisChart value={chart} />);
    fireEvent.click(screen.getByRole("button", { name: "下载 PNG" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(decodedUrls).toEqual(["blob:synthetic-chart-1"]);
    expect(create.mock.calls[0][0].type).toBe("image/svg+xml;charset=utf-8");
    expect(create.mock.calls[1][0].type).toBe("image/png");
    expect(draw).toHaveBeenCalledOnce();
    expect(draw.mock.calls[0].slice(1)).toEqual([0, 0, 1280, 920]);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("已生成 PNG");
    expect(screen.getByRole("link", { name: "保存已生成的 PNG" }).getAttribute("href")).toBe("blob:synthetic-chart-2");
    expect(screen.getByText("预览生成的 PNG")).toBeDefined();
    const preview = screen.getByAltText("BTCUSDT 主计数波浪分析导出预览");
    expect(preview.getAttribute("src")).toBe("blob:synthetic-chart-2");
    expect(preview.getAttribute("srcset")).toBeNull();
    expect(preview.getAttribute("width")).toBe("1280");
    expect(preview.getAttribute("height")).toBe("920");
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:synthetic-chart-1");
    unmount();
    expect(revoke).toHaveBeenCalledTimes(2);
    expect(revoke).toHaveBeenLastCalledWith("blob:synthetic-chart-2");
  });

  it("handles unavailable canvas encoding without retaining a decode URL", async () => {
    const { revoke } = mockDownloadSupport();
    vi.stubGlobal("Image", class { onload?: () => void; set src(_value: string) { queueMicrotask(() => this.onload?.()); } });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    render(<WaveAnalysisChart value={chart} />);
    fireEvent.click(screen.getByRole("button", { name: "下载 PNG" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
    expect(revoke).toHaveBeenCalledWith("blob:synthetic-chart-1");
  });

  it("keeps the fallback file available when the browser blocks automatic download", () => {
    mockDownloadSupport();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => { throw new Error("automatic download blocked"); });
    render(<WaveAnalysisChart value={chart} />);
    fireEvent.click(screen.getByRole("button", { name: "下载 SVG" }));
    expect(screen.getByRole("status").textContent).toContain("若浏览器未自动下载");
    expect(screen.getByRole("link", { name: "保存已生成的 SVG" }).getAttribute("href")).toBe("blob:synthetic-chart-1");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("revokes the previous generated URL before a subsequent export", () => {
    const { revoke } = mockDownloadSupport();
    render(<WaveAnalysisChart value={chart} />);
    fireEvent.click(screen.getByRole("button", { name: "下载 SVG" }));
    fireEvent.click(screen.getByRole("button", { name: "下载 SVG" }));
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:synthetic-chart-1");
    expect(screen.getByRole("link", { name: "保存已生成的 SVG" }).getAttribute("href")).toBe("blob:synthetic-chart-2");
  });

  it("removes the old count's download link and revokes its URL when changing scenario", () => {
    const { revoke } = mockDownloadSupport();
    render(<WaveAnalysisChart value={chart} />);
    fireEvent.click(screen.getByRole("button", { name: "下载 SVG" }));
    fireEvent.click(screen.getByRole("button", { name: "备选 A" }));
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:synthetic-chart-1");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("does not retain a generated file when the underlying analysis data changes", () => {
    const { revoke } = mockDownloadSupport();
    const { rerender } = render(<WaveAnalysisChart value={chart} />);
    fireEvent.click(screen.getByRole("button", { name: "下载 SVG" }));
    rerender(<WaveAnalysisChart value={{ ...chart, timeframe: "4h" }} />);
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:synthetic-chart-1");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("releases a pending PNG decode URL without publishing a stale count after switching", async () => {
    const { create, revoke } = mockDownloadSupport();
    let finishDecode: (() => void) | undefined;
    vi.stubGlobal("Image", class { onload?: () => void; set src(_value: string) { finishDecode = () => this.onload?.(); } });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(new Blob(["synthetic bitmap"], { type: "image/png" })));
    render(<WaveAnalysisChart value={chart} />);
    fireEvent.click(screen.getByRole("button", { name: "下载 PNG" }));
    fireEvent.click(screen.getByRole("button", { name: "备选 A" }));
    await act(async () => finishDecode?.());
    expect(create).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:synthetic-chart-1");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("img", { name: "BTCUSDT 波浪分析图：备选 A" })).toBeDefined();
  });
});
