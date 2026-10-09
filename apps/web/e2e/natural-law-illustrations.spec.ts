import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import type { KnowledgeData } from "@wavekb/knowledge";
const images: Record<string, string> = JSON.parse(readFileSync(new URL("../src/lib/knowledge/generated-reading-images.json", import.meta.url), "utf8"));

const data = JSON.parse(readFileSync(new URL("../../../packages/knowledge/src/knowledge.json", import.meta.url), "utf8")) as KnowledgeData;
const book = data.library.books.find((book) => book.id === "elliott-wave-natural-law")!;
const figures = book.text_pages.flatMap((page) => page.illustrations || []);
const reviewedPages = [5, 7, 8, 9, 11, 12, 16, 18, 21, 22, 23, 24, 26, 28];
const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => { const collected: string[] = []; errors.set(page, collected); page.on("pageerror", (error) => collected.push(error.message)); });
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); });

test("Natural Law: all 14 reviewed original image groups are in the right pages and load at native dimensions", async ({ page, request }, testInfo) => {
  test.setTimeout(60_000);
  expect(figures.map((figure) => figure.reading_page).sort((a, b) => a - b)).toEqual(reviewedPages);
  await page.goto(`/knowledge/books/${book.id}`);
  await expect(page.locator("[data-book-illustration]")).toHaveCount(14);
  await expect(page.locator("#page-14 [data-book-illustration], #page-17 [data-book-illustration]")).toHaveCount(0);
  for (const figure of figures) {
    const region = page.locator(`#page-${figure.reading_page} [data-book-illustration="${figure.id}"]`);
    await expect(region).toHaveCount(1);
    expect(await region.evaluate((element) => element.previousElementSibling?.textContent)).toBe(figure.after_heading);
    const image = region.locator("img");
    // Scroll the stable figure, not its not-yet-displayed deferred image.
    // Native dimensions, original URL, and the default 5s load gate stay exact.
    await region.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate((element) => element instanceof HTMLImageElement ? { complete: element.complete, width: element.naturalWidth, height: element.naturalHeight } : null)).toEqual({ complete: true, width: figure.width, height: figure.height });
    expect(new URL((await image.getAttribute("src"))!, page.url()).pathname).toBe(`/${figure.asset_path}`);
    expect(await image.evaluate((element: HTMLImageElement) => new URL(element.currentSrc).pathname)).toBe((images as Record<string, string>)[`/${figure.asset_path}`]);
    await expect(region.locator("figcaption")).toContainText(`图源 PDF ${figure.original_pdf_page} / 原书第 ${figure.original_book_page} 页`);
    const response = await request.get(`/${figure.asset_path}`, { headers: { range: "bytes=0-31" } });
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toMatch(/^image\/png/);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  const path = testInfo.outputPath("natural-law-zigzag-inline.png");
  await page.locator("#page-7").screenshot({ path });
  await testInfo.attach("natural-law-zigzag-inline.png", { path, contentType: "image/png" });
});

test("Natural Law: image zoom traps focus, uses touch-sized controls and returns to the reading position", async ({ page }, testInfo) => {
  await page.goto(`/knowledge/books/${book.id}#page-7`);
  const trigger = page.locator("#page-7 [data-book-illustration]").getByRole("button", { name: /放大查看/ });
  await trigger.scrollIntoViewIfNeeded(); await trigger.focus(); await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  const close = dialog.getByRole("button", { name: "关闭图片查看器" });
  await expect(close).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "缩小", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab"); await expect(close).toBeFocused();
  for (const button of await dialog.getByRole("button").all()) {
    const box = (await button.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await dialog.getByRole("button", { name: "放大", exact: true }).click();
  await expect(dialog.locator("output")).toHaveText("125%");
  const path = testInfo.outputPath("natural-law-image-viewer.png");
  await page.screenshot({ path }); await testInfo.attach("natural-law-image-viewer.png", { path, contentType: "image/png" });
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
  await expect(trigger).toBeInViewport();
});

test("Natural Law: cross-page grid and historical analogies retain honest evidence labels", async ({ page }) => {
  await page.goto(`/knowledge/books/${book.id}`);
  const grid = page.locator("#page-18 [data-book-illustration]");
  await expect(grid.locator("figcaption")).toContainText("制图网格");
  await expect(grid.locator("figcaption")).toContainText("蒸馏 PDF 图片页 17 / 正文页 18");
  await expect(page.locator("#page-26 [data-book-illustration] figcaption")).toContainText("类比");
  await expect(page.locator("#page-22")).toContainText("历史");
  await expect(page.locator("#page-18")).toContainText("图源：");
});
