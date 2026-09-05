import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
});

for (const mode of ["light", "dark"]) {
  test(`${mode} custom theme and identity materials remain readable`, async ({ page }) => {
    await page.addInitScript((mode) => localStorage.setItem("wavekb:appearance:v1", JSON.stringify({ mode, theme: "custom", customColor: "#557fb8" })), mode);
    await page.goto("/iframe.html?id=member-identity-gallery--all-tiers&viewMode=story");
    const button = page.getByRole("button", { name: "主题对比度" }); await expect(button).toBeVisible();
    const contrast = await button.evaluate((element) => {
      const rgb = (color: string) => { const canvas = document.createElement("canvas"); const context = canvas.getContext("2d")!; context.fillStyle = color; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3); };
      const lum = (color: string) => rgb(color).map((v) => v / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
      const css = getComputedStyle(element), a = lum(css.color), b = lum(css.backgroundColor);
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
    for (const style of ["premium", "blackgold", "platinum", "purplegold", "rainbow", "newyear"]) {
      const section = page.locator(`[data-tier="${style}"]`);
      // Content text must not disappear into bright gradient stops; motion lives in the material layers.
      expect(await section.locator(".identity-uid").first().evaluate((el) => getComputedStyle(el).webkitTextFillColor)).not.toBe("rgba(0, 0, 0, 0)");
      expect(await section.locator(".identity-liang").first().evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(14);
      expect(await section.locator(".identity-nameplate").first().evaluate((el) => getComputedStyle(el, "::after").animationName)).not.toBe("none");
    }
    await page.screenshot({ path: test.info().outputPath(`identity-${mode}.png`), fullPage: true });
  });
}

test("reduced motion keeps premium material and decoration without looping effects", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/iframe.html?id=member-identity-gallery--all-tiers&viewMode=story");
  const plate = page.locator('[data-tier="blackgold"] .identity-nameplate').first(); await expect(plate).toBeVisible();
  expect(await plate.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  expect(await plate.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain("gradient");
  await expect(plate.locator(".identity-drive-wave")).toBeAttached();
});

test("the local reduced-motion setting survives reload without removing premium material", async ({ page }) => {
  await page.goto("/iframe.html?id=member-identity-gallery--all-tiers&viewMode=story");
  await page.getByLabel("网站外观", { exact: true }).click();
  await page.getByRole("checkbox", { name: "减少动态效果" }).check();
  await page.reload();
  const plate = page.locator('[data-tier="blackgold"] .identity-nameplate').first();
  await expect(plate).toBeVisible();
  expect(await plate.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  expect(await plate.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain("gradient");
  await page.getByLabel("网站外观", { exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "减少动态效果" })).toBeChecked();
});
