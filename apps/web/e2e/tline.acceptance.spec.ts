import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const fixtureHelper = fileURLToPath(new URL("../scripts/start-tline-e2e.mjs", import.meta.url));

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

test("seeded local research supports paging, filters, refresh, and detail without upstream requests", async ({ page }) => {
  test.skip(process.env.TLINE_E2E_FIXTURE !== "1", "Run with the deterministic local research fixture server.");
  expect(test.info().config.workers).toBe(1);
  const upstream: string[] = [];
  page.on("request", (request) => { if (new URL(request.url()).hostname === "tlines.tech") upstream.push(request.url()); });
  await page.emulateMedia({ reducedMotion: "reduce" });

  await page.goto("/research");
  await expect(page.getByRole("heading", { level: 1, name: "机构研报" })).toBeVisible();
  await expect(page.locator("main article")).toHaveCount(30);
  await expect(page.getByText(/最近成功同步/)).toBeVisible();
  await expect(page.getByText(/每 10 分钟/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: test.info().outputPath("local-research-list.png"), fullPage: false });
  const viewport = page.viewportSize();
  if (viewport && viewport.width < 768) {
    await page.setViewportSize({ width: 812, height: 375 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: test.info().outputPath("local-research-landscape.png"), fullPage: false });
    await page.setViewportSize(viewport);
  }
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.reload();
  await expect(page.locator("main article")).toHaveCount(30);
  await page.screenshot({ path: test.info().outputPath("local-research-dark.png"), fullPage: false });

  const refreshTitle = `刷新后新增研报 ${test.info().project.name} ${test.info().retry}`;
  const refreshId = `r-refresh-${test.info().project.name}-retry-${test.info().retry}`;
  expect(process.env.TLINE_API_KEY).toBe("");
  execFileSync(process.execPath, [fixtureHelper, "publish", refreshId, refreshTitle], {
    env: { ...process.env, TLINE_API_KEY: "" },
    stdio: "pipe",
  });
  await expect(page.getByRole("heading", { name: refreshTitle })).toHaveCount(0);
  await page.getByRole("button", { name: "刷新列表" }).click();
  await expect(page.getByRole("heading", { name: refreshTitle })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("since")).toBeNull();
  expect(new URL(page.url()).searchParams.get("until")).toBeNull();
  expect(new URL(page.url()).searchParams.get("page")).toBeNull();
  await expect(page.locator("main article")).toHaveCount(30);
  await page.screenshot({ path: test.info().outputPath("local-research-refreshed.png"), fullPage: false });

  const firstPage = await page.locator("main article h2 a").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  await page.getByRole("link", { name: "下一页研报" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.locator("main article")).toHaveCount(30);
  const secondPage = await page.locator("main article h2 a").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  expect(secondPage.some((id) => firstPage.includes(id))).toBe(false);
  await page.getByRole("link", { name: "上一页研报" }).click();
  await expect(page).not.toHaveURL(/page=2/);
  expect(new URL(page.url()).searchParams.get("page")).toBeNull();

  await page.getByRole("searchbox", { name: "搜索研报内容" }).fill("跨页黄金观察");
  await page.getByRole("button", { name: "搜索研报", exact: true }).click();
  await expect(page.getByRole("heading", { name: "跨页黄金观察 64" })).toBeVisible();
  await expect(page.locator('main p[role="status"]')).toContainText("匹配 1 篇");
  await page.getByRole("link", { name: "清除筛选" }).click();
  await expect(page.getByRole("searchbox")).toHaveValue("");

  await page.getByRole("combobox", { name: "研究机构" }).selectOption("bank-b");
  await page.getByRole("button", { name: "搜索研报", exact: true }).click();
  await expect(page.locator("main article")).toHaveCount(5);
  expect((await page.locator("main article strong").allTextContents()).every((name) => name === "机构乙")).toBe(true);
  await page.locator("main article").first().getByRole("link", { name: "阅读研报" }).click();
  await expect(page).toHaveURL(/\/research\/r6[0-4]$/);
  await expect(page.getByRole("heading", { name: "研报摘要" })).toBeVisible();
  expect(upstream).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: test.info().outputPath("local-research-detail.png"), fullPage: true });
});

test("live Tline research and detail render in-site without browser calls to the keyed upstream", async ({ page }) => {
  test.skip(process.env.TLINE_LIVE_ACCEPTANCE !== "1", "Enable only with server-side Tline environment configured.");
  test.setTimeout(600_000);
  const upstream: string[] = [];
  page.on("request", (request) => { if (new URL(request.url()).hostname === "tlines.tech") upstream.push(request.url()); });
  await page.goto("/research", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1, name: "机构研报" })).toBeVisible();
  const firstArticle = page.locator("main article").first();
  const legitimateEmpty = page.getByRole("heading", { name: "暂无已同步研报" });
  await expect(firstArticle.or(legitimateEmpty)).toBeVisible({ timeout: 30_000 });
  if (await legitimateEmpty.isVisible()) {
    await expect(page.getByText(/最近成功同步/)).toBeVisible();
    expect(upstream).toEqual([]);
    return;
  }
  const firstTitles = await page.locator("main article h2").allTextContents();
  const firstIds = await page.locator("main article h2 a").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  expect(firstTitles.length).toBeGreaterThan(0); expect(firstTitles.length).toBeLessThanOrEqual(30);
  await expect(page.getByRole("searchbox", { name: "搜索研报内容" })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("research-list.png"), fullPage: false });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  let searchTitle = firstTitles[0];
  if (await page.getByRole("link", { name: "下一页研报" }).isVisible()) {
    expect(firstTitles.length).toBe(30);
    await page.getByRole("link", { name: "下一页研报" }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.locator("main article").first()).toBeVisible({ timeout: 30_000 });
    const secondIds = await page.locator("main article h2 a").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    expect(secondIds.length).toBeGreaterThan(0); expect(secondIds.length).toBeLessThanOrEqual(30);
    expect(secondIds.some((id) => firstIds.includes(id))).toBe(false);
    searchTitle = await page.locator("main article h2").first().innerText();
    await page.getByRole("link", { name: "上一页研报" }).click();
    await expect(page).not.toHaveURL(/page=2/);
    expect(new URL(page.url()).searchParams.get("page")).toBeNull();
    await expect(page.locator("main article h2").first()).toHaveText(firstTitles[0], { timeout: 30_000 });
  }
  // Prefer a title from page two to prove that search covers later pages too.
  await page.getByRole("searchbox", { name: "搜索研报内容" }).fill(searchTitle.slice(0, 200));
  await page.getByRole("button", { name: "搜索研报", exact: true }).click();
  await expect(page.getByRole("heading", { name: searchTitle, exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "上一页研报" })).toBeDisabled();
  await page.getByRole("searchbox", { name: "搜索研报内容" }).fill("no-match-wavekb-acceptance-748293");
  await page.getByRole("button", { name: "搜索研报", exact: true }).click();
  await expect(page.getByRole("heading", { name: "没有匹配的研报" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "清除筛选" }).click();
  await expect(page.locator("main article")).toHaveCount(firstTitles.length, { timeout: 30_000 });
  await expect(page.getByRole("searchbox")).toHaveValue("");
  const institutions = page.getByRole("combobox", { name: "研究机构" });
  const option = await institutions.locator("option").nth(1).getAttribute("value");
  const institutionName = await institutions.locator("option").nth(1).innerText();
  await institutions.selectOption(option!);
  await page.getByRole("button", { name: "搜索研报", exact: true }).click();
  await expect(page.locator("main article").first()).toBeVisible({ timeout: 30_000 });
  expect((await page.locator("main article").count())).toBeLessThanOrEqual(30);
  expect((await page.locator("main article strong").allTextContents()).every((name) => name === institutionName)).toBe(true);
  await page.getByRole("link", { name: "清除筛选" }).click();
  await expect(page.locator("main article")).toHaveCount(firstTitles.length, { timeout: 30_000 });
  await expect(institutions).toHaveValue("");
  await page.locator("main article").first().getByRole("link", { name: "阅读研报", exact: true }).click();
  await expect(page).toHaveURL(/\/research\/[A-Za-z0-9_-]+$/);
  await expect(page.getByRole("heading", { name: "研报摘要" })).toBeVisible({ timeout: 30_000 });
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
