import { expect, test, type Page } from "@playwright/test";

async function holdLocalNextScripts(page: Page, baseUrl: URL) {
  // This deliberate fault is allowed only on a local server, never production.
  expect(["127.0.0.1", "localhost", "[::1]"]).toContain(baseUrl.hostname);
  const scriptUrl = (url: URL) => url.origin === baseUrl.origin
    && url.pathname.startsWith("/_next/static/") && url.pathname.endsWith(".js");
  let releaseScripts!: () => void;
  const ready = new Promise<void>((resolve) => { releaseScripts = resolve; });
  let delayedScripts = 0;
  await page.route(scriptUrl, async (route) => {
    delayedScripts += 1;
    await ready;
    await route.continue();
  });

  return {
    release: releaseScripts,
    count: () => delayedScripts,
    async dispose() {
      releaseScripts();
      await page.unroute(scriptUrl);
    },
  };
}

test.describe("local knowledge-search hydration resilience", () => {
  // A worker must not bypass the local script gate. Ordinary acceptance keeps
  // the real PWA enabled and does not delay JavaScript or substitute results.
  test.use({ serviceWorkers: "block" });

  test("the first book search after hydration reaches real page 57 with its query and focus", async ({ page }, testInfo) => {
    const scripts = await holdLocalNextScripts(page, new URL(String(testInfo.project.use.baseURL)));
    const path = "/knowledge/books/elliott-wave-principle-eleventh-edition";
    const query = "单锯齿形调整浪";
    try {
      // Inspect actual SSR controls while same-origin Next scripts are held.
      await page.goto(path, { waitUntil: "commit" });
      const search = page.getByRole("search", { name: "搜索本书", exact: true });
      const input = search.getByRole("searchbox", { name: "搜索本书", exact: true });
      await expect(input).toBeDisabled();
      await expect.poll(scripts.count).toBeGreaterThan(0);
      expect(new URL(page.url()).searchParams.has("q")).toBe(false);
      await expect(search.locator('a[href="#page-57"]')).toHaveCount(0);

      scripts.release();
      await expect(input).toBeEnabled();
      await input.fill(query);
      await expect(input).toHaveValue(query);
      await expect(page).toHaveURL((url) => url.pathname === path && url.searchParams.get("q") === query);
      const result = search.locator('a[href="#page-57"]');
      await expect(result).toContainText("第11版原书 PDF 第 57 页");
      await result.click();
      await expect(page).toHaveURL((url) => url.pathname === path && url.hash === "#page-57" && url.searchParams.get("q") === query);
      const target = page.locator("#page-57");
      await expect(target).toBeFocused();
      await expect(target).toContainText("牛市中的单锯齿形调整浪");
      await expect.poll(() => target.evaluate((element) => {
        const top = element.getBoundingClientRect().top;
        const headerBottom = Math.max(0, ...[...document.querySelectorAll("header")]
          .filter((header) => ["fixed", "sticky"].includes(getComputedStyle(header).position))
          .map((header) => header.getBoundingClientRect().bottom));
        return top >= headerBottom && top < innerHeight / 2;
      })).toBe(true);
    } finally {
      await scripts.dispose();
    }
  });

  test("the first library search after hydration returns the real main-book page link", async ({ page }, testInfo) => {
    const scripts = await holdLocalNextScripts(page, new URL(String(testInfo.project.use.baseURL)));
    try {
      await page.goto("/knowledge", { waitUntil: "commit" });
      const search = page.getByRole("region", { name: "搜索全部知识库", exact: true });
      const input = search.getByRole("searchbox", { name: "搜索知识标题和正文", exact: true });
      await expect(input).toBeDisabled();
      await expect.poll(scripts.count).toBeGreaterThan(0);
      await expect(search.getByRole("link")).toHaveCount(0);

      scripts.release();
      await expect(input).toBeEnabled();
      await input.fill("单锯齿形调整浪");
      await expect(input).toHaveValue("单锯齿形调整浪");
      const result = search.locator('a[href="/knowledge/books/elliott-wave-principle-eleventh-edition#page-57"]');
      await expect(result).toBeVisible();
      await expect(result).toContainText("第 57 页");
      await expect(result).toContainText("第11版原书文字层提取 · 未逐页核验");
    } finally {
      await scripts.dispose();
    }
  });
});
