import assert from "node:assert/strict";
import { test } from "node:test";
import { MembershipWalletWorker } from "../src/membership-wallet-worker.ts";
import type { WalletCycleInput, WalletCycleResult } from "../src/membership-wallet/worker.ts";

const input = (enabled = "true"): WalletCycleInput => ({
  database: { request: async () => { throw new Error("unexpected database request"); } },
  env: { MEMBERSHIP_WALLET_ENABLED: enabled }, workerId: "wallet-loop-test",
});
const ready: WalletCycleResult = {
  state: "ready", claimed: 0, applied: 0, waiting: 0, review: 0, leaseLost: 0,
};

test("disabled wallet loop does not claim jobs or require server credentials", async () => {
  let cycles = 0;
  for (const enabled of ["false", "", "TRUE", "1"]) {
    const worker = new MembershipWalletWorker(input(enabled), {
      cycle: async () => { cycles += 1; return ready; },
      wait: async () => { throw new Error("unexpected wait"); },
    });
    await worker.run();
  }
  assert.equal(cycles, 0);
});

test("wallet loop retries transient failures independently with a bounded backoff", async () => {
  const waits: number[] = [];
  let cycles = 0;
  let worker: MembershipWalletWorker;
  worker = new MembershipWalletWorker(input(), {
    cycle: async () => {
      cycles += 1;
      if (cycles === 1) throw new Error("provider unavailable");
      return ready;
    },
    wait: async (milliseconds) => {
      waits.push(milliseconds);
      if (waits.length === 2) worker.stop();
    },
  });
  await worker.run();
  assert.equal(cycles, 2);
  assert.deepEqual(waits, [60_000, 15_000]);
});

test("an unconfigured wallet loop waits without spinning or changing invoices", async () => {
  let cycles = 0;
  const worker = new MembershipWalletWorker(input(), {
    cycle: async () => { cycles += 1; return { ...ready, state: "unconfigured" }; },
    wait: async (milliseconds) => { assert.equal(milliseconds, 60_000); worker.stop(); },
  });
  await worker.run();
  assert.equal(cycles, 1);
});

test("concurrent run calls share one loop and stopping interrupts its sleep", async () => {
  let cycles = 0;
  let sleeping!: () => void;
  const started = new Promise<void>((resolve) => { sleeping = resolve; });
  const worker = new MembershipWalletWorker(input(), {
    cycle: async () => { cycles += 1; return ready; },
    wait: async (_milliseconds, signal) => {
      sleeping();
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    },
  });
  const first = worker.run();
  const second = worker.run();
  assert.equal(first, second);
  await started;
  worker.stop();
  await first;
  assert.equal(cycles, 1);
});
