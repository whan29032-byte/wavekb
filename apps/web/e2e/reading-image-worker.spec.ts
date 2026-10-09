import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const delivery: Record<string, string> = JSON.parse(readFileSync(new URL("../src/lib/knowledge/generated-reading-images.json", import.meta.url), "utf8"));
const originalPath = "/assets/figures-v10/page-043.png";
const imagePath = delivery[originalPath];
const bookPath = "/knowledge/core-full-book";

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

  test("a fresh first visit acquires the controller and loads real verified range bytes", async ({ page, context }) => {
    expect(context.serviceWorkers()).toHaveLength(0);
    const parts = observeParts(context);
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
});
