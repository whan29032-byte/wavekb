import type { SupabaseRest } from "../storage/supabase-rest.ts";
import { loadMembershipWalletVerificationConfig } from "./config.ts";
import { UUID } from "./contracts.ts";
import type { ClaimedWalletVerification } from "./contracts.ts";
import { verifyMembershipWalletTransfer } from "./verifier.ts";

export type WalletCycleInput = { database: Pick<SupabaseRest, "request">; env: Record<string, string | undefined>;
  workerId: string; fetch?: typeof fetch; now?: () => number };
export type WalletCycleResult = { state: "disabled" | "unconfigured" | "ready"; claimed: number; applied: number; waiting: number; review: number; leaseLost: number };
const activeCycles = new WeakSet<object>();

// One bounded batch; integration owns the polling loop and shutdown. No chain
// signing, transfers, refunds or client-supplied verification claims exist here.
export async function runMembershipWalletVerificationCycle(input: WalletCycleInput): Promise<WalletCycleResult> {
  const config = loadMembershipWalletVerificationConfig(input.env);
  const stats: WalletCycleResult = { state: config.readiness, claimed: 0, applied: 0, waiting: 0, review: 0, leaseLost: 0 };
  if (!config.enabled || config.readiness !== "ready") return stats;
  if (!input.workerId || input.workerId.length > 100 || /[\r\n]/.test(input.workerId)) throw new Error("membership_wallet_worker_invalid");
  if (activeCycles.has(input.database)) return stats;
  activeCycles.add(input.database);
  const now = input.now ?? Date.now;
  try {
    const claimed: unknown = await input.database.request("/rest/v1/rpc/claim_membership_wallet_verifications", {
      method: "POST", body: { p_limit: config.batchSize, p_worker_id: input.workerId },
    });
    if (!Array.isArray(claimed) || claimed.length > config.batchSize) throw new Error("membership_wallet_queue_invalid");
    stats.claimed = claimed.length;
    for (const value of claimed) {
      const job = value as ClaimedWalletVerification;
      if (!job || !UUID.test(job.id) || !UUID.test(job.order_id) || !UUID.test(job.lease_id) || job.status !== "leased"
        || job.order?.id !== job.order_id || !Number.isSafeInteger(job.attempts) || job.attempts < 1) throw new Error("membership_wallet_queue_invalid");
      const expires = Date.parse(job.lease_expires_at);
      if (!Number.isFinite(expires) || expires <= now() + 1000) { stats.leaseLost += 1; continue; }
      const signal = AbortSignal.timeout(Math.max(1, expires - now() - 1000));
      const result = await verifyMembershipWalletTransfer(job, config, { ...(input.fetch ? { fetch: input.fetch } : {}), now, signal });
      // SQL repeats lease/token/expiry checks atomically. A timed-out verifier
      // must not alter a job now owned by another process.
      if (expires <= now() + 1000) { stats.leaseLost += 1; continue; }
      try {
        if (result.outcome === "verified") {
          const receipt = await input.database.request("/rest/v1/rpc/apply_verified_membership_wallet_transfer", {
            method: "POST", body: { p_order_id: job.order_id, p_lease_id: job.lease_id, p_evidence: result.evidence },
          });
          if (receipt?.outcome === "paid" && (receipt?.applied === true || receipt?.duplicate === true)) stats.applied += 1;
          else if (receipt?.outcome === "review") stats.review += 1;
          else stats.leaseLost += 1;
        } else {
          const exponential = Math.min(3600, 30 * 2 ** Math.min(job.attempts - 1, 7));
          const receipt = await input.database.request("/rest/v1/rpc/settle_membership_wallet_verification", { method: "POST", body: {
            p_verification_id: job.id, p_lease_id: job.lease_id, p_outcome: result.outcome, p_reason: result.reason,
            p_retry_after_seconds: Math.max(exponential, result.retryAfterSeconds ?? 60),
          } });
          if (receipt?.status === "waiting") stats.waiting += 1;
          else if (receipt?.status === "review") stats.review += 1;
          else stats.leaseLost += 1;
        }
      } catch {
        // A lost acknowledgement is not proof that settlement failed. Leave
        // the lease intact; SQL crash recovery and receipt uniqueness retry it.
        // Never attempt a second contradictory settlement or expose DB details.
        stats.leaseLost += 1;
      }
    }
    return stats;
  } finally { activeCycles.delete(input.database); }
}
