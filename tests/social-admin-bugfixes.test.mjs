import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {readFile} from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");
const require = createRequire(import.meta.url);
const memberCore = require(fileURLToPath(new URL("../community/member-core.js", import.meta.url)));
const mentorCore = require(fileURLToPath(new URL("../community/mentor-core.js", import.meta.url)));

test("friend conversation routes keep the intended peer identity", () => {
  const route = memberCore.memberRouteFromHash("#space=messages&conversation=c-1&peer=u-2");
  assert.equal(route.conversationId, "c-1");
  assert.equal(route.peerId, "u-2");
  assert.equal(memberCore.hashForMemberRoute(route), "#space=messages&conversation=c-1&peer=u-2");
});

test("own chat messages do not render a permanent 我 author label", async () => {
  const [member, mentor] = await Promise.all([
    read("community/member-ui.js"),
    read("community/mentor-ui.js")
  ]);
  assert.doesNotMatch(member, /mine \? "我"/);
  assert.doesNotMatch(mentor, /mine \? "我"/);
  assert.match(member, /好友身份与会话不匹配/);
  assert.match(member, /route\.peerId/);
});

test("mentor prices are rendered and stored as USDT", async () => {
  const [admin, mentorRepository, member] = await Promise.all([
    read("admin/admin-ui.js"),
    read("community/mentor-repository.js"),
    read("community/member-ui.js")
  ]);
  assert.equal(mentorCore.formatPrice(12345, "USDT"), "123.45 USDT");
  assert.match(admin, /价格（USDT）/);
  assert.doesNotMatch(admin, /价格（元）/);
  assert.match(mentorRepository, /currency: "USDT"/);
  assert.doesNotMatch(member, /claim\.currency \|\| "CNY"/);
});

test("points belong to user management and reward products use an editable update path", async () => {
  const admin = await read("admin/admin-ui.js");
  const users = admin.slice(admin.indexOf("function usersView()"), admin.indexOf("function auditView()"));
  const rewards = admin.slice(admin.indexOf("function rewardsView()"), admin.indexOf("async function perform("));
  assert.match(users, /rewardWalletPanel\(\)/);
  assert.doesNotMatch(rewards, /rewardWalletPanel\(\)/);
  assert.match(admin, /from\("reward_products"\)[\s\S]*?\.update\(row\)\.eq\("id", value\.id\)/);
  assert.match(rewards, /用户积分请在用户管理中调整/);
});

test("left navigation hides the duplicate store entry and profile store keeps its leaderboard", async () => {
  const [member, ...documents] = await Promise.all([
    read("community/member-ui.js"),
    read("index.html"),
    read("elliott-wave-preview.html"),
    read("elliott-wave-knowledge-tree.html")
  ]);
  for (const html of documents) {
    assert.doesNotMatch(html, /data-member-route="space=rewards"|rewardStoreButton/);
    assert.match(html, /wavekb-social-admin-20260804-2/);
  }
  assert.match(member, /积分排行榜/);
  assert.match(member, /leaderboardSection/);
});
