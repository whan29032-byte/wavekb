import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PublicStrategyProjection, TradeChartProjection } from "@wavekb/domain/trading-review";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ShareStrategyDialog } from "./share-strategy-dialog";
import { TradexTradeReview } from "./tradex-trade-review";
import { StrategyShareRepositoryError, type PreviewPublicStrategyInput } from "@/lib/trading/workbench-repository";

const api = vi.hoisted(() => ({ preview: vi.fn(), publish: vi.fn(), tradeChart: vi.fn() }));
vi.mock("@/lib/trading/workbench-repository", async (original) => ({
  ...await original<typeof import("@/lib/trading/workbench-repository")>(),
  previewPublicStrategy: api.preview, publishPublicStrategy: api.publish,
  getTradeChart: api.tradeChart,
}));
vi.mock("@/components/community/public-strategy-chart", () => ({
  PublicStrategyChart: ({ projection }: { projection: PublicStrategyProjection }) => (
    <div aria-label="快照测试">
      {projection.quantity && <p>数量 {projection.quantity}</p>}
      {projection.absolute_pnl && <p>盈亏 {projection.absolute_pnl.amount}</p>}
    </div>
  ),
}));

const cycleId = "11a11111-1111-4111-8111-111111111111";
const range = { from: "2026-11-26T10:00:00.000Z", to: "2026-11-26T10:01:00.000Z" };
const projection: TradeChartProjection = {
  schema_version: "wavekb-trade-chart-projection-v1",
  cycle_id: cycleId, cycle_revision: 3, timeframe: "1m", range, price_type: "trade", provider: "okx",
  product: "usdt_perpetual", symbol: "ETHUSDT", native_symbol: "ETH-USDT-SWAP", direction: "short",
  opened_at: range.from, closed_at: range.to, chart_state: null, candles: [], markers: [], warnings: [],
  coverage: { source: "public_api", status: "complete", fetched_at: range.to, gaps: [], unavailable_reason: null },
};
const sharedCount = "0.970246513579";
const sharedPnl = "972.13579";

function preview(input: PreviewPublicStrategyInput) {
  return {
    preview_token: `test-token-${input.show_quantity}-${input.show_absolute_pnl}`,
    idempotency_key: `test-key-${input.show_quantity}-${input.show_absolute_pnl}`,
    projection_digest: `test-digest-${input.show_quantity}-${input.show_absolute_pnl}`,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    projection: {
      show_quantity: input.show_quantity,
      show_absolute_pnl: input.show_absolute_pnl,
      warnings: input.show_quantity !== input.show_absolute_pnl ? ["hidden_value_may_be_inferred"] : [],
      ...(input.show_quantity ? { quantity: sharedCount } : {}),
      ...(input.show_absolute_pnl ? { absolute_pnl: { amount: sharedPnl, currency: "USDT" } } : {}),
    },
  };
}

function renderDialog() {
  return render(<ShareStrategyDialog projection={projection} fills={[]} onClose={vi.fn()}
    layout={{ version: 2, indicators: [], drawings: [] }} />);
}

beforeEach(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value(this: HTMLDialogElement) { this.open = true; } },
    close: { configurable: true, value(this: HTMLDialogElement) { this.open = false; } },
  });
  api.preview.mockReset().mockImplementation(async (_id, input) => preview(input));
  api.publish.mockReset().mockResolvedValue({ post_id: "new-post", snapshot_id: "new-snapshot", replayed: false });
});
afterEach(cleanup);

it("opens a fixed WaveKB share preview from TradeX without sharing the live feed or private fields", async () => {
  const trade = { ...projection, provider: "binance", symbol: "ETHUSDT", native_symbol: "ETHUSDT" } as const;
  api.tradeChart.mockResolvedValueOnce(trade);
  render(<TradexTradeReview origin="https://chart.example.net" projection={trade} shareEnabled
    market={{ provider: "binance", product: "usdt_perpetual", symbol: "ETHUSDT", timeframe: "1m" }} />);
  fireEvent.click(screen.getByRole("button", { name: "分享复盘" }));
  await screen.findByLabelText("快照测试");
  expect(api.preview).toHaveBeenCalledExactlyOnceWith(cycleId, {
    cycle_revision: 3, chart_state_version: 0, timeframe: "1m", ...range,
    show_quantity: false, show_absolute_pnl: false, annotation_fill_ids: [], drawing_ids: [], indicator_instance_ids: [],
  });
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "显示仓位数量" }).checked).toBe(false);
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "显示绝对盈亏金额" }).checked).toBe(false);
});

it("requests a new explicit preview for every privacy mode and resets confirmation", async () => {
  renderDialog();
  const quantity = screen.getByRole<HTMLInputElement>("checkbox", { name: "显示仓位数量" });
  const pnl = screen.getByRole<HTMLInputElement>("checkbox", { name: "显示绝对盈亏金额" });
  expect(quantity.checked).toBe(false);
  expect(pnl.checked).toBe(false);
  await screen.findByLabelText("快照测试");
  expect(api.preview).toHaveBeenLastCalledWith(cycleId, expect.objectContaining({
    cycle_revision: 3, chart_state_version: 2, show_quantity: false, show_absolute_pnl: false, annotation_fill_ids: [],
  }));
  expect(screen.queryByText(`数量 ${sharedCount}`)).toBeNull();
  expect(screen.queryByText(`盈亏 ${sharedPnl}`)).toBeNull();
  fireEvent.click(screen.getByRole("checkbox", { name: "我确认将这份图表和帖子公开发布" }));

  fireEvent.click(quantity);
  expect(screen.queryByLabelText("快照测试")).toBeNull();
  await screen.findByText(`数量 ${sharedCount}`);
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "我确认将这份图表和帖子公开发布" }).checked).toBe(false);
  expect(screen.queryByText(`盈亏 ${sharedPnl}`)).toBeNull();
  expect(screen.getByText(/推算另一项/)).toBeTruthy();

  fireEvent.click(pnl);
  await screen.findByText(`盈亏 ${sharedPnl}`);
  expect(screen.getByText(`数量 ${sharedCount}`)).toBeTruthy();
  expect(screen.queryByText(/推算另一项/)).toBeNull();

  fireEvent.click(quantity);
  await screen.findByText(`盈亏 ${sharedPnl}`);
  expect(screen.queryByText(`数量 ${sharedCount}`)).toBeNull();
  expect(api.preview).toHaveBeenCalledTimes(4);
});

it("recovers an uncertain publication with the identical receipt and does not regenerate the preview", async () => {
  api.publish.mockRejectedValueOnce(new StrategyShareRepositoryError("public_strategy_unavailable", 503))
    .mockResolvedValueOnce({ post_id: "previous-post", snapshot_id: "existing-snapshot", replayed: true });
  renderDialog();
  fireEvent.change(screen.getByLabelText("标题"), { target: { value: "我的策略案例" } });
  fireEvent.change(screen.getByLabelText("正文"), { target: { value: "这里记录了开仓和平仓的条件，并写下我在下次复盘要检查的问题。" } });
  fireEvent.click(await screen.findByRole("checkbox", { name: "我确认将这份图表和帖子公开发布" }));
  fireEvent.click(screen.getByRole("button", { name: "发布到社区" }));
  fireEvent.click(await screen.findByRole("button", { name: "重试确认发布" }));
  await waitFor(() => expect(api.publish).toHaveBeenCalledTimes(2));
  expect(api.publish.mock.calls[0]).toEqual(api.publish.mock.calls[1]);
  expect(api.preview).toHaveBeenCalledTimes(1);
  expect((await screen.findByRole("link", { name: "查看社区帖子" })).getAttribute("href")).toBe("/community/post/previous-post");
});
