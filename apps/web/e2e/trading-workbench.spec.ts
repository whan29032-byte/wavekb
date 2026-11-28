import { expect, test, type Page } from "@playwright/test";

const identifier = process.env.E2E_POSTING_IDENTIFIER;
const password = process.env.E2E_POSTING_PASSWORD;
const liveAcceptanceRequired = process.env.TRADING_LIVE_ACCEPTANCE === "1";

if (liveAcceptanceRequired && (!identifier || !password)) {
  throw new Error("trading_live_acceptance_credentials_required");
}

async function login(page: Page) {
  await page.goto("/login?next=%2Fworkbench");
  await page.getByLabel("邮箱或 UID").fill(identifier || "");
  await page.getByLabel("密码").fill(password || "");
  const responsePromise = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/auth/login");
  await page.getByRole("button", { name: "登录" }).click();
  expect((await responsePromise).ok()).toBe(true);
  await expect(page).toHaveURL(/\/workbench$/);
}

test("the private workbench stays protected and exposes no order mutation route", async ({ page, request }) => {
  const manifestResponse = await request.get("/manifest.webmanifest");
  expect(manifestResponse.status()).toBe(200);
  await expect(manifestResponse.json()).resolves.toMatchObject({ start_url: "/", display: "standalone" });
  await page.goto("/workbench");
  await expect(page).toHaveURL(/\/login\?next=%2Fworkbench$/);
  const mutation = await request.post("/api/trading/trades/not-a-trade/order", { data: { side: "buy" } });
  expect(mutation.status()).toBe(404);
  await expect(mutation.json()).resolves.toEqual({ error: "not_found" });
});

test.describe("authenticated automatic trade review acceptance", () => {
  test.skip(!liveAcceptanceRequired && (!identifier || !password), "Dedicated acceptance account is not configured for local guest-only checks.");

  test("shows five read-only providers, portfolio filters and preserved private tools", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page);
    await expect(page.getByTestId("workbench-dashboard")).toBeVisible();
    await expect(page.getByRole("group", { name: "月度盈亏" })).toBeVisible();

    const providerFilter = page.getByLabel("交易平台", { exact: true }).first();
    await expect(providerFilter.locator("option")).toHaveCount(6);
    for (const value of ["binance", "okx", "bybit", "bitget", "exness"]) {
      await providerFilter.selectOption(value);
      await expect(providerFilter).toHaveValue(value);
    }
    await providerFilter.selectOption("");
    await expect(page.getByLabel("统计范围", { exact: true })).toHaveValue("30d");
    await expect(page.getByLabel("交易账户", { exact: true })).toHaveValue("");

    await page.getByText("管理交易账户", { exact: true }).click();
    const connectionProvider = page.locator("#exchange-provider");
    await expect(connectionProvider).toBeVisible();
    await expect(connectionProvider.locator("option")).toHaveCount(5);
    for (const value of ["binance", "okx", "bybit", "bitget", "exness"]) {
      await connectionProvider.selectOption(value);
      await expect(connectionProvider).toHaveValue(value);
    }

    const secondary = page.getByRole("navigation", { name: "工作台次级入口" });
    await expect(secondary.getByRole("link", { name: "私人记录" })).toHaveAttribute("href", "/workbench/entries/new?kind=journal");
    await expect(secondary.getByRole("link", { name: "研究草稿" })).toHaveAttribute("href", "/workbench/entries/new?kind=draft");
    await expect(secondary.getByRole("link", { name: "历史分析工具" })).toHaveAttribute("href", "/workbench/analysis/new?step=0");

    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  });

  test("the realtime leaderboard remains public and renders only safe aggregate fields", async ({ page }) => {
    const response = await page.goto("/leaderboard");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("收益排行榜");
    await expect(page.getByText("累计盈利", { exact: true }).first()).toBeVisible();
    expect(await page.locator("body").innerText()).not.toMatch(/api[_-]?key|secret[_-]?key|private[_-]?key/i);
  });
});
