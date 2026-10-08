import type { MentorNotificationConfig } from "./config.ts";
import { isMailEnvelope, isUuid } from "./contracts.ts";
import type { ClaimedNotification, NotificationOutcome, NotificationRepository, Preparation } from "./contracts.ts";

export class SupabaseNotificationRepository implements NotificationRepository {
  private readonly config: MentorNotificationConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: MentorNotificationConfig, fetchImpl: typeof fetch = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  private async rpc(name: string, body: Record<string, unknown>): Promise<unknown> {
    try {
      const response = await this.fetchImpl(`${this.config.supabaseUrl}/rest/v1/rpc/${name}`, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        headers: {
          apikey: this.config.serviceRoleKey,
          authorization: `Bearer ${this.config.serviceRoleKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error();
      return await response.json();
    } catch {
      // Database errors may contain row/recipient details. Never propagate them.
      throw new Error("mentor_notification_database_unavailable");
    }
  }

  async claimBatch(): Promise<ClaimedNotification[]> {
    // Acquire only the next send: rate-limit cooldowns must not consume attempts
    // or hold leases for sibling notifications that have not been sent.
    const value = await this.rpc("claim_mentor_payment_notifications", { p_batch_size: 1 });
    if (!Array.isArray(value) || value.length > 1) throw new Error("mentor_notification_response_invalid");
    return value.map((row: Record<string, unknown>) => {
      if (!isUuid(row.id) || !isUuid(row.lease_token) || !Number.isInteger(row.attempts)
        || typeof row.event_key !== "string" || !/^mentor-payment-claim:[0-9a-f-]{36}$/i.test(row.event_key)
        || Number(row.attempts) < 1 || Number(row.attempts) > 6) {
        throw new Error("mentor_notification_response_invalid");
      }
      return { id: row.id, leaseToken: row.lease_token, attempts: Number(row.attempts), eventKey: row.event_key };
    });
  }

  async prepare(job: ClaimedNotification, from: string, manageUrl: string): Promise<Preparation> {
    const value = await this.rpc("prepare_mentor_payment_notification", {
      p_id: job.id, p_lease_token: job.leaseToken, p_from: from, p_manage_url: manageUrl,
    }) as Record<string, unknown> | null;
    if (value?.state === "skipped" || value?.state === "lease_lost") return { state: value.state };
    if (value?.state === "unavailable" && (value.code === "recipient_unavailable"
      || value.code === "recipient_changed" || value.code === "idempotency_window_expired")) {
      return { state: "unavailable", code: value.code };
    }
    if (value?.state === "ready" && isMailEnvelope(value.payload)) return { state: "ready", payload: value.payload };
    throw new Error("mentor_notification_response_invalid");
  }

  async finish(job: ClaimedNotification, outcome: NotificationOutcome): Promise<boolean> {
    const value = await this.rpc("finish_mentor_payment_notification", {
      p_id: job.id,
      p_lease_token: job.leaseToken,
      p_outcome: outcome.outcome,
      p_provider_message_id: outcome.outcome === "accepted" ? outcome.providerMessageId : null,
      p_error_code: outcome.outcome === "failed" ? outcome.code : null,
      p_retryable: outcome.outcome === "failed" ? outcome.retryable : false,
      p_retry_after_seconds: outcome.outcome === "failed" ? outcome.retryAfterSeconds ?? null : null,
    });
    if (typeof value !== "boolean") throw new Error("mentor_notification_response_invalid");
    return value;
  }
}
