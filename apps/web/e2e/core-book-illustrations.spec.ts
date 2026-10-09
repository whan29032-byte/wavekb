import { readFileSync } from "node:fs";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import type { KnowledgeAsset, KnowledgeData, KnowledgePage } from "@wavekb/knowledge";

// Read-only public book acceptance. Expected correspondence is constructed
// independently from compiled canonical Units, not from the UI planning helper.
const data = JSON.parse(readFileSync(new URL("../../../packages/knowledge/src/knowledge.json", import.meta.url), "utf8")) as KnowledgeData;
const fullBook = data.pages.find((page) => page.id === "core-full-book")!;
const paragraphs = fullBook.sections.find((section) => section.title === "完整解释")!.paragraphs;
const units = fullBook.source_unit_ids.map((id) => data.pages.find((page) => page.id === `unit-${id}`)!);
const pageErrors = new WeakMap<Page, string[]>();

function excerpts(unit: KnowledgePage) {
  return [...new Map(unit.primary_figures.filter((asset) => asset.source_id === "ewp-10-zh-2016"
    && asset.edition === 10 && asset.authority === "primary" && asset.figure_type === "original_source_excerpt")
    .map((asset) => [asset.asset_path, asset])).values()];
}

const seen = new Map<string, { unitId: string; anchorId: string }>();
const expected = paragraphs.map((text) => {
  const matches = units.filter((unit) => unit.kind === "core" && unit.generation_source === "canonical_units"
    && unit.source_unit_ids.length === 1 && unit.id === `unit-${unit.source_unit_ids[0]}`
    && unit.unit_types.length === 1 && text.startsWith(`${unit.title}（${unit.unit_types[0]}）\n`));
  if (matches.length !== 1) throw new Error(`Non-canonical or ambiguous full-book explanation: ${text.split("\n")[0]}`);
  const unit = matches[0];
  const figures = excerpts(unit).map((asset) => {
    const previous = seen.get(asset.asset_path);
    const first = previous || { unitId: unit.id, anchorId: `core-book-figure-${seen.size + 1}` };
    if (!previous) seen.set(asset.asset_path, first);
    return { asset, ...first, repeated: Boolean(previous) };
  });
  return { text, unit, figures };
});

function compact(value: string) { return value.replace(/\s+/g, ""); }

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

async function imageIsLoaded(page: Page, anchorId: string, asset: KnowledgeAsset) {
  const image = page.locator(`#${anchorId} img`);
  await image.scrollIntoViewIfNeeded();
  await expect.poll(() => image.evaluate((element) => element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0)).toBe(true);
  expect(new URL((await image.getAttribute("src"))!, page.url()).pathname).toBe(`/${asset.asset_path}`);
}

async function attachScreenshot(page: Page, anchorId: string, testInfo: TestInfo, filename: string) {
  await page.evaluate(() => document.fonts.ready);
  const path = testInfo.outputPath(filename);
  await page.locator(`#${anchorId}`).screenshot({ path });
  await testInfo.attach(filename, { path, contentType: "image/png" });
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page), "Core book text and figures must hydrate without browser errors").toEqual([]);
});

test("core full-book: every original page sits beside its exact canonical explanation and is displayed once", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  expect(expected).toHaveLength(117);
  expect(seen.size).toBeGreaterThan(20);
  await page.goto("/knowledge/core-full-book");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(fullBook.title);
  const explanation = page.getByRole("region", { name: "完整解释", exact: true });
  const blocks = explanation.locator("[data-reading-explanation]");
  await expect(blocks).toHaveCount(117);
  const rendered = await blocks.evaluateAll((elements) => elements.map((element) => ({
    unitId: element.getAttribute("data-source-unit-id"),
    text: element.querySelector(":scope > p")?.textContent || "",
    titleHref: element.querySelector(":scope > p > a")?.getAttribute("href"),
    displayed: [...element.querySelectorAll("[data-core-book-figure]")].map((figure) => ({
      path: figure.getAttribute("data-core-book-figure"), id: figure.id,
      sourceId: figure.getAttribute("data-source-id"), edition: figure.getAttribute("data-edition"),
      authority: figure.getAttribute("data-authority"), type: figure.getAttribute("data-figure-type"),
      imagePath: new URL(figure.querySelector("img")!.getAttribute("src")!, window.location.href).pathname,
      caption: figure.querySelector("figcaption")?.textContent || "",
    })),
    references: [...element.querySelectorAll("[data-core-book-figure-reference]")].map((link) => ({
      path: link.getAttribute("data-core-book-figure-reference"), href: link.getAttribute("href"),
      targetPath: document.getElementById(link.getAttribute("href")!.slice(1))?.getAttribute("data-core-book-figure"),
    })),
  })));
  expected.forEach((item, index) => {
    const actual = rendered[index];
    expect(actual.unitId).toBe(item.unit.id);
    expect(compact(actual.text)).toBe(compact(item.text));
    expect(actual.titleHref).toBe(`/knowledge/${item.unit.id}`);
    const first = item.figures.filter((figure) => !figure.repeated);
    expect(actual.displayed.map((figure) => ({ path: figure.path, id: figure.id }))).toEqual(first.map((figure) => ({ path: figure.asset.asset_path, id: figure.anchorId })));
    first.forEach((figure, assetIndex) => {
      const actualFigure = actual.displayed[assetIndex];
      expect(actualFigure).toMatchObject({ sourceId: "ewp-10-zh-2016", edition: "10", authority: "primary", type: "original_source_excerpt", imagePath: `/${figure.asset.asset_path}` });
      expect(actualFigure.caption).toContain("第10版原页摘录");
      expect(actualFigure.caption).toContain(`PDF 第 ${figure.asset.pdf_page} 页`);
    });
    expect(actual.references).toEqual(item.figures.filter((figure) => figure.repeated).map((figure) => ({ path: figure.asset.asset_path, href: `#${figure.anchorId}`, targetPath: figure.asset.asset_path })));
  });
  await expect(explanation.locator("img")).toHaveCount(seen.size);
  await expect(page.getByRole("region", { name: "快速答案", exact: true }).locator("img")).toHaveCount(0);
  await expect(explanation.locator('[data-edition="11"], [data-authority="supplement"], img[src*="figures-v11"]')).toHaveCount(0);
  await page.getByText("查看本页知识目录（117）", { exact: true }).click();
  await expect(page.getByRole("navigation", { name: "本页知识目录", exact: true }).getByRole("link")).toHaveCount(117);
  await expect(page.getByRole("region", { name: "快速答案", exact: true }).getByRole("link")).toHaveCount(117);
  const first = expected.flatMap((item) => item.figures).find((figure) => !figure.repeated && figure.asset.pdf_page === 43)!;
  await imageIsLoaded(page, first.anchorId, first.asset);
  await noHorizontalOverflow(page);
  await attachScreenshot(page, first.anchorId, testInfo, "core-original-page-43.png");
});

test("core full-book: an original excerpt opens, zooms, closes with Escape, and returns focus", async ({ page }, testInfo) => {
  const first = expected.flatMap((item) => item.figures).find((figure) => !figure.repeated)!;
  await page.goto("/knowledge/core-full-book");
  await imageIsLoaded(page, first.anchorId, first.asset);
  const trigger = page.locator(`#${first.anchorId}`).getByRole("button", { name: /放大查看/ });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "关闭图片查看器", exact: true })).toBeFocused();
  expect(new URL((await dialog.locator("img").getAttribute("src"))!, page.url()).pathname).toBe(`/${first.asset.asset_path}`);
  await dialog.getByRole("button", { name: "放大", exact: true }).click();
  await expect(dialog.locator("output")).toHaveText("125%");
  await noHorizontalOverflow(page);
  const path = testInfo.outputPath("core-original-page-viewer.png");
  await page.screenshot({ path });
  await testInfo.attach("core-original-page-viewer.png", { path, contentType: "image/png" });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await noHorizontalOverflow(page);
});

test("core full-book: a shared-page link really locates the original image below the fixed header", async ({ page }) => {
  const later = expected.find((item) => item.figures.some((figure) => figure.repeated))!;
  const shared = later.figures.find((figure) => figure.repeated)!;
  await page.goto("/knowledge/core-full-book");
  const link = page.locator(`[data-source-unit-id="${later.unit.id}"]`).locator(`[data-core-book-figure-reference="${shared.asset.asset_path}"]`);
  await link.scrollIntoViewIfNeeded();
  expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`#${shared.anchorId}$`));
  const target = page.locator(`#${shared.anchorId}`);
  await expect(target).toBeFocused();
  await expect(target).toHaveAttribute("data-core-book-figure", shared.asset.asset_path);
  expect(new URL((await target.locator("img").getAttribute("src"))!, page.url()).pathname).toBe(`/${shared.asset.asset_path}`);
  const position = await target.evaluate((element) => {
    const top = element.getBoundingClientRect().top;
    const headers = [...document.querySelectorAll("header")].filter((header) => ["sticky", "fixed"].includes(getComputedStyle(header).position));
    const headerBottom = Math.max(0, ...headers.map((header) => header.getBoundingClientRect().bottom));
    return { top, headerBottom, viewportHeight: innerHeight };
  });
  expect(position.top).toBeGreaterThanOrEqual(position.headerBottom);
  expect(position.top).toBeLessThan(position.viewportHeight / 2);
  await imageIsLoaded(page, shared.anchorId, shared.asset);
  await noHorizontalOverflow(page);
});
