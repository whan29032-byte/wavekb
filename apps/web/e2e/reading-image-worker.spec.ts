import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const delivery: Record<string, string> = JSON.parse(readFileSync(new URL("../src/lib/knowledge/generated-reading-images.json", import.meta.url), "utf8"));
const originalPath = "/assets/figures-v10/page-043.png";
const imagePath = delivery[originalPath];
const bookPath = "/knowledge/core-full-book";
const offlineDocument = readFileSync(new URL("../public/offline.html", import.meta.url), "utf8");

type PartResponse = { range: string; status: number; contentRange: string };

function observeParts(context: BrowserContext) {
  const parts: PartResponse[] = [];
  context.on("response", (response) => {
    if (new URL(response.url()).pathname !== imagePath) return;
    const range = response.request().headers()["range"];
    if (!range) return;
    parts.push({ range, status: response.status(), contentRange: response.headers()["content-range"] || "" });
  });
  return parts;
}

async function readActualImage(page: Page) {
  const target = page.locator('[data-core-book-figure="assets/figures-v10/page-043.png"]');
  await target.scrollIntoViewIfNeeded();
  const image = target.locator("img");
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => ({
    complete: element.complete,
    width: element.naturalWidth,
    height: element.naturalHeight,
    path: element.currentSrc ? new URL(element.currentSrc).pathname : "",
  }))).toEqual({ complete: true, width: 1191, height: 1755, path: imagePath });
  expect(await image.getAttribute("src")).toBe(originalPath);
}

test.describe("real first-visit reading-worker delivery", () => {
  test.use({ serviceWorkers: "allow" });

  for (const shelf of ["/knowledge", "/knowledge/books"]) {
    test(`the ${shelf} shelf does not download unclicked books while its real client navigation completes`, async ({ page, context }, testInfo) => {
      const prefetches: string[] = [];
      const navigations: string[] = [];
      const origin = new URL(String(testInfo.project.use.baseURL)).origin;
      context.on("request", (request) => {
        const url = new URL(request.url());
        if (url.origin !== origin) return;
        if (request.headers()["next-router-prefetch"]) prefetches.push(request.url());
        if (url.pathname.startsWith("/knowledge") && request.isNavigationRequest()) navigations.push(url.pathname);
      });
      await page.goto(shelf);
      const books = page.getByRole("region", { name: "知识库图书", exact: true }).getByRole("link");
      // The landing shelf has a named section rather than the catalog's region.
      const supplement = shelf === "/knowledge/books" ? books.nth(1)
        : page.locator('[aria-labelledby="book-shelf-title"]').getByRole("link").nth(1);
      await expect(supplement).toHaveAttribute("href", "/knowledge/books/elliott-wave-principle-tenth-edition");
      await supplement.click();
      await expect(page.getByText("117 个已核验 Units", { exact: true })).toBeVisible();
      await expect(page).toHaveURL(/\/knowledge\/books\/elliott-wave-principle-tenth-edition$/);
      expect(navigations).toEqual([shelf]);
      expect(prefetches).toEqual([]);
    });
  }

  test("a fresh first visit acquires the controller and loads real verified range bytes", async ({ page, context }, testInfo) => {
    expect(context.serviceWorkers()).toHaveLength(0);
    const parts = observeParts(context);
    const unclickedSameOriginPrefetches: string[] = [];
    const origin = new URL(String(testInfo.project.use.baseURL)).origin;
    const offlineShellRequests: string[] = [];
    const separateWorkerHelpers: string[] = [];
    context.on("request", (request) => {
      if (new URL(request.url()).pathname === "/offline.html") offlineShellRequests.push(request.url());
      if (["/sw-policy.js", "/sw-reading-images.js"].includes(new URL(request.url()).pathname)) separateWorkerHelpers.push(request.url());
      if (new URL(request.url()).origin === origin && request.headers()["next-router-prefetch"]) {
        unclickedSameOriginPrefetches.push(request.url());
      }
    });
    // No interception or readiness sleep: scroll as soon as real SSR exists.
    await page.goto(bookPath, { waitUntil: "commit" });
    await readActualImage(page);
    expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(new URL("/sw.js", page.url()).href);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.range).toMatch(/^bytes=\d+-\d+$/);
      expect(part.status).toBe(206);
      expect(part.contentRange).toMatch(/^bytes \d+-\d+\/404664$/);
    }
    const workerStart = await page.evaluate((path) => {
      const entry = performance.getEntriesByName(new URL(path, location.href).href).at(-1) as PerformanceResourceTiming | undefined;
      return entry?.workerStart || 0;
    }, imagePath);
    expect(workerStart).toBeGreaterThan(0);
    expect(unclickedSameOriginPrefetches).toEqual([]);
    expect(offlineShellRequests).toEqual([]);
    expect(separateWorkerHelpers).toEqual([]);
    const cachedOffline = await page.evaluate(async () => {
      const response = await (await caches.open("wavekb-shell-v2")).match("/offline.html");
      return response ? { body: await response.text(), type: response.headers.get("content-type") } : null;
    });
    expect(cachedOffline).toEqual({ body: offlineDocument, type: "text/html; charset=utf-8" });
  });

  test("a second visit reuses the completed real image without downloading range parts again", async ({ page, context }) => {
    const parts = observeParts(context);
    await page.goto(bookPath);
    await readActualImage(page);
    expect(parts.length).toBeGreaterThan(1);
    const firstReadParts = parts.length;
    await page.goto("/knowledge/books");
    await page.goto(bookPath);
    await readActualImage(page);
    expect(parts).toHaveLength(firstReadParts);
    const transfer = await page.evaluate((path) => {
      const entry = performance.getEntriesByName(new URL(path, location.href).href).at(-1) as PerformanceResourceTiming | undefined;
      return entry ? { transfer: entry.transferSize, decoded: entry.decodedBodySize } : null;
    }, imagePath);
    expect(transfer?.decoded).toBeGreaterThan(0);
    expect(transfer?.transfer).toBe(0);
  });
});

test.describe("local browser without a reading worker", () => {
  test.use({ serviceWorkers: "block" });

  test("blocked workers fall back to a real ordinary image instead of waiting forever", async ({ page, context }, testInfo) => {
    // Blocking worker capability is a local resilience case, not a substitute
    // for the real-worker production performance acceptance above.
    const baseUrl = new URL(String(testInfo.project.use.baseURL));
    expect(["127.0.0.1", "localhost", "[::1]"]).toContain(baseUrl.hostname);
    const parts = observeParts(context);
    await page.goto(bookPath);
    await readActualImage(page);
    expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
    expect(parts).toEqual([]);
    expect(context.serviceWorkers()).toHaveLength(0);
    await expect(page.locator('[data-core-book-figure="assets/figures-v10/page-043.png"] [data-reading-image-state]')).toHaveAttribute("data-reading-image-state", "loaded");
  });

  test.describe("parser registration before hydration", () => {
    test.use({ serviceWorkers: "allow" });

    test("real worker registration begins while stylesheets and all Next hydration scripts are still held", async ({ page, context }, testInfo) => {
      expect(["127.0.0.1", "localhost", "[::1]"]).toContain(new URL(String(testInfo.project.use.baseURL)).hostname);
      expect(context.serviceWorkers()).toHaveLength(0);
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      let heldStylesheets = 0;
      let heldHydrationScripts = 0;
      await page.route((url) => url.pathname.startsWith("/_next/static/") && url.pathname.endsWith(".js"), async (route) => { heldHydrationScripts++; await held; await route.continue(); });
      await page.route((url) => url.pathname.startsWith("/_next/static/") && url.pathname.endsWith(".css"), async (route) => { heldStylesheets++; await held; await route.continue(); });
      try {
        await page.goto(bookPath, { waitUntil: "commit" });
        await expect(page.locator("#wavekb-pwa-bootstrap")).toHaveCount(1);
        // A real installed controller, not a mocked registration or timing flag.
        await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL))
          .toBe(new URL("/sw.js", page.url()).href);
        expect(context.serviceWorkers()).toHaveLength(1);
        expect(heldStylesheets).toBeGreaterThan(0);
        expect(heldHydrationScripts).toBeGreaterThan(0);
      } finally {
        release();
      }
    });
  });

  test.describe("viewport cancellation with a real worker", () => {
    test.use({ serviceWorkers: "allow" });

    test("an explicit reading target preempts an unfinished neighbor that remains visible", async ({ page, context }, testInfo) => {
      expect(["127.0.0.1", "localhost", "[::1]"]).toContain(new URL(String(testInfo.project.use.baseURL)).hostname);
      await page.setViewportSize({ width: 390, height: 1000 });
      const neighborSource = "/assets/figures-v10/page-047.png";
      const neighborPath = delivery[neighborSource];
      const parts = observeParts(context);
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      let heldNeighborParts = 0;
      await context.route((url) => url.pathname === neighborPath, async (route) => {
        if (route.request().serviceWorker() && route.request().headers()["range"]) {
          heldNeighborParts++;
          await held;
        }
        try { await route.continue(); } catch { /* Genuine target preemption may already have aborted this request. */ }
      });
      try {
        await page.goto(bookPath);
        const neighbor = page.locator('[data-core-book-figure="assets/figures-v10/page-047.png"]');
        await neighbor.evaluate((element) => { element.scrollIntoView({ block: "start" }); (element as HTMLElement).focus({ preventScroll: true }); });
        await expect.poll(() => heldNeighborParts).toBeGreaterThan(0);
        const target = page.locator('[data-core-book-figure="assets/figures-v10/page-043.png"]');
        await target.evaluate((element) => { element.scrollIntoView({ block: "start" }); (element as HTMLElement).focus({ preventScroll: true }); });
        expect(await neighbor.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return rect.bottom > 0 && rect.top < innerHeight;
        })).toBe(true);
        await readActualImage(page);
        expect(parts).toHaveLength(4);
        expect(parts.every((part) => part.status === 206)).toBe(true);
      } finally {
        release();
        await context.unrouteAll({ behavior: "wait" });
      }
    });

    for (const entry of ["direct", "home SPA"] as const) {
    test(`a new reading target completes while the offscreen previous image is still held after ${entry} entry`, async ({ page, context }, testInfo) => {
      expect(["127.0.0.1", "localhost", "[::1]"]).toContain(new URL(String(testInfo.project.use.baseURL)).hostname);
      const previousSource = "/assets/figures-v10/page-100.png";
      const previousPath = delivery[previousSource];
      expect(previousPath).toMatch(/\/assets\/reading-images\/[a-f0-9]{64}\.webp$/);
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      let heldParts = 0;
      const originalFallbacks: string[] = [];
      context.on("request", (request) => {
        if (new URL(request.url()).pathname === previousSource) originalFallbacks.push(request.url());
      });
      // A controlled local delay only. The visible target still uses actual
      // unmodified server bytes, the real worker and the original 5s assertion.
      await context.route(`**${previousPath}`, async (route) => {
        if (route.request().serviceWorker() && route.request().headers()["range"]) {
          heldParts++;
          await held;
        }
        try { await route.continue(); } catch { /* The actual viewport cancel may already have aborted it. */ }
      });
      try {
        if (entry === "home SPA") {
          await page.goto("/");
          await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL))
            .toBe(new URL("/sw.js", page.url()).href);
          const mobileMenu = page.getByRole("button", { name: "展开主导航" });
          const mobile = await mobileMenu.isVisible();
          if (mobile) await mobileMenu.click();
          const navigation = page.getByRole("navigation", { name: mobile ? "移动主导航" : "主导航", exact: true });
          await navigation.getByRole("link", { name: "知识库", exact: true }).click();
          await expect(page).toHaveURL(/\/knowledge$/);
          await page.locator('a[href="/knowledge/books/elliott-wave-principle-tenth-edition"]').click();
          await page.locator(`a[href="${bookPath}"]`).first().click();
          await expect(page).toHaveURL(new RegExp(`${bookPath}$`));
          // This is an actual Next SPA transition, not a second document load.
          expect(await page.evaluate(() => performance.getEntriesByType("navigation").map((entry) => new URL(entry.name).pathname))).toEqual(["/"]);
        } else {
          await page.goto(bookPath);
        }
        await page.locator(`[data-core-book-figure="${previousSource.slice(1)}"]`).scrollIntoViewIfNeeded();
        await expect.poll(() => heldParts).toBeGreaterThan(0);
        const parts = observeParts(context);
        await readActualImage(page);
        expect(parts).toHaveLength(4);
        expect(parts.every((part) => part.status === 206)).toBe(true);
        expect(parts.some((part) => part.range === "bytes=0-0")).toBe(false);
        expect(originalFallbacks).toEqual([]);
      } finally {
        release();
        await context.unrouteAll({ behavior: "wait" });
      }
    });
    }
  });
});
