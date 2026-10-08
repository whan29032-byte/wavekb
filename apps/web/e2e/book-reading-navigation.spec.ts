import { expect, test } from "@playwright/test";

const bookPath = "/knowledge/books/elliott-wave-natural-law";

for (const { section, label, detailPath } of [
  { section: "chapters", label: "返回原书目录", detailPath: "/knowledge/chapters/chapter-01" },
  { section: "themes", label: "返回八大主题", detailPath: "/knowledge/themes/rules" },
  { section: "questions", label: "返回问题路线", detailPath: "/knowledge/questions/q-motive-or-corrective" },
]) {
  test(`the core-book ${section} link returns to a real expanded index without a duplicate hash`, async ({ page }) => {
    await page.goto(`/knowledge/books/elliott-wave-principle-tenth-edition?section=${section}#core-${section}`);
    const index = page.locator(`#core-${section}`);
    await expect(index).toHaveAttribute("open", "");
    await index.locator(`a[href="${detailPath}"]`).click();
    await expect(page).toHaveURL(new RegExp(`${detailPath}$`));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const returnLink = page.getByRole("link", { name: label, exact: true });
    expect(await returnLink.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    await returnLink.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`section=${section}#core-${section}$`));
    const returnedIndex = page.locator(`#core-${section}`);
    await expect(returnedIndex).toHaveAttribute("open", "");
    await expect(returnedIndex.getByRole("link").first()).toBeVisible();
    await expect.poll(() => returnedIndex.evaluate((element) => {
      const top = element.getBoundingClientRect().top;
      const headerBottom = document.querySelector("body > header")?.getBoundingClientRect().bottom ?? 65;
      return top >= headerBottom + 8 && top < window.innerHeight / 2;
    })).toBe(true);
  });
}

async function expectLocatedPage(page: import("@playwright/test").Page, number: number) {
  await expect(page).toHaveURL(new RegExp(`#page-${number}$`));
  const target = page.locator(`#page-${number}`);
  await expect(target).toBeFocused();
  await expect.poll(() => target.evaluate((element) => {
    const top = element.getBoundingClientRect().top;
    const headerBottom = document.querySelector("body > header")?.getBoundingClientRect().bottom ?? 65;
    return top >= headerBottom + 8 && top < window.innerHeight / 2;
  })).toBe(true);
}

test("page-number navigation reaches real text below the sticky header and supports history", async ({ page }, testInfo) => {
  await page.goto(bookPath);
  const navigation = page.getByRole("navigation", { name: "本书导航", exact: true });
  await navigation.getByRole("textbox", { name: "跳至页码" }).fill("20");
  await navigation.screenshot({ path: testInfo.outputPath("book-page-controls.png") });
  await navigation.getByRole("button", { name: "跳转", exact: true }).click();
  await expectLocatedPage(page, 20);
  await expect(page.locator("#page-20").locator("p, ul, ol, table").first()).not.toBeEmpty();
  await page.getByRole("navigation", { name: "第 20 页阅读导航", exact: true }).getByRole("link", { name: "下一页" }).click();
  await expectLocatedPage(page, 21);
  await page.goBack();
  await expectLocatedPage(page, 20);
  await page.goForward();
  await expectLocatedPage(page, 21);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("book search retains its keyword and repeat jumps reposition the same page", async ({ page }) => {
  await page.goto(bookPath);
  const search = page.getByRole("search", { name: "搜索本书", exact: true });
  await search.getByRole("searchbox", { name: "搜索本书" }).fill("1946");
  const firstResult = search.getByRole("link").filter({ hasText: "第 1 页" });
  await expect(firstResult).toHaveAttribute("href", "#page-1");
  await firstResult.click();
  await expectLocatedPage(page, 1);
  expect(new URL(page.url()).searchParams.get("q")).toBe("1946");
  await expect(search.getByRole("searchbox", { name: "搜索本书" })).toHaveValue("1946");
  await firstResult.scrollIntoViewIfNeeded();
  await firstResult.click();
  await expectLocatedPage(page, 1);
});

test("direct links restore the page and invalid input cannot create a nonexistent destination", async ({ page }) => {
  await page.goto(`${bookPath}#page-18`);
  await expectLocatedPage(page, 18);
  const navigation = page.getByRole("navigation", { name: "本书导航", exact: true });
  await expect(navigation.getByRole("textbox", { name: "跳至页码" })).toHaveValue("18");
  await navigation.getByRole("textbox", { name: "跳至页码" }).fill("999");
  await navigation.getByRole("button", { name: "跳转", exact: true }).click();
  await expect(navigation.getByRole("alert")).toContainText("请输入本书已有页码");
  await expect(page).toHaveURL(/#page-18$/);
  expect(await navigation.getByRole("link", { name: /生成 · 第/ }).count()).toBeLessThanOrEqual(7);
});

for (const id of ["elliott-wave-natural-law", "chan-theory-complete"]) {
  test(`${id}: all rendered local links have targets and touch-size controls`, async ({ page }) => {
    await page.goto(`/knowledge/books/${id}`);
    const invalidTargets = await page.locator('main a[href^="#"]').evaluateAll((links) => links.flatMap((element) => {
      const link = element as HTMLAnchorElement;
      const target = document.getElementById(decodeURIComponent(link.hash.slice(1)));
      return !target || target.tabIndex !== -1 || parseFloat(getComputedStyle(target).scrollMarginTop) < 80 ? [link.hash] : [];
    }));
    expect(invalidTargets).toEqual([]);
    const navigation = page.getByRole("navigation", { name: "本书导航", exact: true });
    const tooSmall = await navigation.locator("a,button,input").evaluateAll((controls) => controls.filter((control) => control.getBoundingClientRect().height < 44).length);
    expect(tooSmall).toBe(0);
    await navigation.getByRole("link", { name: "网页正文", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#book-text")).toBeFocused();
    expect(await page.locator("#book-text").evaluate((element) => element.getBoundingClientRect().top)).toBeGreaterThanOrEqual(80);
  });
}
