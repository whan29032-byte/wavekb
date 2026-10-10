import { expect, test } from "@playwright/test";

test("home exposes the knowledge and community paths", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("把波浪判断写清楚，也留下证据");
  await expect(page.getByRole("link", { name: "进入社区" })).toBeVisible();
  const mobileMenu = page.getByRole("button", { name: "展开主导航" });
  const isMobile = await mobileMenu.isVisible();
  if (isMobile) await mobileMenu.click();
  const navigation = page.getByRole("navigation", { name: isMobile ? "移动主导航" : "主导航", exact: true });
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole("link", { name: "积分商城" })).toHaveAttribute("href", "/rewards");
  await expect(page.getByRole("heading", { name: "X 波浪理论研究者" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Discord 波浪理论社区" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("appearance changes the full color system and survives reload", async ({ page }) => {
  await page.goto("/");
  const before = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--background"));
  await page.getByRole("button", { name: "网站外观", exact: true }).click();
  await page.getByRole("button", { name: /星夜紫/ }).click();
  const primary = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--theme-accent").trim());
  expect(primary).toBe("#6551a8");
  await page.getByRole("button", { name: "深色" }).click();
  const after = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--background"));
  expect(after).not.toBe(before);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-wavekb-theme", "star");
  await expect(page.locator("html")).toHaveAttribute("data-wavekb-mode", "dark");
});

test("unknown community boards return a real not-found page", async ({ page }) => {
  const response = await page.goto("/community/not-a-board");
  expect(response?.status()).toBe(404);
});

test("invalid boards remain 404 behind HTTPS termination without a loopback rewrite", async ({ request }) => {
  const response = await request.get("/community/not-a-board", { headers: { Host: "wavekb.com", "X-Forwarded-Proto": "https" } });
  expect(response.status()).toBe(404);
  expect(await response.text()).toContain("找不到这个社区板块");
});

test("public member profiles are anonymous-readable and protect social actions", async ({ page }) => {
  await page.goto("/member/33333");
  await expect(page).toHaveURL(/\/member\/33333$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("[data-profile-hero]")).toBeVisible();
  await expect(page.locator("[data-profile-identity] .identity-nameplate")).toContainText("UID 33333");
  const equippedStyle = await page.locator("[data-profile-identity] .identity-nameplate").getAttribute("data-nameplate");
  const ownPostCards = page.getByRole("region", { name: "公开研究", exact: true }).getByRole("article");
  for (const card of await ownPostCards.all()) await expect(card.locator('.identity-nameplate[aria-label="UID 33333"]')).toHaveAttribute("data-nameplate", equippedStyle!);
  const profileGeometry = await page.evaluate(() => {
    const cover = document.querySelector<HTMLElement>("[data-profile-cover]")!.getBoundingClientRect();
    const avatar = document.querySelector<HTMLElement>("[data-profile-avatar] .identity-avatar-frame")!.getBoundingClientRect();
    const overlapTarget = document.elementFromPoint(avatar.left + avatar.width / 2, Math.max(avatar.top + 8, cover.bottom - 8));
    return {
      coverHeight: cover.height,
      coverBottom: cover.bottom,
      avatarTop: avatar.top,
      avatarBottom: avatar.bottom,
      avatarOwnsOverlap: Boolean(overlapTarget?.closest("[data-profile-avatar]")),
    };
  });
  expect(profileGeometry.coverHeight).toBeGreaterThanOrEqual(180);
  expect(profileGeometry.coverHeight).toBeLessThanOrEqual(220);
  expect(profileGeometry.avatarTop).toBeLessThan(profileGeometry.coverBottom);
  expect(profileGeometry.avatarBottom).toBeGreaterThan(profileGeometry.coverBottom);
  expect(profileGeometry.avatarOwnsOverlap).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  const follow = page.getByRole("link", { name: "关注", exact: true });
  await expect(follow).toHaveAttribute("href", "/login?next=%2Fmember%2F33333");
  await follow.click();
  await expect(page).toHaveURL(/\/login\?next=%2Fmember%2F33333/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("登录 WaveKB");
});

test("account creation and recovery routes are available", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("link", { name: "创建账号" })).toBeVisible();
  await expect(page.getByRole("link", { name: "忘记密码" })).toBeVisible();
  await page.getByRole("link", { name: "创建账号" }).click();
  await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("加入 WaveKB");
  await expect(page.getByLabel("昵称")).toBeVisible();
  await page.goto("/recover");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("重置密码");
  await expect(page.getByLabel("注册邮箱")).toBeVisible();
});

test("UID activation API rejects anonymous requests", async ({ request }) => {
  const response = await request.get("/api/auth/uid-selection/status");
  expect(response.status()).toBe(401);
  await expect(response.json()).resolves.toEqual({ error: "登录状态已失效，请重新登录。" });
});

// Each route has its own budget and failure evidence; do not hide a late failure
// behind sixteen sequential navigations sharing one test timeout.
for (const route of [
  "/member/profile", "/friends", "/messages", "/workbench",
  "/workbench/entries/new", "/workbench/analysis/new?step=0", "/workbench/ai",
  "/tutoring", "/mentor/manage", "/tutoring/not-a-thread", "/rewards",
  "/admin/users", "/admin/rewards", "/admin/directory", "/admin/mentors", "/admin/ai",
  "/membership", "/admin/memberships",
]) {
  test(`anonymous access to ${route} remains private`, async ({ page }) => {
    await page.goto(route);
    await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(route)}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("登录 WaveKB");
  });
}

test("admin API rejects anonymous requests before contacting the gateway", async ({ request }) => {
  const response = await request.get("/api/admin/users");
  expect(response.status()).toBe(401);
  await expect(response.json()).resolves.toEqual({ error: "authentication_required" });
});

test("post deletion API rejects anonymous requests before contacting the gateway", async ({ request }) => {
  const response = await request.post("/api/community/posts/11111111-1111-4111-8111-111111111111/delete", { data: {} });
  expect(response.status()).toBe(401);
  await expect(response.json()).resolves.toEqual({ error: "authentication_required" });
});

test("AI API rejects anonymous requests before contacting the gateway", async ({ request }) => {
  const response = await request.get("/api/ai/user/ai-connections");
  expect(response.status()).toBe(401);
  await expect(response.json()).resolves.toEqual({ error: "authentication_required" });
});

test("mentor catalog is public and degrades safely without preview credentials", async ({ page }) => {
  await page.goto("/mentors");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/和导师一起拆解|导师专区尚未连接 Supabase/);
  await expect(page.getByText("导师确认收款后发放权益").or(page.getByText("配置预览环境后即可读取导师目录"))).toBeVisible();
});

test("knowledge search opens a fully migrated article", async ({ page }) => {
  await page.goto("/knowledge");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("知识库");
  await page.getByLabel("搜索知识标题和正文").fill("购买力指数");
  await page.getByRole("link", { name: /名义价格与定值价格应并行检查/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("名义价格与定值价格应并行检查");
  await expect(page.getByRole("heading", { name: "类型与使用边界" })).toBeVisible();
  await expect(page.getByText(/知识类型：METHOD/)).toBeVisible();
  await expect(page.getByText("原书来源", { exact: true })).toBeVisible();
  const sourceSummary = page.getByText(/查看第11版原书来源页/);
  await sourceSummary.click();
  const sourceImage = page.getByRole("button", { name: /放大查看：第11版原书来源/ }).first();
  await expect(sourceImage).toBeVisible();
  await sourceImage.click();
  await expect(page.getByRole("dialog", { name: /第11版原书来源/ })).toBeVisible();
  await page.getByRole("button", { name: "放大", exact: true }).click();
  await expect(page.getByText("125%", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: /第11版原书来源/ })).toHaveCount(0);
  const imageResponse = await page.request.get("/assets/source-pages/page-269.png");
  expect(imageResponse.status()).toBe(200);
  expect(imageResponse.headers()["content-type"]).toMatch(/^image\/png/);
});

test("extension shelf publishes the two supplied distillations with PDF MIME types", async ({ page }) => {
  await page.goto("/knowledge/books");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("知识库图书");
  await expect(page.locator('a[href="/knowledge/books/elliott-wave-natural-law"]')).toBeVisible();
  await expect(page.locator('a[href="/knowledge/books/chan-theory-complete"]')).toBeVisible();
  for (const title of ["艾略特波浪理论：自然法则", "缠中说禅 CHM 整本文集蒸馏"]) {
    const cover = page.getByRole("img", { name: `${title}封面`, exact: true });
    await cover.scrollIntoViewIfNeeded();
    await expect(cover).toBeVisible();
    await expect(cover).toHaveCSS("object-fit", "contain");
    await expect.poll(() => cover.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  }
  await page.locator('a[href="/knowledge/books/elliott-wave-natural-law"]').click();
  const naturalPdf = page.getByRole("link", { name: "查看 WaveKB 蒸馏 PDF" });
  await expect(naturalPdf).toHaveAttribute("href", "/assets/books/elliott-wave-natural-law-distilled.pdf");
  await expect(naturalPdf).toHaveAttribute("target", "_blank");
  const naturalResponse = await page.request.get("/assets/books/elliott-wave-natural-law-distilled.pdf");
  expect(naturalResponse.status()).toBe(200);
  expect(naturalResponse.headers()["content-type"]).toMatch(/^application\/pdf/);
  const chanResponse = await page.request.get("/assets/books/chan-theory-complete-distilled.pdf");
  expect(chanResponse.status()).toBe(200);
  expect(chanResponse.headers()["content-type"]).toMatch(/^application\/pdf/);
  await page.goto("/knowledge/books/chan-theory-complete");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("缠中说禅 CHM 整本文集蒸馏");
  await expect(page.getByRole("link", { name: "查看 WaveKB 蒸馏 PDF" })).toHaveAttribute("href", "/assets/books/chan-theory-complete-distilled.pdf");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.goto("/knowledge");
  await page.getByLabel("搜索知识标题和正文").fill("缠中说禅");
  const chanBookResult = page.getByRole("region", { name: "搜索全部知识库" }).locator('a[href="/knowledge/books/chan-theory-complete"]');
  await expect(chanBookResult).toHaveCount(1);
  await chanBookResult.click();
  await expect(page).toHaveURL(/\/knowledge\/books\/chan-theory-complete$/);
});
