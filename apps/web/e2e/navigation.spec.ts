import { expect, test } from "@playwright/test";

test("home exposes the knowledge and community paths", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("把波浪判断写清楚");
  await expect(page.getByRole("link", { name: "进入社区" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
});

test("unknown community boards return a real not-found page", async ({ page }) => {
  const response = await page.goto("/community/not-a-board");
  expect(response?.status()).toBe(404);
});

test("member profiles preserve the destination through login", async ({ page }) => {
  await page.goto("/member/12345");
  await expect(page).toHaveURL(/\/login\?next=%2Fmember%2F12345/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("登录 WaveKB");
});

test("friends and messages remain private", async ({ page }) => {
  await page.goto("/member/profile");
  await expect(page).toHaveURL(/\/login\?next=%2Fmember%2Fprofile/);
  await page.goto("/friends");
  await expect(page).toHaveURL(/\/login\?next=%2Ffriends/);
  await page.goto("/messages");
  await expect(page).toHaveURL(/\/login\?next=%2Fmessages/);
  await page.goto("/workbench");
  await expect(page).toHaveURL(/\/login\?next=%2Fworkbench/);
  await page.goto("/workbench/entries/new");
  await expect(page).toHaveURL(/\/login\?next=%2Fworkbench%2Fentries%2Fnew/);
});

test("knowledge search opens a fully migrated article", async ({ page }) => {
  await page.goto("/knowledge");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("规则、指南与原书证据");
  await page.getByLabel("搜索知识标题和正文").fill("购买力指数");
  await page.getByRole("link", { name: /名义价格与定值价格应并行检查/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("名义价格与定值价格应并行检查");
  await expect(page.getByRole("heading", { name: "强制规则" })).toBeVisible();
  await expect(page.getByText("原书来源", { exact: true })).toBeVisible();
});
