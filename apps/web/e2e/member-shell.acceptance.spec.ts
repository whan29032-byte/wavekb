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
  test.describe.configure({ retries: 0 });
  test.skip(!identifier || !password, "Dedicated acceptance account is not configured.");

  test("profile opens floating friends and chat without changing the current route", async ({ page }) => {
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
    await expect(actions.getByRole("button", { name: "我的好友" })).toBeVisible();
    await expect(actions.getByRole("link", { name: "交易工作台" })).toHaveAttribute("href", "/workbench");
    await expect(actions.getByRole("link", { name: "积分商城" })).toHaveCount(0);

    const friends = page.locator('[data-floating-window="friends"]');
    if (await friends.isVisible()) await friends.getByRole("button", { name: "关闭" }).click();
    await expect(friends).toHaveCount(0);
    const profileUrl = page.url();
    const friendsResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/member/friends" && url.searchParams.get("desktop") === "1";
    });
    await actions.getByRole("button", { name: "我的好友" }).click();
    await expect(page).toHaveURL(profileUrl);
    await expect(friends).toBeVisible({ timeout: 10_000 });
    const friendsResponse = await friendsResponsePromise;
    expect(friendsResponse.status(), `Floating friendship API failed with ${friendsResponse.status()}: ${await friendsResponse.text()}`).toBe(200);
    await expect(friends.getByRole("link", { name: "完整管理" })).toHaveAttribute("href", "/friends");

    const desktopGeometry = await page.evaluate(() => {
      const coverBox = document.querySelector<HTMLElement>("[data-profile-cover]")!.getBoundingClientRect();
      const avatarBox = document.querySelector<HTMLElement>("[data-profile-avatar] .identity-avatar-frame")!.getBoundingClientRect();
      const overlapTarget = document.elementFromPoint(avatarBox.left + avatarBox.width / 2, Math.max(avatarBox.top + 8, coverBox.bottom - 8));
      return {
        coverHeight: coverBox.height,
        coverBottom: coverBox.bottom,
        avatarTop: avatarBox.top,
        avatarBottom: avatarBox.bottom,
        avatarOwnsOverlap: Boolean(overlapTarget?.closest("[data-profile-avatar]")),
      };
    });
    expect(desktopGeometry.coverHeight).toBeGreaterThanOrEqual(180);
    expect(desktopGeometry.coverHeight).toBeLessThanOrEqual(220);
    expect(desktopGeometry.avatarTop).toBeLessThan(desktopGeometry.coverBottom);
    expect(desktopGeometry.avatarBottom).toBeGreaterThan(desktopGeometry.coverBottom);
    expect(desktopGeometry.avatarOwnsOverlap).toBe(true);

    const theme = await avatar.getAttribute("data-nameplate");
    expect(theme).not.toBeNull();
    expect(await nameplate.getAttribute("data-nameplate")).toBe(theme);
    const headerNameplates = page.getByRole("navigation", { name: "主导航" }).locator('.identity-nameplate[aria-label="UID 33333"]');
    // A missing account identity is a failure, not a reason to skip comparison.
    await expect(headerNameplates.first()).toHaveAttribute("data-nameplate", theme!, { timeout: 15_000 });
    for (const badge of await headerNameplates.all()) await expect(badge).toHaveAttribute("data-nameplate", theme!);
    if ((page.viewportSize()?.width ?? 0) >= 768) await expect(headerNameplates.locator("visible=true").first()).toBeVisible();
    const ownPostCards = page.getByRole("region", { name: "我的公开研究", exact: true }).getByRole("article");
    for (const card of await ownPostCards.all()) {
      await expect(card.locator('.identity-nameplate[aria-label="UID 33333"]')).toHaveAttribute("data-nameplate", theme!);
    }
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

    const friendButton = friends.locator("[data-friend-row]").first();
    const conversation = friends.locator("[data-conversation-row]").first();
    expect(await friendButton.count() + await conversation.count(), "Acceptance user needs a real friend or recent conversation for chat drag coverage.").toBeGreaterThan(0);
    const chatRoute = page.url();
    if (await friendButton.count()) await friendButton.click();
    else await conversation.click();

    const chat = page.locator('[data-floating-window="chat"]').first();
    const chatHandle = chat.locator('[data-drag-handle="chat"]');
    await expect(chat).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(chatRoute);
    await expectReleased(chat, chatHandle, page);

    // Chat windows intentionally sit above the friend panel. After dragging,
    // its composer can cover the management link; use the visible window control
    // to uncover it instead of clicking through another window.
    await chat.getByRole("button", { name: "最小化", exact: true }).click();
    await expect(chat).toHaveAttribute("data-minimized", "true");
    await expect(chat.locator("textarea")).toHaveCount(0);
    const persistentWindows = await page.evaluateHandle(() => Array.from(document.querySelectorAll("[data-floating-window]")));

    // A client-side route change must not resubscribe an already joined presence
    // channel or unmount the global friend/chat windows.
    await friends.getByRole("link", { name: "完整管理" }).click();
    await expect(page).toHaveURL(/\/friends$/);
    await expect(page.locator("[data-friends-directory]")).toHaveAttribute("data-load-state", "ready");
    await expect(friends).toBeVisible();
    await expect(chat).toBeVisible();
    expect(await persistentWindows.evaluate((windows) => windows.every((window) => window.isConnected)), "Client navigation must preserve the original floating window nodes.").toBe(true);
    await persistentWindows.dispose();
    await expect(chat).toHaveAttribute("data-minimized", "true");
    await chat.getByRole("button", { name: "最小化", exact: true }).click();
    await expect(chat).not.toHaveAttribute("data-minimized", "true");
    await expect(chat.locator("textarea")).toBeVisible();
    await expect(page.getByRole("heading", { name: "好友列表暂时无法读取" })).toHaveCount(0);

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

  test("complete friend management keeps production auth across reload and a new tab", async ({ page, context }) => {
    test.setTimeout(120_000);
    await login(page);

    const waitForDirectoryApi = (target: Page) => target.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/member/friends" && !url.searchParams.has("desktop");
    });
    let responsePromise = waitForDirectoryApi(page);
    await page.goto("/friends");
    let response = await responsePromise;
    expect(response.status(), `Friendship API failed with ${response.status()}.`).toBe(200);
    let payload = await response.json() as { count?: number };
    expect(Number(payload.count), "Acceptance user should retain real friendship rows.").toBeGreaterThan(0);
    const directory = page.locator("[data-friends-directory]");
    await expect(directory).toHaveAttribute("data-load-state", "ready", { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "好友列表暂时无法读取" })).toHaveCount(0);

    responsePromise = waitForDirectoryApi(page);
    await page.reload();
    response = await responsePromise;
    expect(response.status()).toBe(200);
    payload = await response.json() as { count?: number };
    expect(Number(payload.count), "Friendship rows should survive a direct reload.").toBeGreaterThan(0);
    await expect(page).toHaveURL(/\/friends$/);

    const secondPage = await context.newPage();
    const secondResponsePromise = waitForDirectoryApi(secondPage);
    await secondPage.goto("/friends", { waitUntil: "domcontentloaded" });
    const secondResponse = await secondResponsePromise;
    expect(secondResponse.status()).toBe(200);
    const secondPayload = await secondResponse.json() as { count?: number };
    expect(Number(secondPayload.count), "The shared session should expose real friendships in a new tab.").toBeGreaterThan(0);
    await expect(secondPage).toHaveURL(/\/friends$/);
  });
});

test("logged-out complete friend management redirects to login instead of an error boundary", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/friends");
  await expect(page).toHaveURL(/\/login\?next=%2Ffriends$/);
  await expect(page.getByRole("heading", { name: "好友列表暂时无法读取" })).toHaveCount(0);
});
