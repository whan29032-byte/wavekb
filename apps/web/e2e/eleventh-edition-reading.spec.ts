import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import type { KnowledgeData } from "@wavekb/knowledge";

// Read-only acceptance against independently compiled source metadata.
const data = JSON.parse(readFileSync(new URL("../../../packages/knowledge/src/knowledge.json", import.meta.url), "utf8")) as KnowledgeData;
const originalId = "elliott-wave-principle-eleventh-edition";
const comparisonId = "elliott-wave-principle-tenth-edition";
const path = `/knowledge/books/${originalId}`;
const book = data.library.books.find((entry) => entry.id === originalId)!;
const errors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const messages: string[] = [];
  errors.set(page, messages);
  page.on("pageerror", (error) => messages.push(error.message));
});
test.afterEach(async ({ page }) => expect(errors.get(page)).toEqual([]));

async function locatedPage(page: Page, number: number) {
  await expect(page).toHaveURL(new RegExp(`#page-${number}$`));
  const target = page.locator(`#page-${number}`);
  await expect(target).toBeFocused();
  expect(await target.evaluate((element) => {
    const top = element.getBoundingClientRect().top;
    const bottom = Math.max(0, ...[...document.querySelectorAll("header")].filter((header) => ["fixed", "sticky"].includes(getComputedStyle(header).position)).map((header) => header.getBoundingClientRect().bottom));
    return top >= bottom && top < innerHeight / 2;
  })).toBe(true);
}

test("eleventh edition is the main book and the old comparison URL remains available", async ({ page }) => {
  await page.goto("/knowledge/books");
  const shelf = page.getByRole("region", { name: "知识库图书", exact: true });
  const entries = shelf.locator(":scope > a");
  await expect(entries).toHaveCount(4);
  await expect(entries.nth(0)).toHaveAttribute("href", path);
  await expect(entries.nth(0)).toContainText("核心主书");
  await expect(entries.nth(1)).toHaveAttribute("href", `/knowledge/books/${comparisonId}`);
  await expect(entries.nth(1)).toContainText("第10版补充与版本对照");
  await entries.nth(1).click();
  await expect(page.getByText("117 个已核验 Units", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "本书内容", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "开始阅读", exact: true })).toHaveAttribute("href", "/knowledge/core-full-book");
  await page.goto("/knowledge");
  const search = page.getByRole("region", { name: "搜索全部知识库", exact: true });
  const input = search.getByRole("searchbox", { name: "搜索知识标题和正文" });
  await input.fill("浪二");
  const first = search.getByRole("link").first();
  await expect(first).toHaveAttribute("href", new RegExp(`^${path}#page-[1-9][0-9]*$`));
  await expect(first).toContainText("第11版原书文字层提取 · 未逐页核验");
  await input.fill("名义价格与定值价格应并行检查");
  const oldUnit = search.getByRole("link", { name: /名义价格与定值价格应并行检查/ });
  await expect(oldUnit).toHaveAttribute("href", "/knowledge/unit-ewp-method-nominal-vs-real");
  await expect(oldUnit).toContainText("补充与版本对照 · 第10版");
  await input.fill("词汇表：双重锯齿、等同、平台、推动与驱动");
  const mixed = search.getByRole("link", { name: /词汇表：双重锯齿、等同、平台、推动与驱动/ });
  await expect(mixed).toHaveAttribute("href", "/knowledge/unit-ewp-glossary-283");
  await expect(mixed).toContainText("补充与版本对照 · 第11版 / 第10版");
});

test("all 321 original pages have exact source metadata and no unopened original image is mounted", async ({ page }, testInfo) => {
  const sourceRequests: string[] = [];
  page.on("request", (request) => { if (/\/assets\/source-pages\/page-\d+\.png$/.test(new URL(request.url()).pathname)) sourceRequests.push(request.url()); });
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(book.title);
  await expect(page.getByRole("link", { name: "查看 第11版原书 PDF", exact: true })).toHaveAttribute("href", `/${book.pdf_path}`);
  await expect(page.getByText(/文字来自原书文本层，未逐页人工复核/)).toBeVisible();
  const pages = page.locator("#book-text > div > section[id^=page-]");
  await expect(pages).toHaveCount(321);
  expect(await pages.evaluateAll((entries) => entries.map((entry) => ({
    id: entry.id,
    source: entry.querySelector("[data-original-source-page]")?.getAttribute("data-source-id"),
    edition: entry.querySelector("[data-original-source-page]")?.getAttribute("data-edition"),
    originalPage: entry.querySelector("[data-original-source-page]")?.getAttribute("data-original-source-page"),
  })))).toEqual(book.text_pages.map((entry) => ({ id: `page-${entry.page}`, source: "ewp-11-zh-2021", edition: "11", originalPage: String(entry.page) })));
  await expect(page.locator("[data-original-source-page] img")).toHaveCount(0);
  await expect(page.locator("#book-text img")).toHaveCount(0);
  expect(sourceRequests).toEqual([]);
  await expect(page.locator("#core-chapters")).toHaveCount(0);
  const missing = await page.locator('main a[href^="#"]').evaluateAll((links) => links.filter((link) => !document.getElementById(decodeURIComponent((link as HTMLAnchorElement).hash.slice(1)))).map((link) => link.getAttribute("href")));
  expect(missing).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("eleventh-main-book.png") });
});

test("the exact eleventh original figure page loads on demand and Viewer returns focus after Escape", async ({ page }, testInfo) => {
  const number = 57;
  const source = book.text_pages[number - 1]!.source_image!;
  await page.goto(`${path}#page-${number}`);
  await locatedPage(page, number);
  const original = page.locator(`[data-original-source-page="${number}"]`);
  await expect(original.locator("img")).toHaveCount(0);
  const summary = original.locator("summary");
  expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(original).toHaveAttribute("open", "");
  const trigger = original.getByRole("button", { name: `放大查看：第11版原书 PDF 第 ${number} 页`, exact: true });
  const image = original.locator("img");
  await original.locator("[data-reading-image]").scrollIntoViewIfNeeded();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  expect(new URL((await image.getAttribute("src"))!, page.url()).pathname).toBe(`/${source.asset_path}`);
  await expect(original.locator("figcaption")).toContainText(`第11版原书原页 · PDF 第 ${number} 页 · ewp-11-zh-2021`);
  await original.screenshot({ path: testInfo.outputPath("eleventh-original-page-57.png") });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: `第11版原书 PDF 第 ${number} 页`, exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "关闭图片查看器", exact: true })).toBeFocused();
  expect(new URL((await dialog.locator("img").getAttribute("src"))!, page.url()).pathname).toBe(`/${source.asset_path}`);
  await dialog.getByRole("button", { name: "放大", exact: true }).click();
  await expect(dialog.locator("output")).toHaveText("125%");
  await page.screenshot({ path: testInfo.outputPath("eleventh-original-viewer.png") });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await summary.click();
  await expect(original.locator("img")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("original-book search reaches real text and page controls retain image-only pages", async ({ page }) => {
  await page.goto(path);
  const search = page.getByRole("search", { name: "搜索本书", exact: true });
  await search.getByRole("searchbox", { name: "搜索本书" }).fill("单锯齿形调整浪");
  const result = search.locator('a[href="#page-57"]');
  await expect(result).toContainText("第11版原书 PDF 第 57 页");
  await result.click();
  await locatedPage(page, 57);
  await expect(page.locator("#page-57")).toContainText("牛市中的单锯齿形调整浪");
  expect(new URL(page.url()).searchParams.get("q")).toBe("单锯齿形调整浪");
  await search.getByRole("searchbox", { name: "搜索本书" }).fill("本页无可提取文字");
  await expect(search.getByRole("status")).toContainText("没有找到匹配内容");
  const navigation = page.getByRole("navigation", { name: "本书导航", exact: true });
  await navigation.getByRole("textbox", { name: "跳至页码" }).fill("320");
  await navigation.getByRole("button", { name: "跳转", exact: true }).click();
  await locatedPage(page, 320);
  await expect(page.locator("#page-320")).toContainText("本页无可提取文字，请查看原页。");
  await expect(page.locator('#page-320 [data-original-source-page="320"]')).toHaveCount(1);
  await expect(navigation.getByRole("link", { name: /生成 · 第/ })).toHaveCount(7);
});
