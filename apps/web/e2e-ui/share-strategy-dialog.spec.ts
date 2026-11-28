import { expect, test } from "@playwright/test";
import type { PublicStrategyProjection } from "@wavekb/domain/trading-review";

test("mobile sharing requires confirmation of the latest preview and sends that exact receipt", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const start = "2026-11-26T10:00:00.000Z";
  const end = "2026-11-26T10:01:00.000Z";
  const count = "0.970246513579";
  const postId = "11111111-1111-4111-8111-111111111111";
  const snapshotId = "22222222-2222-4222-8222-222222222222";
  await page.route("**/api/trading/trades/*/share-preview", async (route) => {
    const selection = route.request().postDataJSON();
    expect(selection.show_absolute_pnl).toBe(false);
    const showQuantity = selection.show_quantity === true;
    const projection: PublicStrategyProjection = {
      schema_version: "wavekb-public-strategy-snapshot-v1", renderer_schema_version: "wavekb-public-trade-chart-v1",
      calculation_engine_version: "openalgo-charts-2.7.5",
      provider: "binance", product: "usdt_perpetual", symbol: "BTCUSDT", direction: "long", timeframe: "1m", price_type: "trade",
      range: { from: start, to: end }, snapshot_status: "closed",
      candles: [{ series_basis: "trade", open_time: start, close_time: end, open: "100", high: "104", low: "95", close: "102",
        volume: "35", status: "final", gap_before: false, gap_after: false }],
      markers: [{ marker_key: "a".repeat(32), occurred_at: start, price: "100", allocation_role: "open", side: "buy",
        position_side: "long", liquidity: "maker", ...(showQuantity ? { quantity: count } : {}) }],
      public_annotations: [], indicators: [], drawings: [],
      coverage: { status: "complete", source: "public_api", fetched_at: end, gaps: [] },
      show_quantity: showQuantity, show_absolute_pnl: false, price_return_rate: "2", price_return_label: "价格收益率",
      warnings: showQuantity ? ["hidden_value_may_be_inferred"] : [], ...(showQuantity ? { quantity: count } : {}),
    };
    await route.fulfill({ status: 201, json: {
      preview_token: showQuantity ? "quantity-token" : "private-token", idempotency_key: snapshotId,
      expires_at: new Date(Date.now() + 60_000).toISOString(), projection_digest: (showQuantity ? "a" : "b").repeat(64), projection,
    } });
  });
  await page.route("**/api/trading/trades/*/share-publish", async (route) => {
    const submission = route.request().postDataJSON();
    expect(submission).toEqual({
      board: "case_submission", title: "移动端分享测试", body: "这笔交易的进出场、止损条件和策略复盘，可以在图表中逐笔核对。",
      preview_token: "quantity-token", idempotency_key: snapshotId, projection_digest: "a".repeat(64),
    });
    await route.fulfill({ status: 201, json: { post_id: postId, snapshot_id: snapshotId, replayed: false } });
  });

  await page.goto("/iframe.html?id=workbench-trade-chart-fill-level--share-strategy&viewMode=story");
  await page.getByRole("button", { name: "分享策略图" }).click();
  const dialog = page.getByRole("dialog", { name: "分享策略图" });
  const approval = dialog.getByRole("checkbox", { name: "我确认将这份图表和帖子公开发布" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: "显示仓位数量" })).not.toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "显示绝对盈亏金额" })).not.toBeChecked();
  await approval.check();
  await expect(dialog).not.toContainText(count);
  await dialog.getByRole("checkbox", { name: "显示仓位数量" }).check();
  await expect(dialog.getByText(count, { exact: true }).first()).toBeVisible();
  await expect(approval).not.toBeChecked();
  const submit = dialog.getByRole("button", { name: "发布到社区" });
  await expect(submit).toBeDisabled();
  await dialog.getByLabel("标题").fill("移动端分享测试");
  await dialog.getByLabel("正文").fill("这笔交易的进出场、止损条件和策略复盘，可以在图表中逐笔核对。");
  await approval.check();
  await submit.click();
  await expect(dialog.getByRole("link", { name: "查看社区帖子" })).toHaveAttribute("href", `/community/post/${postId}`);
});
