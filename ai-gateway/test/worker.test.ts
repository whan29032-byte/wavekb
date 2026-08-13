import assert from "node:assert/strict";
import test from "node:test";
import { runWorkerOnce } from "../src/jobs/worker.ts";

test("timeout switches to fallback and records both attempts", async () => {
  const attempts: any[] = [];
  const usage: any[] = [];
  const result = await runWorkerOnce(
    { id: "job-1", ownerId: "user-1", payload: {} },
    { models: ["primary", "fallback-1"], maxCost: 10 },
    {
      invoke: async (model) => {
        if (model === "primary") throw Object.assign(new Error("timeout"), { code: "TIMEOUT" });
        return { text: "ok", usage: { inputTokens: 10, outputTokens: 5 }, cost: 0.01 };
      },
      recordAttempt: (entry) => attempts.push(entry),
      recordUsage: (entry) => usage.push(entry),
    },
  );
  assert.deepEqual(attempts.map((item) => item.model), ["primary", "fallback-1"]);
  assert.equal(result.actualModel, "fallback-1");
  assert.equal(usage.length, 1);
});

test("authentication error does not retry the same credential", async () => {
  const attempts: any[] = [];
  await assert.rejects(() => runWorkerOnce(
    { id: "job-2", ownerId: "user-1", payload: {} },
    { models: ["primary"], maxCost: 10 },
    {
      invoke: async () => { throw Object.assign(new Error("unauthorized"), { code: "AUTH" }); },
      recordAttempt: (entry) => attempts.push(entry),
      recordUsage: () => undefined,
    },
  ));
  assert.equal(attempts.filter((item) => item.model === "primary").length, 1);
});
