import type { MentorNotificationConfig } from "./config.ts";
import { MailProviderError } from "./contracts.ts";
import type { ClaimedNotification, MailSender, NotificationRepository } from "./contracts.ts";
import { SupabaseNotificationRepository } from "./repository.ts";
import { ResendMailSender } from "./resend.ts";

export type NotificationLogCode = "notification_disabled" | "notification_unconfigured"
  | "notification_poll_failed" | "notification_settlement_failed";

export class MentorNotificationWorker {
  private readonly config: MentorNotificationConfig;
  private readonly repository: NotificationRepository;
  private readonly sender: MailSender;
  private readonly log: (code: NotificationLogCode) => void;
  private readonly wait: (milliseconds: number) => Promise<void>;
  private readonly now: () => number;
  private nextSendAt = 0;
  private stopping = false;
  private activePoll: Promise<number> | null = null;
  private configurationReported = false;

  constructor(config: MentorNotificationConfig, dependencies: {
    repository?: NotificationRepository;
    sender?: MailSender;
    log?: (code: NotificationLogCode) => void;
    wait?: (milliseconds: number) => Promise<void>;
    now?: () => number;
  } = {}) {
    this.config = config;
    this.repository = dependencies.repository ?? new SupabaseNotificationRepository(config);
    this.sender = dependencies.sender ?? new ResendMailSender(config.apiKey);
    this.log = dependencies.log ?? (() => undefined);
    this.wait = dependencies.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.now = dependencies.now ?? Date.now;
  }

  stop(): void { this.stopping = true; }

  private async process(job: ClaimedNotification): Promise<void> {
    let providerAccepted = false;
    try {
      const prepared = await this.repository.prepare(job, this.config.from, this.config.manageUrl);
      if (prepared.state === "lease_lost" || prepared.state === "skipped") return;
      if (prepared.state === "unavailable") {
        await this.repository.finish(job, { outcome: "failed", code: prepared.code, retryable: false });
        return;
      }
      if (this.stopping) return;
      const delay = Math.max(0, this.nextSendAt - this.now());
      if (delay) await this.wait(delay);
      if (this.stopping) return;
      this.nextSendAt = this.now() + 600;
      const result = await this.sender.send(prepared.payload, job.eventKey);
      providerAccepted = true;
      await this.repository.finish(job, { outcome: "accepted", providerMessageId: result.providerMessageId });
    } catch (error) {
      // Acceptance with a lost DB acknowledgement stays leased. Crash recovery
      // reuses the frozen envelope/key, rather than claiming the send failed.
      if (providerAccepted) {
        this.log("notification_settlement_failed");
        return;
      }
      const failure = error instanceof MailProviderError
        ? { code: error.code, retryable: error.retryable, retryAfterSeconds: error.retryAfterSeconds }
        : { code: "worker_request_failed" as const, retryable: true };
      if (error instanceof MailProviderError && error.code === "provider_rate_limited") {
        this.nextSendAt = this.now() + Math.max(30, error.retryAfterSeconds ?? 30) * 1000;
      }
      try {
        await this.repository.finish(job, { outcome: "failed", ...failure });
      } catch {
        this.log("notification_settlement_failed");
      }
    }
  }

  async pollOnce(): Promise<number> {
    if (this.stopping) return 0;
    if (!this.config.enabled || this.config.readiness !== "ready") {
      if (!this.configurationReported) {
        this.log(!this.config.enabled ? "notification_disabled" : "notification_unconfigured");
        this.configurationReported = true;
      }
      return 0;
    }
    // Team-wide rate limits affect later jobs too. Do not acquire another
    // notification while the current provider cooldown remains in effect.
    if (this.nextSendAt - this.now() > 600) return 0;
    // A single process must not acquire overlapping batches.
    if (this.activePoll) return this.activePoll;
    const poll = async () => {
      const jobs = await this.repository.claimBatch();
      let processed = 0;
      for (const job of jobs) {
        if (this.stopping || this.nextSendAt - this.now() > 600) break;
        await this.process(job);
        processed += 1;
      }
      return processed;
    };
    this.activePoll = poll();
    try { return await this.activePoll; }
    finally { this.activePoll = null; }
  }

  async run(): Promise<void> {
    while (!this.stopping) {
      try { await this.pollOnce(); }
      catch { this.log("notification_poll_failed"); }
      if (!this.stopping) await this.wait(this.config.pollMs);
    }
  }
}
