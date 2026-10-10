import assert from "node:assert/strict";
import test from "node:test";
import { assertWaveChart, buildWaveChart, normalizeChartInput, normalizeChartSpec, selectChartInput,
  type ChartInput, type WaveChart } from "../src/research/wave-chart.ts";

function input(prices = [100, 120, 110, 160, 140, 175]): ChartInput {
  return { schema_version: "wavekb-chart-input-v1", bars: prices.map((close, index) => ({ time: 1_710_000_000 + index * 60,
    open: close, high: close + 2, low: close - 2, close })) };
}
function chartSpec(key = "primary", direction = "up") {
  return { scenarios: [{ key, direction, points: Array.from({ length: 6 }, (_, bar_index) => ({ bar_index,
    field: "close", label: String(bar_index), certainty: "candidate" })), invalidation: { bar_index: 0, field: "low" } }] };
}
function analysis(bars: unknown = input()) {
  return { instrument: "BTCUSDT", primary_timeframe: "1h", step_data: { "2": { chart_data: bars }, "3": { notes: "Not a source of prices" } } };
}
function manual(prices: number[] = [100, 120, 110, 160, 140, 175], direction = "up") {
  return Object.fromEntries([["direction", direction], ...["w1_start", "w1_end", "w2_end", "w3_end", "w4_end", "w5_end"]
    .map((key, index) => [key, String(prices[index])])]);
}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

test("OHLC input is bounded, cloned, and requires consistent high/low prices", () => {
  const source = input();
  const normalized = normalizeChartInput(source);
  assert.deepEqual(normalized, source);
  assert.notEqual(normalized, source);
  assert.notEqual(normalized.bars, source.bars);
  assert.notEqual(normalized.bars[0], source.bars[0]);
  source.bars[0]!.close = 0;
  assert.equal(normalized.bars[0]!.close, 100);
  assert.equal(normalizeChartInput(input(Array(128).fill(100))).bars.length, 128);
});

for (const [name, mutate] of [
  ["empty bars", (data: ChartInput) => { data.bars = []; }],
  ["too many bars", (data: ChartInput) => { data.bars = input(Array(129).fill(100)).bars; }],
  ["millisecond timestamps", (data: ChartInput) => { data.bars[0]!.time *= 1000; }],
  ["fractional seconds", (data: ChartInput) => { data.bars[0]!.time += 0.5; }],
  ["same time", (data: ChartInput) => { data.bars[1]!.time = data.bars[0]!.time; }],
  ["backwards time", (data: ChartInput) => { data.bars.reverse(); }],
  ["non-finite price", (data: ChartInput) => { data.bars[0]!.close = Infinity; }],
  ["zero price", (data: ChartInput) => { data.bars[0]!.close = 0; }],
  ["negative price", (data: ChartInput) => { data.bars[0]!.close = -1; }],
  ["oversize price", (data: ChartInput) => { data.bars[0]!.close = 1e12 + 1; }],
  ["invalid high", (data: ChartInput) => { data.bars[0]!.high = 99; }],
  ["invalid low", (data: ChartInput) => { data.bars[0]!.low = 101; }],
] as const) {
  test(`rejects ${name} with a fixed error`, () => {
    const source = input();
    mutate(source);
    assert.throws(() => normalizeChartInput(source), /^Error: wave chart: invalid_chart_input$/);
  });
}

test("rejects additional source, path, URL, script and inherited fields without echoing values", () => {
  for (const raw of [
    { ...input(), source_file: "/Users/private.md" },
    { ...input(), url: "https://private.invalid" },
    { ...input(), script: "alert(1)" },
    { ...input(), bars: [{ ...input().bars[0], source_id: "private" }] },
    { ...input(), schema_version: "other" },
    Object.assign(Object.create({ inherited: "private" }) as object, input()),
  ]) assert.throws(() => normalizeChartInput(raw), /^Error: wave chart: invalid_chart_input$/);
  const accessor = { ...input() };
  Object.defineProperty(accessor, "bars", { get: () => { throw new Error("private source must not be read"); }, enumerable: true });
  assert.throws(() => normalizeChartInput(accessor), /^Error: wave chart: invalid_chart_input$/);
});

test("selects only the latest data at or before the requested step", () => {
  const earlier = input([100, 110]);
  const latest = input([200, 210]);
  const source = { step_data: { "0": { chart_data: earlier }, "4": { chart_data: latest }, "9": { chart_data: "future private" } } };
  assert.deepEqual(selectChartInput(source, 3), earlier);
  assert.deepEqual(selectChartInput(source, 4), latest);
  assert.equal(selectChartInput({ step_data: { "9": { chart_data: latest } } }, 3), null);
  for (const invalid of [null, undefined, { ...latest, source: "private" }]) {
    assert.throws(() => selectChartInput({ step_data: { "0": { chart_data: earlier }, "4": { chart_data: invalid } } }, 4), /invalid_chart_input/);
  }
});

test("chart specs reference real candle fields and accept the bounded fixed label vocabulary", () => {
  const data = input(Array(12).fill(100));
  const spec = { scenarios: [{ key: "alternative_b", direction: "down", points: Array.from({ length: 12 }, (_, bar_index) => ({
    bar_index, field: ["open", "high", "low", "close"][bar_index % 4], label: ["0", "1", "2", "3", "4", "5", "A", "B", "C", "W", "X", "Y"][bar_index], certainty: "uncertain",
  })) }] };
  assert.equal(normalizeChartSpec(spec, data).scenarios[0]!.invalidation, null);
  assert.equal(normalizeChartSpec(spec, data).scenarios[0]!.points.length, 12);
  assert.deepEqual(normalizeChartSpec(chartSpec(), input()), chartSpec());
  assert.deepEqual(normalizeChartSpec({ scenarios: [] }, input()), { scenarios: [] });
  for (const label of ["W", "X", "Y", "Z", "a", "b", "c", "i", "ii", "iii", "iv", "v"]) {
    const labelled = chartSpec();
    labelled.scenarios[0]!.points = labelled.scenarios[0]!.points.slice(0, 2);
    labelled.scenarios[0]!.points[1]!.label = "A";
    labelled.scenarios[0]!.points[0]!.label = label;
    assert.equal(normalizeChartSpec(labelled, input()).scenarios[0]!.points[0]!.label, label);
  }
});

test("rejects invented coordinates, source text, code and unknown spec fields", () => {
  const source = chartSpec();
  const variants = [
    { ...source, description: "private.md" },
    { scenarios: [{ ...source.scenarios[0], source_id: "private" }] },
    { scenarios: [{ ...source.scenarios[0], points: [{ ...source.scenarios[0]!.points[0], price: 999 }, source.scenarios[0]!.points[1]] }] },
    { scenarios: [{ ...source.scenarios[0], points: [{ ...source.scenarios[0]!.points[0], time: 1_710_000_000 }, source.scenarios[0]!.points[1]] }] },
    { scenarios: [{ ...source.scenarios[0], points: [{ ...source.scenarios[0]!.points[0], label: "<script>" }, source.scenarios[0]!.points[1]] }] },
    { scenarios: [{ ...source.scenarios[0], points: [{ ...source.scenarios[0]!.points[0], certainty: "confirmed" }, source.scenarios[0]!.points[1]] }] },
    { scenarios: [{ ...source.scenarios[0], invalidation: { price: 10 } }] },
    { scenarios: [{ ...source.scenarios[0], direction: "neutral" }] },
    { scenarios: [{ ...source.scenarios[0], key: "https://private.invalid" }] },
    { scenarios: [source.scenarios[0], source.scenarios[0]] },
  ];
  for (const variant of variants) assert.throws(() => normalizeChartSpec(variant, input()), /^Error: wave chart: invalid bounded data$/);
});

test("never guesses an intrabar high-low order or out-of-range candle", () => {
  for (const indices of [[0, 0], [1, 0], [0, 6], [-1, 1], [0, 1.5]]) {
    const spec = { scenarios: [{ key: "primary", direction: "up", points: indices.map((bar_index, position) => ({
      bar_index, field: position === 0 ? "high" : "low", label: String(position), certainty: "candidate",
    })) }] };
    assert.throws(() => normalizeChartSpec(spec, input()), /invalid bounded data/);
  }
  assert.throws(() => normalizeChartSpec({ scenarios: [{ key: "primary", direction: "up", points: [chartSpec().scenarios[0]!.points[0]] }] }, input()), /invalid bounded data/);
  assert.throws(() => normalizeChartSpec({ scenarios: [{ key: "primary", direction: "up", points: Array.from({ length: 13 }, (_, bar_index) => ({
    bar_index, field: "close", label: "1", certainty: "candidate",
  })) }] }, input(Array(13).fill(100))), /invalid bounded data/);
  assert.throws(() => normalizeChartSpec({ scenarios: Array(4).fill(chartSpec().scenarios[0]) }, input()), /invalid bounded data/);
});

test("OHLC drawing maps only supplied prices and times, plus a computed rising retracement", () => {
  const chart = buildWaveChart(analysis(), { step: 3, chartSpec: chartSpec() })!;
  assertWaveChart(chart);
  assert.equal(chart.mode, "ohlc");
  assert.equal(chart.data_origin, "user_input");
  assert.deepEqual(chart.scenarios[0]!.points.map(({ x, price }) => ({ x, price })), input().bars.map(({ time: x, close: price }) => ({ x, price })));
  assert.equal(chart.scenarios[0]!.invalidation, 98);
  assert.deepEqual(chart.scenarios[0]!.max_retracement, {
    start_x: 1_710_000_180, end_x: 1_710_000_240, start_price: 160, end_price: 140, amount: 20, percent: 12.5, threshold: 155,
  });
});

test("falling retracement measures a valley to a later higher point", () => {
  const bars = input([200, 180, 190, 140, 160, 120]);
  const chart = buildWaveChart(analysis(bars), { step: 3, chartSpec: chartSpec("primary", "down") })!;
  assert.deepEqual(chart.scenarios[0]!.max_retracement, {
    start_x: 1_710_000_180, end_x: 1_710_000_240, start_price: 140, end_price: 160, amount: 20, percent: (20 / 140) * 100, threshold: 140,
  });
});

test("prices without a spec produce no invented wave lines or pivots", () => {
  const chart = buildWaveChart(analysis(), { step: 3 })!;
  assert.equal(chart.bars.length, 6);
  assert.deepEqual(chart.scenarios, []);
  assertWaveChart(chart);
  const single = buildWaveChart(analysis(input([100])), { step: 3 })!;
  assert.equal(single.bars.length, 1);
});

test("manual prices remain an explicitly timeless structure diagram, all candidate", () => {
  const chart = buildWaveChart({ instrument: "SPX", primary_timeframe: "4h", step_data: { "6": manual() } }, { step: 6 })!;
  assert.equal(chart.mode, "structure");
  assert.equal(chart.data_origin, "user_input");
  assert.deepEqual(chart.bars, []);
  assert.deepEqual(chart.scenarios[0]!.points.map((point) => [point.x, point.price, point.label, point.certainty]), [
    [0, 100, "0", "candidate"], [1, 120, "1", "candidate"], [2, 110, "2", "candidate"],
    [3, 160, "3", "candidate"], [4, 140, "4", "candidate"], [5, 175, "5", "candidate"],
  ]);
  assert.deepEqual(chart.scenarios[0]!.max_retracement, { start_x: 3, end_x: 4, start_price: 160, end_price: 140, amount: 20, percent: 12.5, threshold: 155 });
});

test("manual primary and alternatives use their latest entered values and never future steps", () => {
  const source = { instrument: "沪深300", primary_timeframe: "日线", step_data: {
    "5": { primary: manual(), alternative_a: manual([200, 180, 190, 140, 160, 120], "down") },
    "6": { primary: manual([110, 130, 120, 180, 160, 195]) },
    "8": { alternative_b: manual() },
  } };
  const chart = buildWaveChart(source, { step: 6 })!;
  assert.deepEqual(chart.scenarios.map((scenario) => scenario.key), ["primary", "alternative_a"]);
  assert.equal(chart.scenarios[0]!.points[0]!.price, 110);
  assert.equal(chart.scenarios[1]!.direction, "down");
  assert.equal(chart.scenarios[1]!.max_retracement!.threshold, 140);
});

test("missing anchors are not bridged, missing data is not given fallback prices", () => {
  assert.equal(buildWaveChart({}, { step: 3 }), null);
  assert.equal(buildWaveChart({ step_data: { "7": manual() } }, { step: 6 }), null);
  assert.equal(buildWaveChart({ step_data: { "6": { direction: "up", w1_start: "", w1_end: "120" } } }, { step: 6 }), null);
  assert.equal(buildWaveChart({ step_data: { "6": { w1_start: 100, w1_end: 120 } } }, { step: 6 }), null);
  const chart = buildWaveChart({ step_data: { "6": { direction: "up", w1_start: 100, w1_end: 120, w3_end: 160 } } }, { step: 6 })!;
  assert.equal(chart.scenarios[0]!.points.length, 2);
  assert.equal(chart.scenarios[0]!.max_retracement, null);
  assert.throws(() => buildWaveChart({ step_data: { "6": manual() } }, { step: 6, chartSpec: chartSpec() }), /invalid bounded data/);
});

test("rule-blocked scenarios are absent from both OHLC and structure drawings", () => {
  const spec = { scenarios: [chartSpec().scenarios[0], chartSpec("alternative_a").scenarios[0]] };
  const chart = buildWaveChart(analysis(), { step: 3, chartSpec: spec, blockedScenarioKeys: ["primary"] })!;
  assert.deepEqual(chart.scenarios.map((scenario) => scenario.key), ["alternative_a"]);
  const structured = { step_data: { "6": { primary: manual(), alternative_a: manual() } } };
  assert.deepEqual(buildWaveChart(structured, { step: 6, blockedScenarioKeys: ["primary"] })!.scenarios.map((scenario) => scenario.key), ["alternative_a"]);
  assert.equal(buildWaveChart(structured, { step: 6, blockedScenarioKeys: ["primary", "alternative_a"] }), null);
});

test("monotonic labelled paths report no observed counter-move", () => {
  for (const [prices, direction] of [[[100, 110, 120, 130, 140, 150], "up"], [[200, 190, 180, 170, 160, 150], "down"]] as const) {
    const chart = buildWaveChart(analysis(input([...prices])), { step: 3, chartSpec: chartSpec("primary", direction) })!;
    assert.equal(chart.scenarios[0]!.max_retracement, null);
  }
});

test("drawing text is a bounded instrument/timeframe, not a route to private sources or executable HTML", () => {
  for (const instrument of ["https://private.invalid", "/Users/private", "private.md", "<svg onload=alert(1)>", "BTC\u202eUSDT", "B".repeat(65), "source_id", "foo..bar", "JAVASCRIPT:ALERT", "private/book", "PRIVATE/BOOK", "FILE:README", "HTTPS:EXAMPLE", "HERMeS private book"]) {
    assert.throws(() => buildWaveChart({ ...analysis(), instrument }, { step: 3 }), /invalid bounded data/);
  }
  for (const step of [-1, 1.5, Infinity, 33]) assert.throws(() => buildWaveChart(analysis(), { step }), /invalid bounded data/);
});

test("real exchange symbols, currency pairs and futures notation are safe short display text", () => {
  for (const instrument of ["BINANCE:BTCUSDT", "BTC/USDT", "COMEX:GC1!", "CME_MINI:ES1!", "BINANCE:BTC/USDT", "沪深300", "BRK.B"]) {
    const chart = buildWaveChart({ ...analysis(), instrument, primary_timeframe: "4H" }, { step: 3 })!;
    assert.equal(chart.instrument, instrument);
    assert.equal(chart.timeframe, "4H");
    assertWaveChart(chart);
  }
});

test("public object rejects extra fields, malformed bars, fake times, arbitrary prices and confirmed claims", () => {
  const source = buildWaveChart(analysis(), { step: 3, chartSpec: chartSpec() })!;
  const variants: unknown[] = [
    { ...source, source_path: "/Users/private" }, { ...source, schema_version: "old" }, { ...source, data_origin: "live_market" },
    { ...source, instrument: "private.pdf" }, { ...source, mode: "structure" },
    { ...source, scenarios: [{ ...source.scenarios[0], source_id: "private" }] },
  ];
  for (const mutate of [
    (chart: WaveChart) => { chart.bars[0]!.low = 999; },
    (chart: WaveChart) => { chart.scenarios[0]!.points[0]!.price = 999; },
    (chart: WaveChart) => { chart.scenarios[0]!.points[0]!.x += 1; },
    (chart: WaveChart) => { chart.scenarios[0]!.points[1]!.x = chart.scenarios[0]!.points[0]!.x; },
    (chart: WaveChart) => { chart.scenarios[0]!.invalidation = 999; },
    (chart: WaveChart) => { chart.scenarios[0]!.points[0]!.certainty = "confirmed" as "candidate"; },
    (chart: WaveChart) => { chart.scenarios[0]!.points[0]!.label = "private.md" as "0"; },
  ]) { const value = copy(source); mutate(value); variants.push(value); }
  for (const value of variants) assert.throws(() => assertWaveChart(value), /invalid bounded data/);
});

test("every reported retracement field is recomputed, not trusted from a model or edited payload", () => {
  const source = buildWaveChart(analysis(), { step: 3, chartSpec: chartSpec() })!;
  for (const field of ["start_x", "end_x", "start_price", "end_price", "amount", "percent", "threshold"] as const) {
    const value = copy(source);
    value.scenarios[0]!.max_retracement![field] += 1;
    assert.throws(() => assertWaveChart(value), /invalid bounded data/);
  }
  const missing = copy(source); missing.scenarios[0]!.max_retracement = null;
  assert.throws(() => assertWaveChart(missing), /invalid bounded data/);
  const extra = copy(source) as WaveChart & { private?: string };
  Object.assign(extra.scenarios[0]!.max_retracement!, { source: "private" });
  assert.throws(() => assertWaveChart(extra), /invalid bounded data/);
});

test("structure validation rejects fabricated time axes, bars or invalidation levels", () => {
  const source = buildWaveChart({ step_data: { "6": manual() } }, { step: 6 })!;
  for (const mutate of [
    (chart: WaveChart) => { chart.scenarios[0]!.points[0]!.x = 1_710_000_000; },
    (chart: WaveChart) => { chart.bars = input().bars; },
    (chart: WaveChart) => { chart.scenarios[0]!.invalidation = 80; },
    (chart: WaveChart) => { chart.scenarios = []; },
  ]) { const value = copy(source); mutate(value); assert.throws(() => assertWaveChart(value), /invalid bounded data/); }
});

test("unsafe measurement overflow or cancellation is refused, never repaired with an invented threshold", () => {
  assert.throws(() => buildWaveChart({ step_data: { "6": { direction: "up", w1_start: 1e12, w1_end: 1e-8 } } }, { step: 6 }), /invalid bounded data/);
  assert.throws(() => buildWaveChart({ step_data: { "6": { direction: "down", w1_start: Number.MIN_VALUE, w1_end: 1 } } }, { step: 6 }), /invalid bounded data/);
});
