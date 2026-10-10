import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function legacyOrderFunctions(client) {
  const source = await readFile(new URL("../admin/admin-ui.js", import.meta.url), "utf8");
  const start = source.indexOf("  function mentorOrderTransitions(status)");
  const end = source.indexOf("  function mentorOrdersView()", start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({ state: { client } });
  vm.runInContext(source.slice(start, end), context);
  return context;
}

test("legacy mentor administration uses the audited expected-status transaction without direct table writes", async () => {
  const calls = [];
  const functions = await legacyOrderFunctions({
    rpc: async (name, body) => { calls.push({ name, body }); return { data: { id: "legacy-order", status: "paid" }, error: null }; },
    from: () => { throw new Error("Legacy client attempted a forbidden table write"); },
  });
  const result = await functions.saveMentorOrderStatus({ id: "legacy-order", status: "pending", amount_cents: 10000 }, "paid");
  assert.equal(result.status, "paid");
  assert.equal(result.amount_cents, 10000);
  assert.equal(calls[0].name, "admin_transition_mentor_order");
  assert.equal(calls[0].body.p_expected_status, "pending");
  assert.equal(calls[0].body.p_status, "paid");
  await assert.rejects(functions.saveMentorOrderStatus({ id: "legacy-order", status: "cancelled" }, "pending"), /不允许/);
  assert.equal(calls.length, 1);
});

test("legacy mentor administration translates concurrent-state conflicts into a refresh message", async () => {
  const functions = await legacyOrderFunctions({ rpc: async () => ({ data: null, error: { message: "order_changed_concurrently" } }) });
  await assert.rejects(functions.saveMentorOrderStatus({ id: "legacy-order", status: "pending" }, "paid"), /订单状态已被其他管理员修改/);
});
