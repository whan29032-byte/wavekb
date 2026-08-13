import { expect, test } from "@playwright/test";

const identifier = process.env.E2E_POSTING_IDENTIFIER;
const password = process.env.E2E_POSTING_PASSWORD;

test.describe("authenticated posting acceptance", () => {
  test.skip(!identifier || !password, "Dedicated acceptance account is not configured.");

  test("login, publish and reopen a text post", async ({ page }) => {
    await page.goto("/login?next=/community/idea_sharing/new");
    await page.getByLabel("邮箱或 UID").fill(identifier || "");
    await page.getByLabel("密码").fill(password || "");
    await page.getByRole("button", { name: "登录" }).click();
    await expect(page).toHaveURL(/\/community\/idea_sharing\/new/);

    const marker = `验收发帖 ${Date.now()}`;
    let published = false;
    try {
      await page.getByLabel("标题").fill(marker);
      await page.getByLabel("正文").fill("这是一篇由 Playwright 专用账号创建的验收帖子，用于确认发布和详情读取链路。 ");
      await page.getByRole("button", { name: "发布内容" }).click();
      await expect(page).toHaveURL(/\/community\/post\//);
      published = true;
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(marker);

      await page.getByRole("link", { name: "编辑帖子" }).click();
      await page.getByLabel("正文").fill("这篇验收帖子已经完成编辑，用于确认作者修改链路和详情页刷新。 ");
      await page.getByRole("button", { name: "保存修改" }).click();
      await expect(page.getByText("这篇验收帖子已经完成编辑")).toBeVisible();
    } finally {
      if (published) {
        const deleteButton = page.getByRole("button", { name: "删除帖子" });
        if (!await deleteButton.isVisible().catch(() => false)) await page.goBack().catch(() => undefined);
        page.once("dialog", (dialog) => dialog.accept());
        await page.getByRole("button", { name: "删除帖子" }).click();
        await expect(page).toHaveURL(/\/community\/idea_sharing$/);
      }
    }
  });
});
