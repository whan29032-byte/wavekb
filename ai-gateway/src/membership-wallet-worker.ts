import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.ts";
import {
  runMembershipWalletVerificationCycle,
  type WalletCycleInput,
  type WalletCycleResult,
} from "./membership-wallet/worker.ts";
import { SupabaseRest } from "./storage/supabase-rest.ts";

type LoopDependencies = {
  cycle?: (input: WalletCycleInput) => Promise<WalletCycleResult>;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
};

// Independent read-only verification loop. It never signs transactions or
// changes the existing AI worker's retry policy, authorization or job queue.
export class MembershipWalletWorker {
  private readonly input: WalletCycleInput;
  private readonly cycle: NonNullable<LoopDependencies["cycle"]>;
  private readonly wait: NonNullable<LoopDependencies["wait"]>;
  private readonly shutdown = new AbortController();
  private running: Promise<void> | undefined;

  constructor(input: WalletCycleInput, dependencies: LoopDependencies = {}) {
    this.input = input;
    this.cycle = dependencies.cycle ?? runMembershipWalletVerificationCycle;
    this.wait = dependencies.wait ?? (async (milliseconds, signal) => {
      await sleep(milliseconds, undefined, { signal });
    });
  }

  stop(): void { this.shutdown.abort(); }

  run(): Promise<void> {
    this.running ??= this.loop();
    return this.running;
  }

  private async loop(): Promise<void> {
    if (this.input.env.MEMBERSHIP_WALLET_ENABLED !== "true") return;
    while (!this.shutdown.signal.aborted) {
      let delay = 60_000;
      try {
        const result = await this.cycle(this.input);
        if (result.state === "disabled") return;
        if (result.state === "ready") delay = 15_000;
      } catch {
        // Do not expose RPC URL credentials, database errors or transaction
        // payloads. A temporary failure preserves pending invoices and leases.
      }
      if (this.shutdown.signal.aborted) return;
      try { await this.wait(delay, this.shutdown.signal); }
      catch { if (this.shutdown.signal.aborted) return; }
    }
  }
}

const isMain = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (isMain && process.env.MEMBERSHIP_WALLET_ENABLED === "true") {
  const worker = new MembershipWalletWorker({
    database: new SupabaseRest(loadConfig(process.env)),
    env: process.env,
    workerId: `${hostname()}:${process.pid}:membership-wallet`,
  });
  process.once("SIGTERM", () => worker.stop());
  process.once("SIGINT", () => worker.stop());
  await worker.run();
}
