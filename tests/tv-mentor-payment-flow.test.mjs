import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createRequire} from "node:module";

const require = createRequire(import.meta.url);
const tv = require("../community/tv-review.js");
const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

test("TradingView chart packages follow shared-link theme and support auto mode", () => {
  const parsed = tv.parseChartUrl("https://www.tradingview.com/chart/?symbol=BINANCE%3ABTCUSDT&interval=240&theme=light");
  assert.equal(parsed.symbol, "BINANCE:BTCUSDT");
  assert.equal(parsed.interval, "240");
  assert.equal(parsed.theme, "light");
  assert.equal(tv.buildPackage({symbol: "OANDA:XAUUSD", theme: "auto"}).theme, "auto");
  assert.equal(tv.resolvedTheme("auto", {matchMedia: () => ({matches: true}), document: {documentElement: {dataset: {}}}}), "light");
});

test("TradingView connection stores only public profile metadata", () => {
  const values = new Map();
  const view = {localStorage: {setItem: (key, value) => values.set(key, value), getItem: key => values.get(key)}};
  const saved = tv.saveConnection(view, {username: "wave-researcher", theme: "dark"});
  assert.match(saved.profile_url, /tradingview\.com\/u\/wave-researcher/);
  const serialized = JSON.stringify(saved);
  assert.doesNotMatch(serialized, /password|cookie|token/i);
  assert.equal(tv.readConnection(view).preferred_theme, "dark");
});

test("TradingView connection UI is disabled without deleting stored chart data", async () => {
  const [member, community, repository] = await Promise.all([
    read("community/member-ui.js"),
    read("community/community-ui.js"),
    read("community/community-repository.js")
  ]);
  assert.doesNotMatch(member, /const tvPanel = createTVPanel/);
  assert.doesNotMatch(member, /tvPanel\.node/);
  assert.doesNotMatch(community, /const tvPanel = createPublicTVPanel/);
  assert.doesNotMatch(community, /tvPanel\.node/);
  assert.doesNotMatch(community, /加载交互图表/);
  assert.match(repository, /chart_package/);
  assert.match(member, /tradingview: reviewData\.tradingview \|\| null/);
  assert.match(repository, /hasOwnProperty\.call\(value, "chartPackage"\)/);
});

test("mentor manual payment flow is non-destructive and opens a verified thread", async () => {
  const [sql, mentorRepository, mentorUI, member, admin] = await Promise.all([
    read("supabase/migrations/202608040001_tv_mentor_manual_payments.sql"),
    read("community/mentor-repository.js"),
    read("community/mentor-ui.js"),
    read("community/member-ui.js"),
    read("admin/admin-ui.js")
  ]);
  assert.match(sql, /create table if not exists public\.mentor_payment_methods/);
  assert.match(sql, /create table if not exists public\.mentor_payment_claims/);
  assert.match(sql, /create_manual_mentor_order/);
  assert.match(sql, /review_mentor_payment_claim/);
  assert.doesNotMatch(sql, /drop table|truncate table|delete from public\.profiles|delete from auth\./i);
  assert.match(mentorRepository, /savePaymentMethod/);
  assert.match(mentorRepository, /createManualOrder/);
  assert.match(mentorUI, /管理我的服务与收款方式/);
  assert.match(mentorUI, /我已付款/);
  assert.match(member, /确认并打开对话/);
  assert.match(admin, /新增价位/);
  assert.match(admin, /添加收款方式/);
  assert.match(admin, /updateMentorResource\("mentor_offers"/);
  assert.match(admin, /updateMentorResource\("mentor_payment_methods"/);
  assert.match(admin, /每个套餐都可独立修改价格、期限、周提问额度与展示状态/);
  assert.match(admin, /\.select\("id,active"\)[\s\S]{0,40}\.maybeSingle\(\)/);
  assert.match(admin, /服务套餐已下架/);
  assert.match(admin, /收款方式已停用/);
  assert.match(admin, /offerActive: enabledFlag\(offer\.active, true\)/);
});
