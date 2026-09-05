import { expect, test } from "@playwright/test";

test("research entry stays inside WaveKB and fits desktop/mobile navigation", async ({ page }) => {
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "展开主导航" });
  if (await toggle.isVisible()) await toggle.click();
  const links = page.getByRole("link", { name: "机构研报", exact: true }).filter({ visible: true });
  await expect(links).toHaveCount(1); await expect(links).toHaveAttribute("href", "/research");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  if ((page.viewportSize()?.width ?? 0) >= 768) {
    for (const width of [768, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByRole("link", { name: "机构研报", exact: true }).filter({ visible: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    }
  }
});

test("live Tline research and detail render in-site without browser calls to the keyed upstream", async ({ page }) => {
  test.skip(process.env.TLINE_LIVE_ACCEPTANCE !== "1", "Enable only with server-side Tline environment configured.");
  test.setTimeout(600_000);
  const upstream: string[] = [];
  page.on("request", (request) => { if (new URL(request.url()).hostname === "tlines.tech") upstream.push(request.url()); });
  await page.goto("/research", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1, name: "机构研报" })).toBeVisible();
  await expect(page.locator("main article").first()).toBeVisible({ timeout: 450_000 });
  await page.screenshot({ path: test.info().outputPath("research-list.png"), fullPage: false });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.locator("main article").first().getByRole("link", { name: "阅读研报", exact: true }).click();
  await expect(page).toHaveURL(/\/research\/[A-Za-z0-9_-]+$/);
  await expect(page.getByRole("heading", { name: "研报摘要" })).toBeVisible({ timeout: 450_000 });
  await expect(page.getByRole("heading", { name: "核心论点" })).toBeVisible();
  expect(upstream).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: test.info().outputPath("research-detail.png"), fullPage: true });
});

test("an invalid paging window offers recovery without a broken page", async ({ page }) => {
  await page.goto("/research?since=invalid&cursor=invalid");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("分页窗口无效");
  await expect(page.getByRole("link", { name: "重新打开研报" })).toHaveAttribute("href", "/research");
});
