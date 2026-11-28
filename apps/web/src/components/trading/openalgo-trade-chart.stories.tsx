import type { FillMarker, TradeChartProjection } from "@wavekb/domain/trading-review";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { getTradeChart } from "@/lib/trading/workbench-repository";

import { OpenAlgoTradeChart } from "./openalgo-trade-chart";

const baseTime = Date.parse("2026-11-01T00:00:00.000Z");

function iso(offsetMinutes: number, offsetSeconds = 0) {
  return new Date(baseTime + offsetMinutes * 60_000 + offsetSeconds * 1_000).toISOString();
}

function marker(
  index: number,
  minute: number,
  allocationRole: FillMarker["allocation_role"],
  side: FillMarker["side"],
  positionSide: FillMarker["position_side"],
): FillMarker {
  return {
    marker_key: `story:${index}`,
    fill_id: `fill-${index}`,
    occurred_at: iso(minute, 10 + (index % 40)),
    price: String(70_000 + minute * 8 + index / 10),
    allocated_quantity: String((index + 1) / 1_000),
    allocation_role: allocationRole,
    sort_order: index,
    side,
    position_side: positionSide,
    liquidity: index % 2 === 0 ? "maker" : "taker",
    provider_fill_id_mask: `••••${String(index).padStart(4, "0")}`,
    annotation: null,
  };
}

function projection(
  markers: FillMarker[],
  options: { direction?: "long" | "short"; missingCandles?: boolean } = {},
): TradeChartProjection {
  const missing = new Set(options.missingCandles ? [5, 6, 7] : []);
  const candles = Array.from({ length: 16 }, (_, index) => index)
    .filter((index) => !missing.has(index))
    .map((index) => ({
      provider: "binance" as const,
      product: "usdt_perpetual" as const,
      native_symbol: "BTCUSDT",
      normalized_symbol: "BTCUSDT",
      timeframe: "1m" as const,
      series_basis: "trade" as const,
      open_time: iso(index),
      close_time: iso(index + 1),
      open: String(70_000 + index * 8),
      high: String(70_018 + index * 8),
      low: String(69_985 + index * 8),
      close: String(70_006 + index * 8),
      volume: String(120 + index),
      source: "public_api" as const,
      source_timestamp: iso(index + 1),
      fetched_at: iso(17),
      status: "final" as const,
      gap_before: options.missingCandles === true && index === 8,
      gap_after: options.missingCandles === true && index === 4,
    }));
  return {
    schema_version: "wavekb-trade-chart-projection-v1",
    cycle_id: "11111111-1111-4111-8111-111111111111",
    cycle_revision: 1,
    provider: "binance",
    product: "usdt_perpetual",
    symbol: "BTCUSDT",
    native_symbol: "BTCUSDT",
    direction: options.direction ?? "long",
    opened_at: iso(1),
    closed_at: iso(14),
    timeframe: "1m",
    price_type: "trade",
    range: { from: iso(0), to: iso(16) },
    candles,
    markers,
    chart_state: null,
    coverage: {
      status: options.missingCandles ? "gapped" : "complete",
      source: "public_api",
      fetched_at: iso(17),
      gaps: options.missingCandles ? [{ series_basis: "trade", from: iso(5), to: iso(8) }] : [],
      unavailable_reason: null,
    },
    warnings: options.missingCandles ? ["historical_gap"] : [],
  };
}

const longMarkers = [
  marker(1, 1, "open", "buy", "long"),
  marker(2, 3, "add", "buy", "long"),
  marker(3, 10, "reduce", "sell", "long"),
  marker(4, 14, "close", "sell", "long"),
];

const shortMarkers = [
  marker(11, 1, "open", "sell", "short"),
  marker(12, 4, "add", "sell", "short"),
  marker(13, 11, "reduce", "buy", "short"),
  marker(14, 14, "close", "buy", "short"),
];

const meta = {
  title: "Workbench/Trade chart/Fill level",
  component: OpenAlgoTradeChart,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <main className="mx-auto min-h-screen max-w-7xl bg-background p-4 text-foreground md:p-8"><Story /></main>],
} satisfies Meta<typeof OpenAlgoTradeChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DenseFills: Story = {
  name: "密集成交",
  args: {
    projection: projection(Array.from({ length: 20 }, (_, index) => marker(
      100 + index,
      index < 8 ? 4 : 9 + (index % 2),
      index === 0 ? "open" : index === 19 ? "close" : index % 3 === 0 ? "reduce" : "add",
      index === 19 || index % 3 === 0 ? "sell" : "buy",
      "long",
    ))),
  },
};

export const LongPosition: Story = {
  name: "多头周期",
  args: { projection: projection(longMarkers) },
};

export const ShortPosition: Story = {
  name: "空头周期",
  args: { projection: projection(shortMarkers, { direction: "short" }) },
};

export const Reversal: Story = {
  name: "反手成交",
  args: {
    projection: projection([
      marker(201, 1, "open", "buy", "long"),
      marker(202, 8, "close", "sell", "long"),
      marker(203, 8, "reverse_open", "sell", "short"),
      marker(204, 14, "close", "buy", "short"),
    ]),
  },
};

export const MissingCandles: Story = {
  name: "缺失 K 线",
  args: {
    projection: projection([
      marker(301, 1, "open", "buy", "long"),
      marker(302, 6, "add", "buy", "long"),
      marker(303, 14, "close", "sell", "long"),
    ], { missingCandles: true }),
  },
};

export const MobileWidth: Story = {
  name: "移动端宽度",
  args: { projection: projection(longMarkers) },
  decorators: [(Story) => <div className="mx-auto min-h-screen w-[390px] max-w-full bg-background p-3 text-foreground"><Story /></div>],
};

export const DarkTheme: Story = {
  name: "暗色主题",
  args: { projection: projection(shortMarkers, { direction: "short" }) },
  decorators: [(Story) => <DarkPreview><Story /></DarkPreview>],
};

function LayoutPersistenceFixture() {
  const [value, setValue] = useState<TradeChartProjection | null>(null);
  useEffect(() => {
    let active = true;
    const fixture = projection(longMarkers);
    const { from, to } = fixture.range;
    void getTradeChart(fixture.cycle_id, { timeframe: fixture.timeframe, from, to })
      .then((loaded) => { if (active) setValue(loaded); })
      .catch(() => { if (active) setValue(fixture); });
    return () => { active = false; };
  }, []);
  return <OpenAlgoTradeChart projection={value} loading={value === null} />;
}

export const LayoutPersistence: Story = {
  name: "图表对象保存",
  args: { projection: projection(longMarkers) },
  render: () => <LayoutPersistenceFixture />,
};

export const ShareStrategy: Story = {
  name: "分享策略图",
  args: { projection: projection(longMarkers), shareEnabled: true },
};

function DarkPreview({ children }: { children: ReactNode }) {
  useLayoutEffect(() => {
    const preview = document.documentElement;
    const oldMode = preview.getAttribute("data-wavekb-mode");
    preview.setAttribute("data-wavekb-mode", "dark");
    return () => {
      if (oldMode === null) preview.removeAttribute("data-wavekb-mode");
      else preview.setAttribute("data-wavekb-mode", oldMode);
    };
  }, []);
  return children;
}
