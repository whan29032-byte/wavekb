import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // Component fixtures never contact production or submit a payment declaration.
  await page.route("**/*", (route) => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
});

for (const width of [375, 1280]) {
  test(`mentor pending summary is readable and recoverable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/iframe.html?id=mentors-payment-recovery--submitted&viewMode=story");
    const summary = page.getByRole("region", { name: "付款待核对摘要" });
    await expect(summary.getByRole("heading", { name: "1 项待核对付款" })).toBeVisible();
    await expect(summary.getByText(/30 天结构陪跑 · 128 USDT · 30 天 · 每周 3 次/)).toBeVisible();
    await expect(summary.getByText(/提交时间/)).toBeVisible();
    await expect(page.getByRole("img", { name: "林舟头像" })).toBeVisible();
    await expect(page.getByRole("img", { name: "林舟头像" })).toHaveText("林");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("mentor-submitted.png"), fullPage: true });

    await page.goto("/iframe.html?id=mentors-payment-recovery--legacy-order&viewMode=story");
    await expect(page.getByRole("button", { name: "已付款，补交原订单声明" })).toBeVisible();
    const cancel = page.getByRole("button", { name: "取消未付款原订单" });
    await expect(cancel).toBeDisabled();
    await page.getByRole("checkbox", { name: "我确认此订单从未转账，需要取消" }).check();
    await expect(cancel).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("mentor-legacy-recovery.png"), fullPage: true });
  });
}

test("failed status lookup offers retry without a payment submit", async ({ page }) => {
  await page.goto("/iframe.html?id=mentors-payment-recovery--query-unavailable&viewMode=story");
  await expect(page.getByRole("alert")).toContainText("不要重复转账");
  await expect(page.getByRole("button", { name: "重试查询状态" })).toBeEnabled();
  await expect(page.getByRole("button", { name: /我已付款|补交/ })).toHaveCount(0);
});
