import { expect, test } from "@playwright/test";

const identifier = process.env.E2E_POSTING_IDENTIFIER;
const password = process.env.E2E_POSTING_PASSWORD;

test.describe("authenticated posting acceptance", () => {
  test.skip(!identifier || !password, "Dedicated acceptance account is not configured.");

  test("complete posting lifecycle with an image and external reference", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/login?next=/community/idea_sharing/new");
    await page.getByLabel("邮箱或 UID").fill(identifier || "");
    await page.getByLabel("密码").fill(password || "");
    await page.getByRole("button", { name: "登录" }).click();
    await expect(page).toHaveURL(/\/community\/idea_sharing\/new/, { timeout: 15_000 });
    const accountMenu = page.locator('summary[aria-label="账户菜单"]');
    await expect(page.getByRole("button", { name: "退出登录" }).or(accountMenu)).toBeVisible({ timeout: 15_000 });

    const marker = `验收发帖 ${Date.now()}`;
    let published = false;
    try {
      await page.getByLabel("标题").fill(marker);
      await page.getByLabel("正文").fill("这是一篇由 Playwright 专用账号创建的验收帖子，用于确认发布和详情读取链路。 ");
      await page.locator("#post-images").setInputFiles({
        name: "posting-acceptance.png",
        mimeType: "image/png",
        buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
      });
      await page.getByLabel("外部引用（可选）").fill("https://www.youtube.com/watch?v=posting-acceptance");
      await page.getByRole("button", { name: "发布内容" }).click();
      await expect(page).toHaveURL(/\/community\/post\//, { timeout: 20_000 });
      published = true;
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(marker);
      await expect(page.getByRole("img", { name: `${marker}，图片 1` })).toBeVisible();
      await expect(page.getByRole("link", { name: "查看引用的 YouTube 视频" })).toHaveAttribute("href", /youtube\.com/);

      const commentMarker = `验收评论 ${Date.now()}`;
      await page.getByLabel("发表评论").fill(`${commentMarker}，用于确认评论写入、详情刷新和级联清理。`);
      await page.getByRole("button", { name: "发表评论" }).click();
      await expect(page.getByText(commentMarker, { exact: false })).toBeVisible();

      await page.reload();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(marker);
      await expect(page.getByText(commentMarker, { exact: false })).toBeVisible();

      const authorProfileLink = page.locator("main > article").locator('header a[href^="/member/"]');
      await expect(authorProfileLink).toHaveCount(1);
      await authorProfileLink.click();
      await expect(page).toHaveURL(/\/member\/\d{5,6}$/);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.goBack();

      await page.getByRole("link", { name: "编辑帖子" }).click();
      await page.getByRole("tab", { name: "专业分析" }).click();
      await page.getByLabel("品种", { exact: true }).fill("BINANCE:BTCUSDT");
      await page.getByLabel("核心观点").fill("当前结构仍需等待同级别确认。 ");
      await page.getByLabel("规则与指南依据").fill("硬规则先淘汰，比例关系只用于排序。 ");
      await page.getByLabel("公开图表链接或品种代码").fill("BINANCE:BTCUSDT");
      await page.getByLabel("正文").fill("这篇验收帖子已经完成编辑，用于确认作者修改链路和详情页刷新。 ");
      await page.getByRole("button", { name: "移除现有图片 1" }).click();
      await page.getByLabel("外部引用（可选）").fill("https://x.com/wavekb/status/1");
      await page.getByRole("button", { name: "保存修改" }).click();
      await expect(page.getByText("这篇验收帖子已经完成编辑")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText("【核心观点】")).toBeVisible();
      await expect(page.getByRole("heading", { name: "TradingView 图表" })).toBeVisible();
      await expect(page.getByTitle("BINANCE:BTCUSDT TradingView 图表")).toHaveAttribute("src", /tradingview\.com/);
      await expect(page.getByRole("region", { name: /帖子图片/ })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "查看引用的 X 帖子" })).toHaveAttribute("href", "https://x.com/wavekb/status/1");
    } finally {
      if (published) {
        const deleteButton = page.getByRole("button", { name: "删除帖子" });
        if (!await deleteButton.isVisible().catch(() => false)) await page.goBack().catch(() => undefined);
        page.once("dialog", (dialog) => dialog.accept());
        await page.getByRole("button", { name: "删除帖子" }).click();
        await expect(page).toHaveURL(/\/community\/idea_sharing$/);
      }
      if (await accountMenu.isVisible().catch(() => false)) await accountMenu.click();
      await page.getByRole("button", { name: "退出登录" }).click();
      await expect(page).toHaveURL("/");
      await expect(page.getByRole("link", { name: "登录" })).toBeVisible();
    }
  });
});
