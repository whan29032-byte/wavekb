import { expect, test, type Locator, type Page } from "@playwright/test";

const identifier = process.env.E2E_POSTING_IDENTIFIER;
const password = process.env.E2E_POSTING_PASSWORD;

async function login(page: Page) {
  await page.goto("/login?next=/member/33333");
  await page.getByLabel("邮箱或 UID").fill(identifier || "");
  await page.getByLabel("密码").fill(password || "");
  const responsePromise = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/auth/login");
  await page.getByRole("button", { name: "登录" }).click();
  const response = await responsePromise;
  expect(response.ok(), `Member shell login failed with ${response.status()}`).toBe(true);
  await expect(page).toHaveURL(/\/member\/33333$/);
}

async function expectReleased(window: Locator, handle: Locator, page: Page) {
  const start = await handle.boundingBox();
  expect(start).not.toBeNull();
  await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2);
  await page.mouse.down();
  await page.mouse.move(start!.x - 90, start!.y + 70, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  const released = await window.boundingBox();
  expect(released).not.toBeNull();
  await page.mouse.move(start!.x + 180, start!.y + 180, { steps: 5 });
  await page.waitForTimeout(80);
  const settled = await window.boundingBox();
  expect(settled).not.toBeNull();
  expect(Math.abs(settled!.x - released!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(settled!.y - released!.y)).toBeLessThanOrEqual(1);
}

test.describe("authenticated member shell acceptance", () => {
  test.skip(!identifier || !password, "Dedicated acceptance account is not configured.");

  test("profile hero, identity, friends and chat stay stable across production interactions", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page);

    const hero = page.locator("[data-profile-hero]");
    const avatar = page.locator("[data-profile-avatar] .identity-avatar-frame");
    const nameplate = page.locator("[data-profile-identity] .identity-nameplate");
    const actions = page.locator("[data-profile-actions]");
    await expect(hero).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(nameplate).toContainText("UID 33333");
    await expect(actions.getByRole("link", { name: "编辑资料" })).toHaveAttribute("href", "/member/profile");
    await expect(actions.getByRole("link", { name: "我的好友" })).toHaveAttribute("href", "/friends");
    await expect(actions.getByRole("link", { name: "交易工作台" })).toHaveAttribute("href", "/workbench");
    await expect(actions.getByRole("link", { name: "积分商城" })).toHaveCount(0);

    const desktopGeometry = await page.evaluate(() => {
      const coverBox = document.querySelector<HTMLElement>("[data-profile-cover]")!.getBoundingClientRect();
      const avatarBox = document.querySelector<HTMLElement>("[data-profile-avatar] .identity-avatar-frame")!.getBoundingClientRect();
      return { coverHeight: coverBox.height, coverBottom: coverBox.bottom, avatarTop: avatarBox.top, avatarBottom: avatarBox.bottom };
    });
    expect(desktopGeometry.coverHeight).toBeGreaterThanOrEqual(180);
    expect(desktopGeometry.coverHeight).toBeLessThanOrEqual(220);
    expect(desktopGeometry.avatarTop).toBeLessThan(desktopGeometry.coverBottom);
    expect(desktopGeometry.avatarBottom).toBeGreaterThan(desktopGeometry.coverBottom);

    const theme = await avatar.getAttribute("data-nameplate");
    expect(await nameplate.getAttribute("data-nameplate")).toBe(theme);
    if (theme !== "classic") {
      const animation = await page.evaluate(() => ({
        avatar: getComputedStyle(document.querySelector<HTMLElement>("[data-profile-avatar] .identity-avatar-frame")!).animationName,
        badge: getComputedStyle(document.querySelector<HTMLElement>("[data-profile-identity] .identity-nameplate")!).animationName,
      }));
      expect(animation.avatar).toContain("identity-border-flow");
      expect(animation.badge).toContain("identity-border-flow");
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector<HTMLElement>("[data-profile-identity] .identity-nameplate")!).animationName)).toBe("none");
      await page.emulateMedia({ reducedMotion: "no-preference" });
    }

    const navigation = page.getByRole("navigation", { name: "主导航" });
    await expect(navigation.getByRole("link", { name: "积分商城" })).toHaveAttribute("href", "/rewards");
    await expect(navigation.getByRole("link", { name: "工作台" })).toHaveCount(0);

    const friends = page.locator('[data-floating-window="friends"]');
    const friendsHandle = page.locator('[data-drag-handle="friends"]');
    await expect(friends).toBeVisible({ timeout: 20_000 });
    await expectReleased(friends, friendsHandle, page);

    const blurStart = await friendsHandle.boundingBox();
    expect(blurStart).not.toBeNull();
    await page.mouse.move(blurStart!.x + 50, blurStart!.y + 22);
    await page.mouse.down();
    await page.mouse.move(blurStart!.x - 55, blurStart!.y + 55, { steps: 4 });
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.waitForTimeout(80);
    const afterBlur = await friends.boundingBox();
    await page.mouse.move(blurStart!.x + 180, blurStart!.y + 180, { steps: 4 });
    const afterBlurMove = await friends.boundingBox();
    await page.mouse.up();
    expect(Math.abs(afterBlurMove!.x - afterBlur!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(afterBlurMove!.y - afterBlur!.y)).toBeLessThanOrEqual(1);

    const friendButton = friends.locator("[data-friend-row] button[aria-label$='聊天']").first();
    const conversation = friends.locator("[data-conversation-row]").first();
    expect(await friendButton.count() + await conversation.count(), "Acceptance user needs a real friend or recent conversation for chat drag coverage.").toBeGreaterThan(0);
    if (await friendButton.count()) await friendButton.click();
    else await conversation.click();

    const chat = page.locator('[data-floating-window="chat"]').first();
    const chatHandle = chat.locator('[data-drag-handle="chat"]');
    await expect(chat).toBeVisible({ timeout: 20_000 });
    await expectReleased(chat, chatHandle, page);

    for (const viewport of [
      { width: 1920, height: 1000 },
      { width: 1440, height: 900 },
      { width: 1280, height: 800 },
      { width: 1024, height: 768 },
      { width: 768, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(80);
      const overflow = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        windows: [...document.querySelectorAll<HTMLElement>("[data-floating-window]")].map((element) => {
          const box = element.getBoundingClientRect();
          return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
        }),
      }));
      expect(overflow.document).toBeLessThanOrEqual(1);
      for (const box of overflow.windows) {
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(viewport.width + 1);
        expect(box.top).toBeGreaterThanOrEqual(0);
        expect(box.bottom).toBeLessThanOrEqual(viewport.height + 1);
      }
    }
  });
});
