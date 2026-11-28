import { expect, test, type Page } from "@playwright/test";

const publicPostId = "public/post with space";
const sensitiveQuantities = ["9876.54321", "1234.56789"] as const;
const sensitivePnl = "87654.32";

const privacyModes = [
  { story: "strict-private", label: "strict private", quantityVisible: false, pnlVisible: false },
  { story: "quantity-only", label: "quantity only", quantityVisible: true, pnlVisible: false },
  { story: "pnl-only", label: "P&L only", quantityVisible: false, pnlVisible: true },
  { story: "both-visible", label: "quantity and P&L", quantityVisible: true, pnlVisible: true },
] as const;

const viewports = [
  { label: "desktop", width: 1_440, height: 900 },
  { label: "mobile", width: 390, height: 844 },
] as const;

function isPrivateSource(url: string) {
  const parsed = new URL(url);
  return /(?:\/api\/trading(?:\/|$)|\/workbench(?:\/|$)|tradingview|trade[_-]cycles|chart[_-]state)/i
    .test(`${parsed.hostname}${parsed.pathname}`);
}

async function expectPrivacy(
  page: Page,
  { quantityVisible, pnlVisible }: Pick<(typeof privacyModes)[number], "quantityVisible" | "pnlVisible">,
) {
  const dom = await page.content();
  const accessibilityTree = await page.locator("body").ariaSnapshot();

  for (const quantity of sensitiveQuantities) {
    expect(dom.includes(quantity), `DOM quantity visibility for ${quantity}`).toBe(quantityVisible);
    expect(accessibilityTree.includes(quantity), `ARIA quantity visibility for ${quantity}`).toBe(quantityVisible);
  }

  expect(dom.includes(sensitivePnl), `DOM P&L visibility for ${sensitivePnl}`).toBe(pnlVisible);
  expect(accessibilityTree.includes(sensitivePnl), `ARIA P&L visibility for ${sensitivePnl}`).toBe(pnlVisible);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.max(
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
    document.body.scrollWidth - document.body.clientWidth,
  ));
  expect(overflow).toBeLessThanOrEqual(1);
}

for (const viewport of viewports) {
  test.describe(viewport.label, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const mode of privacyModes) {
      test(`${mode.label} keeps the immutable public boundary before and after selecting a fill`, async ({ page }) => {
        const privateRequests: string[] = [];
        page.on("request", (request) => {
          if (isPrivateSource(request.url())) privateRequests.push(request.url());
        });

        await page.goto(`/iframe.html?id=community-public-strategy-chart--${mode.story}&viewMode=story`);
        await expect(page.getByRole("heading", { name: "公开策略图" })).toBeVisible({ timeout: 15_000 });
        await expect(page.locator("[aria-label^='公开策略 K 线图'] canvas").first()).toBeVisible({ timeout: 15_000 });

        await expectPrivacy(page, mode);
        await expect(page.getByRole("link", { name: "讨论这笔成交" })).toHaveCount(0);
        await expectNoHorizontalOverflow(page);
        expect(privateRequests).toEqual([]);

        const close = page.getByRole("button", { name: /平仓 · 价格 70114/ });
        await close.click();
        await expect(close).toHaveAttribute("aria-pressed", "true");
        await expectPrivacy(page, mode);
        await expectNoHorizontalOverflow(page);
        expect(privateRequests).toEqual([]);

        const discussion = page.getByRole("link", { name: "讨论这笔成交" });
        await expect(discussion).toHaveAttribute(
          "href",
          `/community/post/${encodeURIComponent(publicPostId)}?marker=public-close#comments-title`,
        );
        await expect(discussion).toHaveCount(1);
      });
    }
  });
}
