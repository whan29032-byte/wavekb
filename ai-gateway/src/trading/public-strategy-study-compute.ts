import {
  TRADE_CHART_INDICATOR_IDS,
  TRADE_CHART_MAX_INDICATORS,
  type IndicatorSpecV1,
  type TradeChartProjection,
} from "@wavekb/domain/trading-review";
import type { Bar } from "openalgo-charts";
import type { ComputedStrategyIndicator } from "./public-chart-projection.ts";

const supported = new Set<string>(TRADE_CHART_INDICATOR_IDS);
const volumeStudies = new Set<string>(["vwap", "obv", "mfi", "chaikin-money-flow"]);
const maxStoredPoints = 192_000;

function unavailableStudy(): Error {
  return Object.assign(new Error("public_strategy_indicator_unavailable"), { statusCode: 422 });
}

function storedDecimal(value: number | null): string | null {
  if (value === null) return null;
  if (!Number.isFinite(value) || Math.abs(value) >= 1e40) throw unavailableStudy();
  if (Math.abs(value) >= 1e21) return BigInt(value).toString();
  const text = value.toFixed(18).replace(/\.?0+$/, "");
  return text === "-0" ? "0" : text;
}

/** Evaluate pinned study definitions over the same candle series shown in the private chart. */
export async function calculatePublicStrategyStudies(
  projection: TradeChartProjection,
  indicators: readonly IndicatorSpecV1[],
): Promise<ComputedStrategyIndicator[]> {
  if (indicators.length === 0) return [];
  if (indicators.length > TRADE_CHART_MAX_INDICATORS) throw unavailableStudy();

  const basis = projection.price_type === "both"
    ? projection.candles.some(({ series_basis }) => series_basis === "bid") ? "bid" : "ask"
    : projection.price_type;
  const source = projection.candles.filter(({ series_basis }) => series_basis === basis);
  if (source.length === 0) throw unavailableStudy();
  const hasVolume = projection.provider !== "exness" && basis === "trade"
    && source.every(({ volume }) => volume !== null && Number.isFinite(Number(volume)))
    && source.some(({ volume }) => Number(volume) > 0);
  const bars: Bar[] = source.map((candle) => {
    const bar = {
      time: Math.floor(Date.parse(candle.open_time) / 1_000),
      open: Number(candle.open), high: Number(candle.high), low: Number(candle.low),
      close: Number(candle.close), ...(candle.volume === null ? {} : { volume: Number(candle.volume) }),
    };
    if (Object.values(bar).some((value) => !Number.isFinite(value))) throw unavailableStudy();
    return bar;
  });
  const [{ BUILTIN_INDICATORS }, { indicatorDefaults }] = await Promise.all([
    import("openalgo-charts/indicators"),
    import("openalgo-charts"),
  ]);
  const registry = new Map(BUILTIN_INDICATORS.map((definition) => [definition.id, definition]));
  const last = source.at(-1)!;
  let storedPointCount = 0;

  return indicators.map((study) => {
    const descriptor = registry.get(study.indicatorId);
    if (!descriptor?.calc || !supported.has(study.indicatorId)
      || (volumeStudies.has(study.indicatorId) && !hasVolume)) throw unavailableStudy();
    storedPointCount += source.length * descriptor.plots.length;
    if (storedPointCount > maxStoredPoints) throw unavailableStudy();

    let values: ReturnType<NonNullable<typeof descriptor.calc>>;
    try {
      values = descriptor.calc(bars, { ...indicatorDefaults(descriptor), ...study.settings }, {}, {
        // Definitions apply any plot displacement before returning aligned values.
        barState: { isNew: false, isConfirmed: last.status === "final", isRealtime: false, lastIndex: bars.length - 1 },
        symbol: projection.symbol,
        interval: projection.timeframe,
        timezone: "UTC",
        now: () => Date.parse(last.close_time) / 1_000,
      });
    } catch {
      throw unavailableStudy();
    }

    return {
      instanceId: study.instanceId,
      series: descriptor.plots.map(({ key }) => {
        const plot = values[key];
        if (!plot || plot.length !== source.length) throw unavailableStudy();
        return { points: source.map(({ open_time }, index) => ({ time: open_time, value: storedDecimal(plot[index] ?? null) })) };
      }),
    };
  });
}
