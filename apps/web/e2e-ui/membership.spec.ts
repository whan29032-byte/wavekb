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
