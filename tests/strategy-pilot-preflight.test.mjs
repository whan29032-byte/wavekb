import assert from "node:assert/strict";
import test from "node:test";
import { checkStrategyPilot } from "../scripts/strategy-pilot-preflight.mjs";

const origin = "https://wavekb.com";
const runtime = { identifier: "acceptance@example.test", password: "ephemeral-test" };

function fixtures(trades) {
  const requests = [];
  return {
    requests,
    async fetch(url, init) {
      const target = new URL(url);
      requests.push(target.pathname);
      assert.equal(target.origin, origin);
      const headers = new Headers(init.headers);
      if (target.pathname === "/api/auth/login") {
        assert.equal(init.method, "POST");
        assert.equal(headers.get("origin"), origin);
        return Response.json({ ok: true, needsUidActivation: false }, {
          headers: { "set-cookie": "sb-demo-auth-token.0=temporary; Path=/; Secure; HttpOnly" },
        });
      }
      assert.equal(headers.get("cookie"), "sb-demo-auth-token.0=temporary");
      if (target.pathname === "/api/trading/workbench") {
        return Response.json({ workbench: { connections: [{ id: "acceptance-account", status: "active", read_only_status: "verified" }], trades } });
      }
      if (target.pathname === "/member/profile") {
        return new Response('<a href="/member/12345">取消</a>', { status: 200 });
      }
      throw new Error("unexpected request");
    },
  };
}

test("returns only the acceptance UID and counts after finding a real eligible trade", async () => {
  const f = fixtures([{ connection_id: "acceptance-account", completeness: "complete",
    opened_at: "2026-11-24T00:00:00Z", closed_at: "2026-11-24T00:55:00Z" }]);
  const result = await checkStrategyPilot(runtime, f.fetch);
  assert.deepEqual(result, { uid: "12345", eligibleTrades: 1, usableConnections: 1 });
  assert.deepEqual(f.requests, ["/api/auth/login", "/api/trading/workbench", "/member/profile"]);
});

test("fails closed when the acceptance account has no eligible trade", async () => {
  const f = fixtures([{ connection_id: "other-account", completeness: "complete", closed_at: "2026-11-24T00:55:00Z" }]);
  await assert.rejects(checkStrategyPilot(runtime, f.fetch), { message: "strategy_acceptance_no_eligible_trade" });
  assert.deepEqual(f.requests, ["/api/auth/login", "/api/trading/workbench"]);
});
