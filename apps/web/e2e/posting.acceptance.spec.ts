import { expect, test } from "@playwright/test";

const identifier = process.env.E2E_POSTING_IDENTIFIER;
const password = process.env.E2E_POSTING_PASSWORD;

test.describe("authenticated posting acceptance", () => {
  test.skip(!identifier || !password, "Dedicated acceptance account is not configured.");

  test("complete posting lifecycle with research media and a timeline update", async ({ page }) => {
    test.setTimeout(150_000);
    page.on("console", (message) => {
      if (message.type() === "error" && message.text().includes("wavekb:post-save-failed")) {
        console.log("Browser post-save diagnostic", message.text());
      }
    });
    await page.goto("/login?next=/community/idea_sharing/new");
    await page.getByLabel("邮箱或 UID").fill(identifier || "");
    await page.getByLabel("密码").fill(password || "");
    const loginResponsePromise = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/auth/login");
    await page.getByRole("button", { name: "登录" }).click();
    const loginResponse = await loginResponsePromise;
    const loginResult = await loginResponse.json().catch(() => ({})) as { error?: string; ok?: boolean };
    expect(loginResponse.ok(), `Login failed (${loginResponse.status()}): ${loginResult.error || "unknown response"}`).toBe(true);
    await expect(page).toHaveURL(/\/community\/idea_sharing\/new/, { timeout: 15_000 });
    const composerHeading = page.getByRole("heading", { name: "发布到「思路分享」" });
    try {
      await expect(composerHeading).toBeVisible({ timeout: 15_000 });
    } catch (error) {
      console.log("Authenticated destination diagnostic", JSON.stringify({
        url: page.url(),
        title: await page.title().catch(() => ""),
        body: (await page.locator("body").innerText().catch(() => "")).slice(0, 1_000),
      }));
      throw error;
    }
    const accountMenu = page.locator('summary[aria-label="账户菜单"]');
    const signOutButton = page.getByRole("button", { name: "退出登录" });
    await expect.poll(async () => await signOutButton.isVisible() || await accountMenu.isVisible(), { timeout: 15_000 }).toBe(true);
    const socialPanel = page.getByRole("region", { name: "好友与聊天" });
    await expect(socialPanel).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel("搜索好友 UID")).toHaveCount(0);
    await socialPanel.getByRole("button", { name: /新朋友/ }).click();
    await expect(page.getByLabel("搜索好友 UID")).toBeVisible();
    await page.goto("/knowledge");
    await expect(socialPanel).toBeVisible();
    await page.goto("/community/idea_sharing/new");

    const marker = `验收发帖 ${Date.now()}`;
    let published = false;
    try {
      await expect(page.getByRole("button", { name: "发布内容" })).toBeEnabled();
      await page.getByLabel("标题").fill(marker);
      await page.getByLabel("正文").fill("这是一篇由 Playwright 专用账号创建的验收帖子，用于确认发布和详情读取链路。 ");
      await page.locator("#post-images").setInputFiles({
        name: "posting-acceptance.png",
        mimeType: "image/png",
        buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
      });
      await page.getByLabel("待发布图片 1 说明").fill("Playwright 研究图表快照");
      await page.getByLabel("媒体引用 1").fill("https://www.youtube.com/watch?v=posting-acceptance");
      await page.getByRole("button", { name: "发布内容" }).click();
      try {
        await expect(page).toHaveURL(/\/community\/post\//, { timeout: 45_000 });
      } catch (error) {
        console.log("Publishing diagnostic", JSON.stringify({
          url: page.url(),
          alert: await page.getByRole("alert").last().innerText().catch(() => ""),
          submitLabel: await page.getByRole("button", { name: /发布内容|正在保存/ }).innerText().catch(() => ""),
          form: (await page.locator("main form").innerText().catch(() => "")).slice(0, 2_000),
        }));
        throw error;
      }
      published = true;
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(marker);
      await expect(page.getByRole("img", { name: `${marker}，图片 1` })).toBeVisible();
      await expect(page.getByText("图 1 · Playwright 研究图表快照")).toBeVisible();
      await expect(page.getByRole("heading", { name: "媒体与外部引用" })).toBeVisible();
      await expect(page.getByRole("link", { name: /在 YouTube 打开/ })).toHaveAttribute("href", /youtube\.com/);
      await page.getByRole("button", { name: `放大查看：${marker}，图片 1` }).click();
      await expect(page.getByRole("dialog", { name: `${marker}，图片 1` })).toBeVisible();
      await page.getByRole("button", { name: "放大", exact: true }).click();
      await expect(page.getByText("125%", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "关闭图片查看器" }).click();

      const commentMarker = `验收评论 ${Date.now()}`;
      await page.getByLabel("发表评论").fill(`${commentMarker}，用于确认评论写入、详情刷新和级联清理。`);
      await page.getByRole("button", { name: "发表评论" }).click();
      const publishedComment = page.getByText(commentMarker, { exact: false });
      await page.getByRole("button", { name: "正在发布" }).waitFor({ state: "visible", timeout: 3_000 }).catch(() => undefined);
      await expect(page.getByRole("button", { name: "发表评论" })).toBeEnabled({ timeout: 30_000 });
      if (!await publishedComment.isVisible().catch(() => false)) {
        const alerts = (await page.getByRole("alert").allTextContents().catch(() => [])).map((value) => value.trim()).filter(Boolean);
        if (alerts.length) throw new Error(`Comment publishing failed: ${alerts.join(" | ")}`);
        await page.reload();
      }
      await expect(publishedComment).toBeVisible({ timeout: 20_000 });

      const timelineMarker = `观点验证 ${Date.now()}`;
      await page.getByLabel("节点类型").selectOption("confirmed");
      await page.getByLabel("更新内容").fill(`${timelineMarker}，服务器应记录当前时间并保留历史节点。`);
      await page.getByRole("button", { name: "发布更新" }).click();
      await expect(page.getByText(timelineMarker, { exact: false })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("heading", { name: "判断验证" })).toBeVisible();

      await page.reload();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(marker);
      await expect(page.getByText(commentMarker, { exact: false })).toBeVisible();
      await expect(page.getByText(timelineMarker, { exact: false })).toBeVisible();

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
      await page.getByLabel("媒体引用 1").fill("https://x.com/wavekb/status/1");
      await page.getByRole("button", { name: "保存修改" }).click();
      await expect(page).toHaveURL(/\/community\/post\//, { timeout: 20_000 });
      const postArticle = page.locator("main > article");
      try {
        await expect(postArticle).toContainText("这篇验收帖子已经完成编辑", { timeout: 20_000 });
      } catch (error) {
        console.log("Edited destination diagnostic", JSON.stringify({
          url: page.url(),
          title: await page.title().catch(() => ""),
          main: (await page.locator("main").innerText().catch(() => "")).slice(0, 2_000),
        }));
        throw error;
      }
      console.log("Edited post diagnostic", JSON.stringify({
        article: (await postArticle.innerText().catch(() => "")).slice(0, 2_000),
      }));
      await expect(page.getByRole("heading", { name: "核心观点" })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("heading", { name: "TradingView 图表" })).toBeVisible();
      await expect(page.getByTitle("BINANCE:BTCUSDT TradingView 图表")).toHaveAttribute("src", /tradingview\.com/);
      await expect(page.getByRole("region", { name: /帖子图片/ })).toHaveCount(0);
      await expect(page.getByRole("link", { name: /查看原帖/ })).toHaveAttribute("href", "https://x.com/wavekb/status/1");
      await expect(page.getByText(timelineMarker, { exact: false })).toBeVisible();
    } finally {
      if (!published) {
        await page.goto("/community/idea_sharing").catch(() => undefined);
        const recoveredPost = page.getByRole("link", { name: marker, exact: true }).first();
        if (await recoveredPost.isVisible().catch(() => false)) {
          await recoveredPost.click();
          published = true;
        }
      }
      if (published) {
        const deletionResponses: Array<{ status: number; body: string }> = [];
        const recordDeletionResponse = async (response: import("@playwright/test").Response) => {
          if (response.request().method() !== "POST" || !new URL(response.url()).pathname.endsWith("/delete")) return;
          deletionResponses.push({ status: response.status(), body: (await response.text().catch(() => "")).slice(0, 500) });
        };
        page.on("response", recordDeletionResponse);
        const deleteButton = page.getByRole("button", { name: "删除帖子" });
        if (!await deleteButton.isVisible().catch(() => false)) await page.goBack().catch(() => undefined);
        page.once("dialog", (dialog) => dialog.accept());
        await page.getByRole("button", { name: "删除帖子" }).click();
        try {
          await expect(page).toHaveURL(/\/community\/idea_sharing$/, { timeout: 20_000 });
        } catch (error) {
          console.log("Post deletion diagnostic", JSON.stringify({
            url: page.url(),
            responses: deletionResponses,
            alert: await page.getByRole("alert").last().innerText().catch(() => ""),
            button: await page.getByRole("button", { name: /删除帖子|正在删除/ }).innerText().catch(() => ""),
          }));
          throw error;
        } finally {
          page.off("response", recordDeletionResponse);
        }
      }
      if (await accountMenu.isVisible().catch(() => false)) await accountMenu.click();
      await page.getByRole("button", { name: "退出登录" }).click();
      await expect(page).toHaveURL("/");
      await expect(page.getByRole("link", { name: "登录" })).toBeVisible();
    }
  });
});
