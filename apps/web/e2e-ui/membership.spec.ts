import { expect, test } from "@playwright/test";

const stories = [
  { id:"membership-center--free-member", heading:"会员中心", expected:"免费注册会员" },
  { id:"membership-center--active-member", heading:"会员中心", expected:"生效中" },
  { id:"membership-center--service-unavailable", heading:"会员中心", expected:"会员服务尚未部署，暂时不可使用。" },
  { id:"membership-admin-plan--default-disabled", heading:"会员方案管理", expected:"允许管理员手工授予此方案" },
  { id:"membership-admin-grant--date-validation", heading:"会员授权表单预览", expected:"虚拟组件预览 · 不查询账号，不提交实际授权。" },
];
for (const viewport of [{width:375,height:812},{width:812,height:375},{width:768,height:1024},{width:1440,height:1000}]) {
  for (const colorScheme of ["light","dark"] as const) {
    for (const story of stories) {
      test(`${story.id} at ${viewport.width}x${viewport.height} ${colorScheme}`, async ({page},testInfo)=>{
        const errors:string[]=[]; page.on("pageerror",error=>errors.push(error.message));
        await page.setViewportSize(viewport); await page.emulateMedia({colorScheme,reducedMotion:"reduce"});
        await page.goto(`/iframe.html?id=${story.id}&viewMode=story`);
        await expect(page.getByRole("heading",{level:1,name:story.heading})).toBeVisible();
        await expect(page.getByText(story.expected,{exact:story.id!=="membership-admin-plan--default-disabled"})).toBeVisible();
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
        for (const button of await page.getByRole("button").all()) {
          expect(await button.evaluate(element=>element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
        }
        for (const label of await page.locator("form label[for]").all()) {
          const target=await label.getAttribute("for"); await expect(page.locator(`[id="${target}"]`)).toHaveCount(1);
        }
        if (story.id==="membership-admin-plan--default-disabled") {
          await page.getByLabel("权益清单").fill("broken format"); await page.getByLabel("变更原因").fill("浏览器测试原因");
          await page.getByRole("button",{name:"保存方案"}).click();
          await expect(page.getByRole("alert")).toContainText("权益格式");
          await expect(page.getByLabel("权益清单")).toBeFocused();
          await expect(page.getByLabel("权益清单")).toHaveAttribute("aria-invalid","true");
          await page.getByLabel("权益清单").fill("research_notes=已实现的会员笔记");
          await expect(page.getByRole("alert")).toHaveCount(0);
          await expect(page.getByLabel("权益清单")).toHaveAttribute("aria-invalid","false");
        } else if (story.id==="membership-admin-grant--date-validation") {
          const end=page.locator("#grant-end");
          const action=page.locator("#grant-action");
          const submit=page.getByRole("button",{name:"提交会员变更"});
          const result=page.getByTestId("membership-grant-preview-result");
          await page.locator("#grant-reason").fill("隔离组件日期验收");
          for (const operation of ["grant","extend"]) {
            await action.selectOption(operation);
            await submit.click();
            await expect(result).toHaveCount(0);
            await expect(end).toBeFocused();
          }
          await end.fill("2026-11-01T12:30:30");
          expect(await end.evaluate((element:HTMLInputElement)=>element.validity.stepMismatch)).toBe(false);
          const expectedEnd=await end.evaluate((element:HTMLInputElement)=>new Date(element.value).toISOString());
          await submit.click();
          await expect(result).toHaveAttribute("data-action","extend");
          await expect(result).toHaveAttribute("data-end",expectedEnd);
          await action.selectOption("revoke");
          await expect(end).toBeDisabled();
          expect(await end.evaluate((element:HTMLInputElement)=>element.required || element.willValidate)).toBe(false);
          page.once("dialog",dialog=>dialog.accept());
          await submit.click();
          await expect(result).toHaveAttribute("data-action","revoke");
          await expect(result).toHaveAttribute("data-end","");
          if (viewport.width===375 && colorScheme==="light") {
            await page.screenshot({path:testInfo.outputPath("membership-grant-revoke.png"),fullPage:true});
          }
        } else {
          await page.getByRole("button",{name:"刷新状态"}).focus();
          await expect(page.getByRole("button",{name:"刷新状态"})).toBeFocused();
          await expect(page.getByRole("button",{name:/购买|续费/})).toHaveCount(0);
        }
        expect(errors).toEqual([]);
      });
    }
  }
}

const commerceStories = [
  { id: "membership-publicplans--published-payment-closed", heading: "会员方案", expected: "付款尚未开放。已发布的方案可供了解，不能在此完成购买。" },
  { id: "membership-publicplans--service-unavailable", heading: "会员方案", expected: "未核实方案或价格时，不会提供购买入口。" },
  { id: "membership-purchases--payment-closed", heading: "会员购买与订单", expected: "付款尚未开放，请查看公开方案或继续使用免费账户功能。" },
  { id: "membership-purchases--test-purchase-preview", heading: "会员购买与订单", expected: "测试模式：不授予正式权益" },
  { id: "membership-purchases--unknown-receipt", heading: "会员购买与订单", expected: "结果仍不确定，原请求已保留。" },
  { id: "membership-purchases--payment-failed", heading: "会员购买与订单", expected: "支付失败，未授权权益" },
  { id: "membership-admincommerce--payment-closed", heading: "会员购买配置", expected: "公开价格与允许付款是独立设置。" },
  { id: "membership-admincommerce--unknown-save-receipt", heading: "会员购买配置", expected: "保存结果尚未确认，已保留原请求。" },
];

for (const colorScheme of ["light", "dark"] as const) {
  for (const story of commerceStories) {
    test(`${story.id} at 390px ${colorScheme}: truthful mock state and no overflow`, async ({ page }, testInfo) => {
      const errors: string[] = []; const externalMutations: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => { if (request.method() !== "GET" && /supabase|stripe/i.test(request.url())) externalMutations.push(request.url()); });
      await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.goto(`/iframe.html?id=${story.id}&viewMode=story`);
      await expect(page.getByRole("heading", { level: 1, name: story.heading })).toBeVisible();
      await expect(page.getByText(story.expected, { exact: false }).first()).toBeVisible();
      await expect(page.getByText(/虚拟组件预览/)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      for (const button of await page.getByRole("button").all()) expect(await button.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
      for (const label of await page.locator("form label[for]").all()) { const target = await label.getAttribute("for"); await expect(page.locator(`[id="${target}"]`)).toHaveCount(1); }
      if (story.id.startsWith("membership-publicplans")) {
        await expect(page.getByRole("link", { name: "注册免费账户" })).toHaveAttribute("href", "/register?next=%2Fmembership");
        await expect(page.getByRole("link", { name: "已有账户，登录" })).toHaveAttribute("href", "/login?next=%2Fmembership");
        await expect(page.getByRole("link", { name: "前往核对并购买" })).toHaveCount(0);
      }
      if (story.id.startsWith("membership-purchases")) {
        await expect(page.getByRole("link", { name: "继续阅读公开知识库" })).toHaveAttribute("href", "/knowledge");
        await expect(page.getByText("暂无有效 VIP 权益")).toBeVisible();
        await expect(page.getByText("有效 VIP 会员", { exact: true })).toHaveCount(0);
      }
      if (story.id === "membership-purchases--unknown-receipt") {
        await expect(page.getByRole("button", { name: "测试购买月度" })).toBeDisabled();
        await expect(page.getByRole("button", { name: "核对并继续原请求" })).toBeEnabled();
        await expect(page.getByText(/不要重新购买或重复付款/)).toBeVisible();
      }
      if (story.id === "membership-purchases--payment-closed") await expect(page.getByRole("button", { name: /购买月度|购买年度/ })).toHaveCount(0);
      if (story.id === "membership-admincommerce--unknown-save-receipt") {
        await expect(page.getByRole("button", { name: "保存月度价格" })).toBeDisabled();
        await expect(page.getByRole("button", { name: "保存数值权益" })).toBeDisabled();
        await expect(page.getByRole("button", { name: "核对并重试原配置请求" })).toBeEnabled();
      }
      if (colorScheme === "light" && ["membership-publicplans--published-payment-closed", "membership-purchases--unknown-receipt", "membership-admincommerce--payment-closed"].includes(story.id)) await page.screenshot({ path: testInfo.outputPath(`${story.id}-390px.png`), fullPage: true });
      expect(errors).toEqual([]); expect(externalMutations).toEqual([]);
    });
  }

  test(`membership commerce price/reason keyboard errors at 390px ${colorScheme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme });
    await page.goto("/iframe.html?id=membership-admincommerce--payment-closed&viewMode=story");
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "保存月度价格" }) });
    const price = form.getByLabel("价格（USD）"); const reason = form.getByLabel("变更原因"); const button = form.getByRole("button", { name: "保存月度价格" });
    await expect(price).toHaveValue("52.00"); await expect(price).toHaveAttribute("step", "0.01");
    await reason.fill("键盘价格回归"); await price.fill("52.001"); await button.focus(); await page.keyboard.press("Enter");
    await expect(price).toBeFocused(); expect(await price.evaluate((element: HTMLInputElement) => element.validity.stepMismatch)).toBe(true);
    await price.fill("52.25"); await reason.fill("   "); await button.focus(); await page.keyboard.press("Enter");
    await expect(form.getByRole("alert")).toContainText("有效字符"); await expect(reason).toBeFocused(); await expect(reason).toHaveAttribute("aria-invalid", "true");
    await reason.fill("已重新核对原因"); await expect(form.getByRole("alert")).toHaveCount(0); await expect(reason).toHaveAttribute("aria-invalid", "false");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test(`membership commerce numeric entitlement browser limits at 390px ${colorScheme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme });
    await page.goto("/iframe.html?id=membership-admincommerce--payment-closed&viewMode=story");
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "保存数值权益" }) });
    const quota = form.getByLabel("每日平台 AI 次数"); const discount = form.getByLabel("导师价格优惠（%）"); const button = form.getByRole("button", { name: "保存数值权益" });
    await expect(quota).toHaveValue("50"); await expect(discount).toHaveValue("10.00"); await expect(discount).toHaveAttribute("max", "99");
    await form.getByLabel("变更原因").fill("数值权益回归核对"); await discount.fill("100"); await button.focus(); await page.keyboard.press("Enter");
    await expect(discount).toBeFocused(); expect(await discount.evaluate((element: HTMLInputElement) => element.validity.rangeOverflow)).toBe(true);
    await discount.fill("10"); await quota.fill("0.5"); await button.focus(); await page.keyboard.press("Enter");
    await expect(quota).toBeFocused(); expect(await quota.evaluate((element: HTMLInputElement) => element.validity.stepMismatch)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
