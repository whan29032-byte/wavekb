import { expect, test } from "@playwright/test";

const states = [
  { id: "membership-wallet--unconfigured", expected: "钱包收款尚未配置或未开放" },
  { id: "membership-wallet--pending", expected: "等待付款" },
  { id: "membership-wallet--checking", expected: "正在核验转账" },
  { id: "membership-wallet--waiting-confirmation", expected: "等待链上确认" },
  { id: "membership-wallet--review", expected: "需要人工核对" },
  { id: "membership-wallet--paid", expected: "付款已确认" },
  { id: "membership-wallet--multiple-networks", expected: "选择方案与付款网络" },
  { id: "membership-wallet--unknown-receipt", expected: "原请求已保留" },
  { id: "membership-walletadmin--missing-addresses", expected: "收款地址尚未配置" },
  { id: "membership-walletadmin--unknown-save-receipt", expected: "保存结果尚未确认" },
  { id: "membership-walletadmin--reconciliation", expected: "同一订单的额外转账，需人工处理" },
];
for (const viewport of [{ width: 375, height: 812 }, { width: 812, height: 375 }, { width: 1440, height: 1000 }]) {
  for (const colorScheme of ["light", "dark"] as const) {
    for (const story of states) {
      test(`${story.id} ${viewport.width}x${viewport.height} ${colorScheme}: safe virtual invoice`, async ({ page }, testInfo) => {
        const errors: string[] = [], writes: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("request", (request) => { if (request.method() !== "GET" && /supabase|stripe|tron|alchemy|infura/i.test(request.url())) writes.push(request.url()); });
        await page.setViewportSize(viewport); await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
        await page.goto(`/iframe.html?id=${story.id}&viewMode=story`);
        await expect(page.getByRole("heading", { level: 1, name: story.id.startsWith("membership-walletadmin") ? "会员钱包配置预览" : "VIP 钱包支付预览" })).toBeVisible();
        await expect(page.getByText(story.expected, { exact: false }).first()).toBeVisible(); await expect(page.getByText(/虚拟组件预览/)).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        for (const button of await page.getByRole("button").all()) expect(await button.evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
        for (const label of await page.locator("form label[for]").all()) { const target = await label.getAttribute("for"); await expect(page.locator(`[id="${target}"]`)).toHaveCount(1); }
        if (["pending", "checking", "waiting-confirmation", "review", "paid"].some((value) => story.id === `membership-wallet--${value}`)) {
          await expect(page.locator("[data-wallet-amount]")).toHaveText("52.001237 USDC"); await expect(page.locator("[data-wallet-recipient]")).toHaveText("虚拟测试地址 · 不可转账");
          for (const button of await page.getByRole("button", { name: /复制|提交.*哈希/ }).all()) await expect(button).toBeDisabled();
          await expect(page.getByText("有效 VIP 会员", { exact: true })).toHaveCount(story.id.endsWith("--paid") ? 1 : 0);
        }
        if (story.id.endsWith("--multiple-networks")) {
          const route = page.getByLabel("付款网络与币种"); await expect(route.locator("option")).toHaveCount(5);
          for (const id of ["tron-usdt", "ethereum-usdt", "ethereum-usdc", "base-usdc"]) await expect(route.locator(`option[value="${id}"]`)).toHaveCount(1);
          await page.getByLabel("VIP 方案").selectOption({ index: 1 }); await route.selectOption("base-usdc"); await page.getByRole("checkbox").check(); await expect(page.getByRole("button", { name: "生成钱包付款订单" })).toBeDisabled();
        }
        if (story.id.endsWith("--missing-addresses")) {
          await expect(page.getByRole("checkbox", { name: "允许创建新的钱包付款订单" })).toBeDisabled();
          for (const field of await page.getByLabel("公开收款地址").all()) await expect(field).toHaveValue("");
          const form = page.locator("form").filter({ has: page.getByRole("button", { name: "保存 base-usdc 收款配置" }) });
          await form.getByLabel("公开收款地址").fill("wrong-network-address"); await form.getByLabel("变更原因").fill("隔离组件地址校验"); await form.getByRole("button").click();
          await expect(page.getByRole("alert")).toContainText("完整公开收款地址"); await expect(form.getByLabel("公开收款地址")).toBeFocused();
        }
        if (story.id.endsWith("--reconciliation")) {
          const revoke = page.getByRole("button", { name: "撤销此单 VIP 权益" }); await expect(revoke).toBeDisabled();
          await expect(page.getByText(/不会执行链上退款/)).toBeVisible(); await page.getByLabel("撤销原因").fill("隔离组件权益撤销预览"); await page.getByRole("checkbox", { name: "确认只撤销此订单 VIP 权益，系统不会退款" }).check(); await expect(revoke).toBeEnabled();
          await revoke.focus(); await expect(revoke).toBeFocused();
        }
        if (viewport.width === 375 && colorScheme === "light" && ["membership-wallet--pending", "membership-wallet--multiple-networks", "membership-walletadmin--missing-addresses"].includes(story.id)) await page.screenshot({ path: testInfo.outputPath(`${story.id}-375px.png`), fullPage: true });
        expect(errors).toEqual([]); expect(writes).toEqual([]);
      });
    }
  }
}
