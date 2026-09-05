import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // Local component fixtures only. Never call production services or save data.
  await page.route("**/*", (route) => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
});

for (const width of [320, 375, 768, 1440]) {
  test(`avatar remains above the cover at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/iframe.html?id=member-profile-editor--with-avatar&viewMode=story");
    const preview = page.getByRole("region", { name: "个人名片实时预览" });
    const avatar = preview.locator('img[alt*="头像"]');
    await expect(avatar).toBeVisible();
    await expect.poll(() => avatar.evaluate((img) => {
      const rect = img.getBoundingClientRect();
      return document.elementFromPoint(rect.x + rect.width / 2, rect.y + 8) === img;
    })).toBe(true);
    const frame = avatar.locator("..");
    await expect(frame).toHaveAttribute("data-nameplate", "blackgold");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("profile-preview.png"), fullPage: true });
  });
}

for (const width of [320, 375, 768]) {
  test(`appearance popup fits and dismisses at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 667 });
    await page.goto("/iframe.html?id=shell-site-header--default&viewMode=story");
    await page.getByLabel("网站外观", { exact: true }).click();
    const panel = page.getByRole("region", { name: "网站外观设置" });
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(8);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width - 8);
    expect(box!.y + box!.height).toBeLessThanOrEqual(667);
    await page.screenshot({ path: test.info().outputPath("appearance.png") });
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(page.getByLabel("网站外观", { exact: true })).toBeFocused();
    await page.getByLabel("网站外观", { exact: true }).click();
    await page.locator("body").click({ position: { x: 4, y: 650 } });
    await expect(panel).toBeHidden();
  });
}

test("mobile navigation exposes all global destinations without a workbench duplicate", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/iframe.html?id=shell-site-header--default&viewMode=story");
  await page.getByRole("button", { name: "展开主导航" }).click();
  const navigation = page.getByRole("navigation", { name: "移动主导航" });
  for (const [name, href] of [["知识库", "/knowledge"], ["社区", "/community/idea_sharing"], ["导师", "/mentors"], ["积分商城", "/rewards"]]) {
    await expect(navigation.getByRole("link", { name })).toBeVisible();
    await expect(navigation.getByRole("link", { name })).toHaveAttribute("href", href);
  }
  await expect(navigation.getByRole("link", { name: /工作台|个人空间/ })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("mobile-navigation.png") });
  await page.keyboard.press("Escape");
  await expect(navigation).toBeHidden();
});
