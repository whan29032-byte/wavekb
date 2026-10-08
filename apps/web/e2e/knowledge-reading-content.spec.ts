import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import type { KnowledgeData, KnowledgePage } from "@wavekb/knowledge";
import { parseKnowledgeBookText, type ReadingBlock } from "../src/lib/knowledge/reading-text";

// This suite only reads public pages. Each extension book is loaded once, then
// all of its page sections are inspected in that DOM (not 61 separate requests).
const data = JSON.parse(readFileSync(new URL("../../../packages/knowledge/src/knowledge.json", import.meta.url), "utf8")) as KnowledgeData;
const pagesById = new Map(data.pages.map((page) => [page.id, page]));
const pageErrors = new WeakMap<Page, string[]>();

function publicPage(id: string): KnowledgePage {
  const page = pagesById.get(id);
  if (!page) throw new Error(`Missing compiled public knowledge page: ${id}`);
  return page;
}

function compact(text: string) {
  return text.replace(/\s+/g, "");
}

function normalizedBlocks(blocks: ReadingBlock[]): ReadingBlock[] {
  return blocks.map((block) => {
    if (block.kind === "table") return { ...block, headers: block.headers.map(compact), rows: block.rows.map((row) => row.map(compact)) };
    if (block.kind === "list") return { ...block, items: block.items.map((item) => ({ ...item, text: compact(item.text) })) };
    return { ...block, text: compact(block.text) };
  });
}

// Independent of the production parser: remove only the reviewed structural
// syntax, not math signs, wave labels, decimal numbers, or ordinary punctuation.
function sourceSemantics(text: string) {
  return compact(text.split(/\r?\n/).flatMap((line) => {
    const value = line.trim();
    if (/^\|(?:\s*:?-{3,}:?\s*\|)+$/.test(value)) return [];
    if (value.startsWith("|") && value.endsWith("|")) return [value.slice(1, -1).split("|").join("")];
    if (/^#{2,4}\s+/.test(value)) return [value.replace(/^#{2,4}\s+/, "")];
    return [value.replace(/^(?:•|[-*]|\d+\.)\s+/, "")];
  }).join(""));
}

function renderedSemantics(blocks: ReadingBlock[]) {
  return compact(blocks.map((block) => {
    if (block.kind === "table") return [...block.headers, ...block.rows.flat()].join("");
    if (block.kind === "list") return block.items.map((item) => item.text).join("");
    return block.text;
  }).join(""));
}

async function renderedBookPages(page: Page) {
  return page.locator('#book-text > div > section[id^="page-"]').evaluateAll((sections) => sections.map((section) => {
    const body = section.querySelector(":scope > div");
    if (!body) throw new Error(`Missing reading body: ${section.id}`);
    const blocks: ReadingBlock[] = [...body.children].map((element) => {
      const text = element.textContent || "";
      if (element.tagName === "P") return { kind: "paragraph", text };
      if (element.tagName === "H4" || element.tagName === "H5") return { kind: "heading", text, level: element.tagName === "H4" ? 2 : 3 };
      if (element.tagName === "OL" || element.tagName === "UL") return {
        kind: "list", ordered: element.tagName === "OL", items: [...element.querySelectorAll(":scope > li")].map((item) => {
          const value = item.getAttribute("value");
          return { text: item.textContent || "", ...(value === null ? {} : { value: Number(value) }) };
        }),
      };
      const table = element.querySelector("table");
      if (table) return {
        kind: "table",
        headers: [...table.querySelectorAll("thead th")].map((cell) => cell.textContent || ""),
        rows: [...table.querySelectorAll("tbody tr")].map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent || "")),
      };
      throw new Error(`Unexpected reading block ${element.tagName} on ${section.id}`);
    });
    return { page: Number(section.id.slice("page-".length)), blocks };
  }));
}

async function assertNoPageOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

async function screenshot(locator: Locator, testInfo: TestInfo, filename: string) {
  await locator.page().evaluate(() => document.fonts.ready);
  const path = testInfo.outputPath(filename);
  await locator.screenshot({ path });
  await testInfo.attach(filename, { path, contentType: "image/png" });
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page), "Public reading pages must hydrate without browser errors").toEqual([]);
});

const books = [
  { id: "elliott-wave-natural-law", count: 36, screenshotPage: 19, tableCount: 0 },
  { id: "chan-theory-complete", count: 25, screenshotPage: 23, tableCount: 8 },
] as const;

// Fixed source-reviewed column and numeric expectations guard against a table
// disappearing from both the compiled data and its rendered representation.
const reviewedTables = [
  { page: 1, index: 0, headers: ["可解析文章", "正文字符", "原目录栏目", "炒股课程"], count: 1, column: 0, values: ["1,135"] },
  { page: 3, index: 0, headers: ["项目", "结果", "如何处理"], count: 6, column: 1, values: ["1,135篇", "1,492,614字", "2006-02-01—2008-10-10", "10类", "620篇", "1个"] },
  { page: 3, index: 1, headers: ["板块", "篇数", "核心问题", "蒸馏结论"], count: 1, column: 1, values: ["561"] },
  { page: 4, index: 0, headers: ["板块", "篇数", "核心问题", "蒸馏结论"], count: 9, column: 1, values: ["114", "106", "95", "83", "66", "39", "36", "20", "15"] },
  { page: 5, index: 0, headers: ["课次", "主轴", "真正要掌握的能力"], count: 6, column: 0, values: ["1—14", "15—30", "31—53", "54—61", "62—84", "85—108"] },
  { page: 16, index: 0, headers: ["层级", "内容", "使用方式"], count: 6, column: 0, values: ["高保留", "中高保留", "中等保留", "低到中保留", "低保留", "修辞材料"] },
  { page: 22, index: 0, headers: ["系列", "篇数", "起止日期", "在本蒸馏中的位置"], count: 7, column: 1, values: ["71", "28", "30", "17", "11", "42", "12"] },
  { page: 23, index: 0, headers: ["原CHM栏目", "文章数", "本文对应章节"], count: 10, column: 1, values: ["561", "114", "106", "95", "83", "66", "39", "36", "20", "15"] },
];

for (const fixture of books) {
  test(`${fixture.id}: every reading page preserves compiled semantics, tables, and mobile width`, async ({ page, isMobile }, testInfo) => {
    test.setTimeout(60_000);
    const book = data.library.books.find((item) => item.id === fixture.id);
    expect(book).toBeDefined();
    expect(book!.text_pages).toHaveLength(fixture.count);
    await page.goto(`/knowledge/books/${fixture.id}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(book!.title);
    await expect(page.locator('#book-text > div > section[id^="page-"]')).toHaveCount(fixture.count);
    const rendered = await renderedBookPages(page);
    expect(rendered.map((item) => item.page)).toEqual(book!.text_pages.map((item) => item.page));
    for (const source of book!.text_pages) {
      const actual = rendered.find((item) => item.page === source.page)!;
      expect(normalizedBlocks(actual.blocks), `Complete block model for ${fixture.id}, page ${source.page}`).toEqual(normalizedBlocks(parseKnowledgeBookText(source.text)));
      expect(renderedSemantics(actual.blocks), `Independent text preservation for ${fixture.id}, page ${source.page}`).toBe(sourceSemantics(source.text));
    }
    await expect(page.locator("#book-text table")).toHaveCount(fixture.tableCount);
    if (fixture.tableCount) {
      for (const table of reviewedTables) {
        const actual = rendered.find((item) => item.page === table.page)!.blocks.filter((block) => block.kind === "table")[table.index];
        expect(actual.headers).toEqual(table.headers);
        expect(actual.rows).toHaveLength(table.count);
        expect(actual.rows.every((row) => row.length === table.headers.length)).toBe(true);
        expect(actual.rows.map((row) => row[table.column])).toEqual(table.values);
      }
      const cover = rendered.find((item) => item.page === 1)!.blocks.find((block) => block.kind === "table")!;
      expect(cover.rows[0]).toEqual(["1,135", "1,492,614", "10", "108"]);
      const categories = rendered.find((item) => item.page === 23)!.blocks.find((block) => block.kind === "table")!;
      expect(categories.rows.reduce((sum, row) => sum + Number(row[1]), 0)).toBe(1_135);
      await expect(page.locator('#book-text [role="region"][aria-label="本页表格，可横向滚动"]')).toHaveCount(8);
      if (isMobile) {
        expect(await page.locator('#book-text [role="region"]').evaluateAll((regions) => regions.some((region) => region.scrollWidth > region.clientWidth))).toBe(true);
      }
    }
    await assertNoPageOverflow(page);
    await screenshot(page.locator(`#page-${fixture.screenshotPage}`), testInfo, `${fixture.id}-page-${fixture.screenshotPage}.png`);
  });
}

test("core full-book exposes all 117 real unit destinations in its directory and summary titles", async ({ page }, testInfo) => {
  const source = publicPage("core-full-book");
  const units = source.source_unit_ids.map((id) => publicPage(`unit-${id}`));
  expect(units).toHaveLength(117);
  await page.goto(`/knowledge/${source.id}`);
  await page.getByText("查看本页知识目录（117）", { exact: true }).click();
  const directory = page.getByRole("navigation", { name: "本页知识目录", exact: true });
  await expect(directory.getByRole("link")).toHaveCount(117);
  const expected = units.map((unit) => ({ href: `/knowledge/${unit.id}`, title: unit.title }));
  expect(await directory.locator("a").evaluateAll((links) => links.map((link) => ({ href: link.getAttribute("href"), title: link.querySelector("span:last-child")?.textContent })))).toEqual(expected);
  const summaryIndex = source.sections.findIndex((section) => section.title === "快速答案");
  const summary = page.locator(`#knowledge-section-${summaryIndex}`);
  await expect(summary.getByRole("link")).toHaveCount(117);
  expect(await summary.locator("a").evaluateAll((links) => links.map((link) => ({ href: link.getAttribute("href"), title: link.textContent })))).toEqual(expected);
  await screenshot(directory.locator("..").locator("summary"), testInfo, "core-117-directory-control.png");
  await summary.getByRole("link").first().click();
  await expect(page).toHaveURL(new RegExp(`/knowledge/${units[0].id}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(units[0].title);
});

test("all 16 related entries are reachable after expansion instead of silently truncating at eight", async ({ page }, testInfo) => {
  const source = publicPage("unit-ewp-method-multiple-counts");
  const related = source.related_page_ids.map(publicPage);
  expect(related).toHaveLength(16);
  await page.goto(`/knowledge/${source.id}`);
  const navigation = page.getByRole("navigation", { name: "相关知识", exact: true });
  await expect(navigation.locator("a")).toHaveCount(16);
  expect(await navigation.locator("a").evaluateAll((links) => links.filter((link) => link.checkVisibility()).length)).toBe(8);
  await navigation.getByText("展开全部关联（另 8 条）", { exact: true }).click();
  expect(await navigation.locator("a").evaluateAll((links) => links.filter((link) => link.checkVisibility()).length)).toBe(16);
  expect(await navigation.locator("a").evaluateAll((links) => links.map((link) => ({ href: link.getAttribute("href"), title: link.querySelector("span")?.textContent })))).toEqual(related.map((target) => ({ href: `/knowledge/${target.id}`, title: target.title })));
  await screenshot(navigation, testInfo, "related-16-expanded.png");
});

test("public body references lead to real articles while hidden cases remain unpublished", async ({ page }, testInfo) => {
  const source = publicPage("candidate-framework-cases");
  const targetIds = ["core-multiple-counts", "core-invalidation-risk"];
  const hiddenIds = ["candidate-framework-case-btc-zc", "candidate-framework-case-eth-31-32", "candidate-framework-case-xiaomi-alternatives"];
  await page.goto(`/knowledge/${source.id}`);
  const sectionIndex = source.sections.findIndex((section) => section.title === "对应的核心知识链接");
  expect(sectionIndex).toBeGreaterThanOrEqual(0);
  const references = page.locator(`#knowledge-section-${sectionIndex}`);
  await expect(references.getByRole("link")).toHaveCount(2);
  expect(await references.locator("a").evaluateAll((links) => links.map((link) => ({ href: link.getAttribute("href"), title: link.textContent })))).toEqual(targetIds.map((id) => ({ href: `/knowledge/${id}`, title: publicPage(id).title })));
  const linkedIds = await page.locator('main a[href^="/knowledge/"]').evaluateAll((links) => links.map((link) => link.getAttribute("href")!.slice("/knowledge/".length)));
  expect(linkedIds.every((id) => pagesById.has(id))).toBe(true);
  for (const id of hiddenIds) {
    expect(pagesById.has(id)).toBe(false);
    expect(linkedIds).not.toContain(id);
    expect((await page.request.get(`/knowledge/${id}`)).status()).toBe(404);
  }
  await screenshot(references, testInfo, "public-core-body-references.png");
  await references.getByRole("link").first().click();
  await expect(page).toHaveURL(new RegExp(`/knowledge/${targetIds[0]}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(publicPage(targetIds[0]).title);
});
