import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { TradingPnlCalendar } from "./pnl-calendar";

const meta = {
  title: "Workbench/PnL calendar",
  component: TradingPnlCalendar,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <main className="mx-auto max-w-2xl px-4 py-8"><Story /></main>],
  args: {
    timezone: "Asia/Shanghai",
    trades: [],
    calendar: [
      { local_date: "2026-10-31", trade_count: 1, net_pnl_usd: "24" },
      { local_date: "2026-11-02", trade_count: 1, net_pnl_usd: "25" },
      { local_date: "2026-11-03", trade_count: 2, net_pnl_usd: "12450.55" },
      { local_date: "2026-11-04", trade_count: 1, net_pnl_usd: "-320.50" },
      { local_date: "2026-11-05", trade_count: 2, net_pnl_usd: "-10950.12" },
      { local_date: "2026-11-10", trade_count: 1, net_pnl_usd: "0" },
      { local_date: "2026-11-15", trade_count: 1, net_pnl_usd: null },
    ],
  },
} satisfies Meta<typeof TradingPnlCalendar>;

export default meta;
export const MonthlyHeatmap: StoryObj<typeof meta> = {};
