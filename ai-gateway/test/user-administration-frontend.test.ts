import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const core = require("../../admin/admin-core.js");

test("admin UID editor accepts only five or six digit UIDs", () => {
  assert.deepEqual(core.validateUid("583104"), { ok: true, value: 583104 });
  assert.deepEqual(core.validateUid("10000"), { ok: true, value: 10000 });
  assert.equal(core.validateUid("9999").ok, false);
  assert.equal(core.validateUid("1234567").ok, false);
  assert.equal(core.validateUid("12A45").ok, false);
});

test("admin status distinguishes banned, muted, and active users", () => {
  const now = Date.parse("2026-07-26T00:00:00Z");
  assert.equal(core.statusLabel({ account_status: "banned" }, now), "已封禁");
  assert.equal(core.statusLabel({
    account_status: "active",
    muted_until: "2026-07-27T00:00:00Z",
  }, now), "禁言中");
  assert.equal(core.statusLabel({
    account_status: "active",
    muted_until: "2026-07-25T00:00:00Z",
  }, now), "正常");
});

test("admin mute presets produce durable server timestamps", () => {
  const now = Date.parse("2026-07-26T00:00:00Z");
  assert.equal(core.muteUntil(24, now), "2026-07-27T00:00:00.000Z");
  assert.equal(core.muteUntil(0, now), null);
});
