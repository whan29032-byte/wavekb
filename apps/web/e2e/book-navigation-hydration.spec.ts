import { expect, test } from "@playwright/test";

test.describe("local page-navigation hydration resilience", () => {
  // This is the only deliberate JavaScript-delay case. Service Workers must not
  // bypass the page's fault-injection routes; normal acceptance keeps real PWA.
  test.use({ serviceWorkers: "block" });

  test("SSR page controls wait for hydration and the first real submission is not lost", async ({ page }, testInfo) => {
    const baseUrl = new URL(String(testInfo.project.use.baseURL));
    // Fault injection is explicitly restricted to the local built test server.
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

    try {
      // Commit allows inspection of real SSR HTML while its scripts are held.
      await page.goto("/knowledge/books/elliott-wave-natural-law", { waitUntil: "commit" });
      const navigation = page.getByRole("navigation", { name: "本书导航", exact: true });
      const input = navigation.getByRole("textbox", { name: "跳至页码", exact: true });
      const submit = navigation.getByRole("button", { name: "跳转", exact: true });
      await expect(input).toBeDisabled();
      await expect(submit).toBeDisabled();
      await expect.poll(() => delayedScripts).toBeGreaterThan(0);
      expect(new URL(page.url()).hash).toBe("");

      releaseScripts();
      await expect(input).toBeEnabled();
      await expect(submit).toBeEnabled();
      await input.fill("20");
      await expect(input).toHaveValue("20");
      await submit.click();
      await expect(page).toHaveURL(/#page-20$/);
      const target = page.locator("#page-20");
      await expect(target).toBeFocused();
      await expect(target.locator("p, ul, ol, table").first()).not.toBeEmpty();
      await expect.poll(() => target.evaluate((element) => {
        const headerBottom = document.querySelector("body > header")?.getBoundingClientRect().bottom ?? 65;
        const top = element.getBoundingClientRect().top;
        return top >= headerBottom + 8 && top < innerHeight / 2;
      })).toBe(true);
      await expect(navigation.getByRole("alert")).toHaveCount(0);
    } finally {
      releaseScripts();
      await page.unroute(scriptUrl);
    }
  });
});
