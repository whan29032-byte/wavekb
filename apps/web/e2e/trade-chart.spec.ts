import { expect, test } from "@playwright/test";

const fixtureCycleId = "11111111-1111-4111-8111-111111111111";

test("trade chart details and projections require a session", async ({ page, request }) => {
  const path = `/workbench/trades/${fixtureCycleId}`;
  await page.goto(path);
  await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(path)}$`, "i"));

  const projection = await request.get(`/api/trading/trades/${fixtureCycleId}/chart`);
  expect(projection.status()).toBe(401);
  expect(projection.headers()["cache-control"]).toContain("no-store");
  await expect(projection.json()).resolves.toEqual({ error: "authentication_required" });
});

test("the PWA shows its public shell offline and stores no trade detail or API data", async ({ page, context }) => {
  await page.goto("/");
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  try {
    await context.setOffline(true);
    await page.goto(`/workbench/trades/${fixtureCycleId}`);
    await expect(page.getByRole("heading", { name: "当前网络不可用" })).toBeVisible();
    await expect(page.getByRole("link", { name: "重新打开知识库" })).toBeVisible();
    const paths = await page.evaluate(async () => {
      const opened = await Promise.all((await caches.keys()).map((name) => caches.open(name)));
      return (await Promise.all(opened.map((cache) => cache.keys()))).flat().map(({ url }) => new URL(url).pathname);
    });
    expect(paths).toContain("/offline.html");
    expect(paths.filter((path) => path.startsWith("/workbench/") || path.startsWith("/api/"))).toEqual([]);
  } finally {
    await context.setOffline(false);
  }
});
