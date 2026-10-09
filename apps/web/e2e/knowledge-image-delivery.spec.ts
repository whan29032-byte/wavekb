import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { KnowledgeData } from "@wavekb/knowledge";
const delivery: Record<string, string> = JSON.parse(readFileSync(new URL("../src/lib/knowledge/generated-reading-images.json", import.meta.url), "utf8"));
const corePng = "/assets/figures-v10/page-043.png";
const coreWebp = delivery[corePng];
const knowledge = JSON.parse(readFileSync(new URL("../../../packages/knowledge/src/knowledge.json", import.meta.url), "utf8")) as KnowledgeData;
const natural = knowledge.library.books.find((book) => book.id === "elliott-wave-natural-law")!;
const figure = natural.text_pages.flatMap((page) => page.illustrations || []).find((entry) => entry.reading_page === 7)!;

test("cold reading requests the actual visible lossless image, not a queue of offscreen original scans", async ({ page }) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/assets/reading-images/") || path.startsWith("/assets/figures-v10/")) requests.push(path);
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/knowledge/core-full-book");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(requests).toEqual([]);
  const target = page.locator('[data-core-book-figure="assets/figures-v10/page-043.png"]');
  await target.scrollIntoViewIfNeeded();
  const image = target.locator("img");
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => ({
    complete: element.complete, width: element.naturalWidth, height: element.naturalHeight,
    path: element.currentSrc ? new URL(element.currentSrc).pathname : "",
  }))).toEqual({ complete: true, width: 1191, height: 1755, path: coreWebp });
  expect(requests.filter((path) => path.startsWith("/assets/figures-v10/"))).toEqual([]);
  // A viewport may touch a neighboring figure, but not the old six-scan queue.
  expect(new Set(requests).size).toBeLessThanOrEqual(2);
  expect(errors).toEqual([]);
});

test("a second reading uses real cached image bytes without another body transfer", async ({ page }) => {
  const read = async () => {
    const target = page.locator('[data-core-book-figure="assets/figures-v10/page-043.png"]');
    await target.scrollIntoViewIfNeeded();
    await expect.poll(() => target.locator("img").evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth === 1191)).toBe(true);
  };
  await page.goto("/knowledge/core-full-book");
  await read();
  await page.goto("/knowledge/books");
  await page.goto("/knowledge/core-full-book");
  await read();
  const transfer = await page.evaluate((path) => {
    const entry = performance.getEntriesByName(new URL(path, location.href).href).at(-1) as PerformanceResourceTiming | undefined;
    return entry ? { transfer: entry.transferSize, decoded: entry.decodedBodySize } : null;
  }, coreWebp);
  expect(transfer?.decoded).toBeGreaterThan(0);
  expect(transfer?.transfer).toBe(0);
});

test("original figures are still readable without JavaScript", async ({ browser }, testInfo) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL: testInfo.project.use.baseURL, viewport: testInfo.project.use.viewport });
  try {
    const page = await context.newPage();
    await page.goto(`/knowledge/books/${natural.id}#page-7`);
    const image = page.locator(`#${figure.id} img`);
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => ({ complete: element.complete, width: element.naturalWidth, height: element.naturalHeight }))).toEqual({ complete: true, width: figure.width, height: figure.height });
    expect(await image.getAttribute("src")).toBe(`/${figure.asset_path}`);
    expect(await image.evaluate((element: HTMLImageElement) => new URL(element.currentSrc).pathname)).toBe(`/${figure.asset_path}`);
  } finally {
    await context.close();
  }
});

test("only existing content-addressed images are immutable; original files and 404s are not", async ({ request }) => {
  const optimized = await request.get(coreWebp, { headers: { range: "bytes=0-31" } });
  expect(optimized.status()).toBe(206);
  expect(optimized.headers()["content-type"]).toMatch(/^image\/webp/);
  expect(optimized.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
  expect((await optimized.body()).byteLength).toBe(32);
  for (const path of [corePng, "/assets/books/elliott-wave-principle-eleventh-edition.pdf"]) {
    const original = await request.get(path, { headers: { range: "bytes=0-31" } });
    expect(original.status()).toBe(206);
    expect(original.headers()["cache-control"]).toBe("public, max-age=0");
  }
  const missing = await request.get(`/assets/reading-images/${"f".repeat(64)}.webp`);
  expect(missing.status()).toBe(404);
  expect(missing.headers()["cache-control"] || "").not.toContain("immutable");
});

test.describe("explicit download failure recovery", () => {
  // PWA cache-first responses bypass page-level interception. Disable the
  // worker only for this injected-error case, not normal production acceptance.
  test.use({ serviceWorkers: "block" });

test("a failed delivery image falls back to the real original in both reading and zoom without losing focus", async ({ page }) => {
  // Explicit fault injection only for this resilience test. The normal cold,
  // native-dimension and cache acceptance cases above never mock image traffic.
  let injectedFailures = 0;
  await page.route(/\/assets\/reading-images\/[a-f0-9]{64}\.webp$/, async (route) => {
    injectedFailures += 1;
    await route.abort("failed");
  });
  await page.goto("/knowledge/books/elliott-wave-principle-eleventh-edition#page-57");
  const original = page.locator('[data-original-source-page="57"]');
  await original.locator("summary").click();
  await original.locator("[data-reading-image]").scrollIntoViewIfNeeded();
  const sourcePath = "/assets/source-pages/page-057.png";
  await expect.poll(() => original.locator("img").evaluate((element: HTMLImageElement) => ({
    complete: element.complete, width: element.naturalWidth, height: element.naturalHeight,
    path: element.currentSrc ? new URL(element.currentSrc).pathname : "",
  }))).toEqual({ complete: true, width: 1323, height: 1872, path: sourcePath });
  const trigger = original.getByRole("button", { name: /放大查看/ });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect.poll(() => dialog.locator("img").evaluate((element: HTMLImageElement) => ({
    complete: element.complete, width: element.naturalWidth, height: element.naturalHeight,
    path: element.currentSrc ? new URL(element.currentSrc).pathname : "",
  }))).toEqual({ complete: true, width: 1323, height: 1872, path: sourcePath });
  await expect(dialog.locator("source")).toHaveCount(0);
  expect(injectedFailures).toBeGreaterThanOrEqual(2);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
});
