import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

test("admin modules expose load failures instead of rendering false empty states", async () => {
  const ui = await read("admin/admin-ui.js");
  assert.match(ui, /moduleErrors:\s*\{/);
  assert.match(ui, /function moduleErrorPanel\(/);
  assert.match(ui, /loadOptionalModule\("mentors", loadMentors/);
  assert.match(ui, /loadOptionalModule\("mentorOrders", loadMentorOrders/);
  assert.match(ui, /loadOptionalModule\("rewards", loadRewardStore/);
  assert.doesNotMatch(ui, /loadMentors\(\)\.catch\(\(\) =>/);
  assert.doesNotMatch(ui, /loadMentorOrders\(\)\.catch\(\(\) =>/);
});

test("mentor catalog has complete edit, availability and protected delete controls", async () => {
  const ui = await read("admin/admin-ui.js");
  assert.match(ui, /deleteMentorResource\("mentor_offers", item\.id\)/);
  assert.match(ui, /deleteMentorResource\("mentor_payment_methods", method\.id\)/);
  assert.match(ui, /已关联订单的套餐只能下架/);
  assert.match(ui, /已关联付款记录的方式只能停用/);
  assert.match(ui, /itemEnabled \? "下架" : "重新上架"/);
  assert.match(ui, /methodEnabled \? "停用" : "重新启用"/);
});

test("mentor orders can be safely reconciled with explicit entitlement warnings", async () => {
  const ui = await read("admin/admin-ui.js");
  assert.match(ui, /function mentorOrderTransitions\(/);
  assert.match(ui, /async function saveMentorOrderStatus\(/);
  assert.match(ui, /\.eq\("status", order\.status\)/);
  assert.match(ui, /标记已支付后会立即发放辅导权益/);
  assert.match(ui, /标记已退款后会撤销辅导权益/);
  assert.match(ui, /订单状态已被其他管理员修改/);
});

test("frontend theme cards keep fixed contrast and readable text selection", async () => {
  const css = await read("community/appearance.css");
  assert.match(css, /\.member-rewards-hero-copy > h1[\s\S]*?background-clip:\s*border-box !important/);
  assert.match(css, /#elliott-kb-inline ::selection[\s\S]*?var\(--wavekb-accent\) !important/);
  assert.match(css, /\.member-rewards-hero ::selection[\s\S]*?#f4cc67 !important/);
  assert.match(css, /\.member-reward-balance-card[\s\S]*?rgba\(76, 108, 149, \.54\) !important/);
});

test("admin and frontend documents use the audited cache versions", async () => {
  const [main, preview, admin] = await Promise.all([
    read("index.html"),
    read("elliott-wave-preview.html"),
    read("admin/index.html")
  ]);
  for (const html of [main, preview]) assert.match(html, /wavekb-ui-system-20260812-2/);
  assert.match(admin, /admin-audit-20260810-3/);
});
