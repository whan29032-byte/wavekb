import type { PublicStrategyProjection } from "@wavekb/domain/trading-review";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useLayoutEffect, type ReactNode } from "react";

import { PublicStrategyChart } from "./public-strategy-chart";

const baseTime = Date.parse("2026-11-01T00:00:00.000Z");
const commentsPostId = "public/post with space";
const totalQuantity = "9876.54321";
const fillQuantity = "1234.56789";
const absolutePnl = "87654.32";

function iso(minutes: number, seconds = 0) {
  return new Date(baseTime + minutes * 60_000 + seconds * 1_000).toISOString();
}

function publicProjection({
  showQuantity = false,
  showPnl = false,
  partial = false,
  open = false,
}: {
  showQuantity?: boolean;
  showPnl?: boolean;
  partial?: boolean;
  open?: boolean;
} = {}): PublicStrategyProjection {
  const missing = new Set(partial ? [5, 6] : []);
  const candles = Array.from({ length: 12 }, (_, index) => index)
    .filter((index) => !missing.has(index))
    .map((index) => ({
      series_basis: "trade" as const,
      open_time: iso(index),
      close_time: iso(index + 1),
      open: String(70_000 + index * 10),
      high: String(70_018 + index * 10),
      low: String(69_988 + index * 10),
      close: String(70_006 + index * 10),
      volume: String(100 + index),
      status: "final" as const,
      gap_before: partial && index === 7,
      gap_after: partial && index === 4,
    }));
  const marker = (
    key: string,
    minute: number,
    allocation_role: PublicStrategyProjection["markers"][number]["allocation_role"],
    side: PublicStrategyProjection["markers"][number]["side"],
  ): PublicStrategyProjection["markers"][number] => ({
    marker_key: key,
    occurred_at: iso(minute, 12),
    price: String(70_000 + minute * 10 + 4),
    allocation_role,
    side,
    position_side: "long",
    liquidity: minute % 2 === 0 ? "maker" : "taker",
    ...(showQuantity ? { quantity: fillQuantity } : {}),
    ...(showPnl ? { absolute_pnl: { amount: allocation_role === "close" ? absolutePnl : "0", currency: "USDT" } } : {}),
  });
  return {
    schema_version: "wavekb-public-strategy-snapshot-v1",
    renderer_schema_version: "wavekb-public-trade-chart-v1",
    calculation_engine_version: "openalgo-charts-2.7.5",
    provider: "binance",
    product: "usdt_perpetual",
    symbol: "BTCUSDT",
    direction: "long",
    timeframe: "1m",
    price_type: "trade",
    range: { from: iso(0), to: iso(12) },
    snapshot_status: open ? "open_at_snapshot" : "closed",
    candles,
    markers: [
      marker("public-open", 1, "open", "buy"),
      marker("public-add", 3, "add", "buy"),
      marker("public-reduce", 8, "reduce", "sell"),
      marker("public-close", 11, "close", "sell"),
    ],
    public_annotations: [{ marker_key: "public-open", body: "突破后按计划入场，失效位保持不变。", tags: ["计划内", "突破"] }],
    indicators: [{
      id: "public-sma",
      indicator_id: "sma",
      settings: { length: 5 },
      pane_index: 0,
      series: [{ points: candles.map((candle, index) => ({
        time: candle.open_time,
        value: index < 4 ? null : String(70_000 + index * 9),
      })) }],
    }],
    drawings: [{
      id: "public-trend",
      tool: "trend-line",
      points: [{ time: Math.floor(Date.parse(iso(1)) / 1_000), price: 70_014 }, { time: Math.floor(Date.parse(iso(11)) / 1_000), price: 70_104 }],
      style: { lineWidth: 2, lineStyle: "solid" },
      paneIndex: 0,
      locked: true,
      visible: true,
      zIndex: 1,
    }],
    coverage: {
      status: partial ? "gapped" : "complete",
      source: "public_api",
      fetched_at: iso(13),
      gaps: partial ? [{ series_basis: "trade", from: iso(5), to: iso(7) }] : [],
    },
    show_quantity: showQuantity,
    show_absolute_pnl: showPnl,
    price_return_rate: open ? "0.72" : "1.56",
    price_return_label: open
      ? `价格收益率（未实现，截至 ${iso(12)}）`
      : "价格收益率（不含手续费、资金费、掉期和杠杆）",
    warnings: showQuantity === showPnl ? [] : ["hidden_value_may_be_inferred"],
    ...(showQuantity ? { quantity: totalQuantity } : {}),
    ...(showPnl ? { absolute_pnl: { amount: absolutePnl, currency: "USDT" } } : {}),
  };
}

const meta = {
  title: "Community/Public strategy chart",
  component: PublicStrategyChart,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <main className="mx-auto min-h-screen max-w-7xl bg-background p-4 text-foreground md:p-8"><Story /></main>],
} satisfies Meta<typeof PublicStrategyChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const StrictPrivate: Story = {
  name: "数量与绝对盈亏均隐藏",
  args: { projection: publicProjection(), commentsPostId },
};

export const QuantityOnly: Story = {
  name: "仅公开数量",
  args: { projection: publicProjection({ showQuantity: true }), commentsPostId },
};

export const PnlOnly: Story = {
  name: "仅公开绝对盈亏",
  args: { projection: publicProjection({ showPnl: true }), commentsPostId },
};

export const BothVisible: Story = {
  name: "数量与绝对盈亏均公开",
  args: { projection: publicProjection({ showQuantity: true, showPnl: true }), commentsPostId },
};

export const PartialCoverage: Story = {
  name: "行情存在缺口",
  args: { projection: publicProjection({ partial: true }) },
};

export const OpenAtSnapshot: Story = {
  name: "开放周期快照",
  args: { projection: publicProjection({ open: true }) },
};

export const MarkerDiscussionTarget: Story = {
  name: "选中成交与讨论入口",
  args: {
    projection: publicProjection(),
    activeMarkerKey: "public-reduce",
    commentsPostId: "public-post-preview",
  },
};

export const MobileWidth: Story = {
  name: "390px 移动端",
  args: { projection: publicProjection() },
  decorators: [(Story) => <div className="mx-auto min-h-screen w-[390px] max-w-full bg-background p-3 text-foreground"><Story /></div>],
};

export const DarkTheme: Story = {
  name: "暗色主题",
  args: { projection: publicProjection({ showQuantity: true, showPnl: true }) },
  decorators: [(Story) => <DarkPreview><Story /></DarkPreview>],
};

function DarkPreview({ children }: { children: ReactNode }) {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute("data-wavekb-mode");
    root.setAttribute("data-wavekb-mode", "dark");
    return () => {
      if (previous === null) root.removeAttribute("data-wavekb-mode");
      else root.setAttribute("data-wavekb-mode", previous);
    };
  }, []);
  return children;
}
