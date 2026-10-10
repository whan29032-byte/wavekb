/** Browser-safe, data-only wave drawing. No tools, network calls, or source metadata. */
export type ChartBar = { time: number; open: number; high: number; low: number; close: number };
export type ChartInput = { schema_version: "wavekb-chart-input-v1"; bars: ChartBar[] };
export type ScenarioKey = "primary" | "alternative_a" | "alternative_b";
export type ChartField = "open" | "high" | "low" | "close";
export type WaveLabel = "0" | "1" | "2" | "3" | "4" | "5" | "A" | "B" | "C" | "W" | "X" | "Y" | "Z" | "a" | "b" | "c" | "i" | "ii" | "iii" | "iv" | "v";
export type ChartPointSpec = { bar_index: number; field: ChartField; label: WaveLabel; certainty: "candidate" | "uncertain" };
export type ChartScenarioSpec = { key: ScenarioKey; direction: "up" | "down"; points: ChartPointSpec[]; invalidation: { bar_index: number; field: ChartField } | null };
export type ChartSpec = { scenarios: ChartScenarioSpec[] };
export type WavePoint = { x: number; price: number; label: WaveLabel; certainty: "candidate" | "uncertain" };
export type RetracementMeasurement = { start_x: number; end_x: number; start_price: number; end_price: number; amount: number; percent: number; threshold: number };
export type WaveChartScenario = { key: ScenarioKey; direction: "up" | "down"; points: WavePoint[]; invalidation: number | null; max_retracement: RetracementMeasurement | null };
export type WaveChart = {
  schema_version: "wavekb-wave-chart-v1";
  mode: "ohlc" | "structure";
  instrument: string;
  timeframe: string;
  data_origin: "user_input";
  bars: ChartBar[];
  scenarios: WaveChartScenario[];
};

const MAX_BARS = 128;
const MAX_PRICE = 1e12;
// Seconds, not current millisecond timestamps; far beyond the supported chart horizon.
const MAX_TIME = 1e10;
const KEYS = ["primary", "alternative_a", "alternative_b"] as const;
const FIELDS = ["open", "high", "low", "close"] as const;
const LABELS = ["0", "1", "2", "3", "4", "5", "A", "B", "C", "W", "X", "Y", "Z", "a", "b", "c", "i", "ii", "iii", "iv", "v"] as const;
const MINOR_LABELS = ["i", "ii", "iii", "iv", "v"] as const;
const MANUAL_FIELDS = ["w1_start", "w1_end", "w2_end", "w3_end", "w4_end", "w5_end"] as const;

function fail(): never { throw new Error("wave chart: invalid bounded data"); }
function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function object(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!record(value)) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string" || ![...required, ...optional].includes(key))
    || required.some((key) => !Object.hasOwn(value, key))
    || keys.some((key) => !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, "value"))) fail();
  return value;
}
function price(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > MAX_PRICE) fail();
  return value;
}
function time(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > MAX_TIME) fail();
  return value;
}
function oneOf<T extends string>(value: unknown, options: readonly T[]): T {
  if (typeof value !== "string" || !options.includes(value as T)) fail();
  return value as T;
}
/** One explicit impulse degree per scenario; nested degrees need a separate contract. */
function assertImpulseLabels(points: readonly { label: WaveLabel }[]): void {
  let numeric = -1;
  let minor = -1;
  for (const { label } of points) {
    if (/^[0-5]$/u.test(label)) {
      if (Number(label) <= numeric || (label === "0" && minor >= 0)) fail();
      numeric = Number(label);
    }
    const order = MINOR_LABELS.indexOf(label as typeof MINOR_LABELS[number]);
    if (order >= 0) {
      if (order <= minor) fail();
      minor = order;
    }
  }
  if (numeric > 0 && minor >= 0) fail();
}
function index(value: unknown, length: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value >= length || Object.is(value, -0)) fail();
  return value;
}
function shortText(value: unknown, maximum: number, instrument = false): string {
  if (typeof value !== "string" || value.length > maximum || value !== value.normalize("NFKC")
    || !(/^[\p{L}\p{N}][\p{L}\p{N} _.-]*$/u.test(value)
      || (instrument && /^(?:[A-Z][A-Z0-9_-]{0,15}:)?[A-Z0-9][A-Z0-9_.!-]*(?:\/[A-Z0-9][A-Z0-9_.-]*)?$/.test(value)))
    || /(?:\.\.|\.(?:md|pdf|txt|json|csv|html?|js|ts|py|png|jpe?g|webp|yaml|yml|env|log)\b|(?:https?|file|javascript|vbscript|data|ftp|socks5?)[ _:.-]|(?:source|file|path)[ _.-]?id|(?:^|[ _:./-])(?:private|source|knowledge|research|hermes|memory|user)(?:$|[ _:./-]))/i.test(value)) fail();
  return value;
}
function copiedBars(value: unknown, allowEmpty = false): ChartBar[] {
  if (!Array.isArray(value) || value.length > MAX_BARS || (!allowEmpty && value.length === 0)) fail();
  let previous = 0;
  return value.map((raw) => {
    const bar = object(raw, ["time", ...FIELDS]);
    const current = { time: time(bar.time), open: price(bar.open), high: price(bar.high), low: price(bar.low), close: price(bar.close) };
    if (current.time <= previous || current.low > Math.min(current.open, current.close)
      || current.high < Math.max(current.open, current.close) || current.high < current.low) fail();
    previous = current.time;
    return current;
  });
}

export function normalizeChartInput(value: unknown): ChartInput {
  try {
    const input = object(value, ["schema_version", "bars"]);
    if (input.schema_version !== "wavekb-chart-input-v1") fail();
    return { schema_version: "wavekb-chart-input-v1", bars: copiedBars(input.bars) };
  } catch {
    throw new Error("wave chart: invalid_chart_input");
  }
}

export function selectChartInput(analysis: unknown, step: number, options: { requireContext?: boolean } = {}): ChartInput | null {
  if (!record(analysis) || !Number.isSafeInteger(step) || step < 0 || step > 32) fail();
  const steps = record(analysis.step_data) ? analysis.step_data : {};
  let found = false;
  let latest: unknown;
  let latestContext: unknown;
  for (let currentStep = 0; currentStep <= step; currentStep++) {
    const current = steps[String(currentStep)];
    if (record(current) && Object.hasOwn(current, "chart_data")) { found = true; latest = current.chart_data; latestContext = current.chart_context; }
  }
  // Never fall back to a different, older dataset after a malformed latest input.
  if (!found) return null;
  try {
    if (latestContext !== undefined || options.requireContext) {
      const context = object(latestContext, ["schema_version", "instrument", "timeframe"]);
      if (context.schema_version !== "wavekb-chart-context-v1"
        || shortText(context.instrument, 64, true) !== analysis.instrument
        || shortText(context.timeframe, 32) !== analysis.primary_timeframe) fail();
    }
    return normalizeChartInput(latest);
  } catch { throw new Error("wave chart: invalid_chart_input"); }
}

export function normalizeChartSpec(value: unknown, input: ChartInput): ChartSpec {
  const bars = normalizeChartInput(input).bars;
  const spec = object(value, ["scenarios"]);
  if (!Array.isArray(spec.scenarios) || spec.scenarios.length > 3) fail();
  const seen = new Set<ScenarioKey>();
  return { scenarios: spec.scenarios.map((raw): ChartScenarioSpec => {
    const scenario = object(raw, ["key", "direction", "points"], ["invalidation"]);
    const key = oneOf(scenario.key, KEYS);
    if (seen.has(key)) fail();
    seen.add(key);
    const direction = oneOf(scenario.direction, ["up", "down"] as const);
    if (!Array.isArray(scenario.points) || scenario.points.length < 2 || scenario.points.length > 12) fail();
    let previous = -1;
    const points = scenario.points.map((rawPoint): ChartPointSpec => {
      const point = object(rawPoint, ["bar_index", "field", "label", "certainty"]);
      const bar_index = index(point.bar_index, bars.length);
      // A candle does not reveal whether its high or low happened first.
      if (bar_index <= previous) fail();
      previous = bar_index;
      const label = oneOf(point.label, LABELS);
      return { bar_index, field: oneOf(point.field, FIELDS), label,
        certainty: oneOf(point.certainty, ["candidate", "uncertain"] as const) };
    });
    assertImpulseLabels(points);
    let invalidation: ChartScenarioSpec["invalidation"] = null;
    if (scenario.invalidation !== undefined && scenario.invalidation !== null) {
      const anchor = object(scenario.invalidation, ["bar_index", "field"]);
      invalidation = { bar_index: index(anchor.bar_index, bars.length), field: oneOf(anchor.field, FIELDS) };
    }
    return { key, direction, points, invalidation };
  }) };
}

/** Price retracement between labelled points, not an account drawdown or intrabar proof. */
function measurement(points: readonly WavePoint[], direction: "up" | "down"): RetracementMeasurement | null {
  let extreme = points[0]!;
  let start: WavePoint | null = null;
  let end: WavePoint | null = null;
  let amount = 0;
  let overallExtreme = extreme.price;
  for (const point of points.slice(1)) {
    overallExtreme = direction === "up" ? Math.max(overallExtreme, point.price) : Math.min(overallExtreme, point.price);
    const reverse = direction === "up" ? extreme.price - point.price : point.price - extreme.price;
    if (reverse > amount) { amount = reverse; start = extreme; end = point; }
    if ((direction === "up" && point.price > extreme.price) || (direction === "down" && point.price < extreme.price)) extreme = point;
  }
  if (!start || !end) return null;
  const percent = (amount / start.price) * 100;
  const threshold = direction === "up" ? overallExtreme - amount : overallExtreme + amount;
  if (!Number.isFinite(percent) || percent <= 0 || !Number.isFinite(threshold) || threshold <= 0 || threshold > MAX_PRICE) fail();
  return { start_x: start.x, end_x: end.x, start_price: start.price, end_price: end.price, amount, percent, threshold };
}

function manualPrice(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 && value <= MAX_PRICE ? value : null;
  if (typeof value !== "string" || value.length > 64 || !/^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
  const number = Number(value.trim());
  return Number.isFinite(number) && number > 0 && number <= MAX_PRICE ? number : null;
}
function manualScenario(raw: Record<string, unknown>, key: ScenarioKey): WaveChartScenario | null {
  if (raw.direction !== "up" && raw.direction !== "down") return null;
  const points: WavePoint[] = [];
  for (const [x, field] of MANUAL_FIELDS.entries()) {
    const value = manualPrice(raw[field]);
    if (value === null) break; // Never bridge a missing wave anchor.
    points.push({ x, price: value, label: String(x) as WaveLabel, certainty: "candidate" });
  }
  if (points.length < 2) return null;
  return { key, direction: raw.direction, points, invalidation: null, max_retracement: measurement(points, raw.direction) };
}

export function buildWaveChart(analysis: Record<string, unknown>, options: {
  step: number; chartSpec?: unknown; blockedScenarioKeys?: readonly string[];
}): WaveChart | null {
  if (!record(analysis) || !Number.isSafeInteger(options.step) || options.step < 0 || options.step > 32) fail();
  if (options.blockedScenarioKeys !== undefined && (!Array.isArray(options.blockedScenarioKeys)
    || options.blockedScenarioKeys.length > 20 || options.blockedScenarioKeys.some((key) => typeof key !== "string" || key.length > 120))) fail();
  const blocked = new Set(options.blockedScenarioKeys ?? []);
  const steps = record(analysis.step_data) ? analysis.step_data : {};
  const selectedInput = selectChartInput(analysis, options.step);
  const manual = new Map<ScenarioKey, Record<string, unknown>>();
  for (let step = 0; step <= options.step; step++) {
    const current = steps[String(step)];
    if (!record(current)) continue;
    if (MANUAL_FIELDS.some((field) => Object.hasOwn(current, field))) manual.set("primary", current);
    for (const key of KEYS) {
      if (record(current[key]) && MANUAL_FIELDS.some((field) => Object.hasOwn(current[key] as object, field))) manual.set(key, current[key] as Record<string, unknown>);
    }
  }
  let chart: WaveChart;
  const instrument = shortText(analysis.instrument ?? "未指定标的", 64, true);
  const timeframe = shortText(analysis.primary_timeframe ?? "未指定周期", 32);
  if (selectedInput !== null) {
    const input = selectedInput;
    const spec = options.chartSpec === undefined ? { scenarios: [] } : normalizeChartSpec(options.chartSpec, input);
    chart = { schema_version: "wavekb-wave-chart-v1", mode: "ohlc", instrument, timeframe, data_origin: "user_input", bars: input.bars,
      scenarios: spec.scenarios.filter((scenario) => !blocked.has(scenario.key)).map((scenario) => {
        const points = scenario.points.map((point): WavePoint => ({ x: input.bars[point.bar_index]!.time,
          price: input.bars[point.bar_index]![point.field], label: point.label, certainty: point.certainty }));
        return { key: scenario.key, direction: scenario.direction, points,
          invalidation: scenario.invalidation ? input.bars[scenario.invalidation.bar_index]![scenario.invalidation.field] : null,
          max_retracement: measurement(points, scenario.direction) };
      }) };
  } else {
    if (options.chartSpec !== undefined) fail();
    const scenarios = KEYS.filter((key) => manual.has(key) && !blocked.has(key))
      .map((key) => manualScenario(manual.get(key)!, key)).filter((value): value is WaveChartScenario => value !== null);
    if (scenarios.length === 0) return null;
    chart = { schema_version: "wavekb-wave-chart-v1", mode: "structure", instrument, timeframe, data_origin: "user_input", bars: [], scenarios };
  }
  assertWaveChart(chart);
  return chart;
}

export function assertWaveChart(value: unknown): asserts value is WaveChart {
  const chart = object(value, ["schema_version", "mode", "instrument", "timeframe", "data_origin", "bars", "scenarios"]);
  if (chart.schema_version !== "wavekb-wave-chart-v1" || chart.data_origin !== "user_input") fail();
  const mode = oneOf(chart.mode, ["ohlc", "structure"] as const);
  shortText(chart.instrument, 64, true);
  shortText(chart.timeframe, 32);
  const bars = copiedBars(chart.bars, mode === "structure");
  if (mode === "structure" && bars.length !== 0) fail();
  if (!Array.isArray(chart.scenarios) || chart.scenarios.length > 3 || (mode === "structure" && chart.scenarios.length === 0)) fail();
  const seen = new Set<ScenarioKey>();
  for (const raw of chart.scenarios) {
    const scenario = object(raw, ["key", "direction", "points", "invalidation", "max_retracement"]);
    const key = oneOf(scenario.key, KEYS);
    if (seen.has(key)) fail();
    seen.add(key);
    const direction = oneOf(scenario.direction, ["up", "down"] as const);
    if (!Array.isArray(scenario.points) || scenario.points.length < 2 || scenario.points.length > 12) fail();
    let previous = -1;
    const points = scenario.points.map((rawPoint): WavePoint => {
      const point = object(rawPoint, ["x", "price", "label", "certainty"]);
      const x = mode === "ohlc" ? time(point.x) : index(point.x, 12);
      const value = price(point.price);
      if (x <= previous) fail();
      previous = x;
      if (mode === "ohlc" && !bars.some((bar) => bar.time === x && FIELDS.some((field) => bar[field] === value))) fail();
      const label = oneOf(point.label, LABELS);
      return { x, price: value, label, certainty: oneOf(point.certainty, ["candidate", "uncertain"] as const) };
    });
    assertImpulseLabels(points);
    if (scenario.invalidation !== null) {
      const level = price(scenario.invalidation);
      if (mode === "structure" || !bars.some((bar) => FIELDS.some((field) => bar[field] === level))) fail();
    }
    const expected = measurement(points, direction);
    if (expected === null) {
      if (scenario.max_retracement !== null) fail();
    } else {
      const actual = object(scenario.max_retracement, Object.keys(expected));
      if (Object.entries(expected).some(([field, number]) => actual[field] !== number)) fail();
    }
  }
}
