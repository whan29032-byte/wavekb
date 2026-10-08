export type MailEnvelope = {
  from: string;
  to: string[];
  subject: string;
  text: string;
};

export type ClaimedNotification = {
  id: string;
  leaseToken: string;
  attempts: number;
  eventKey: string;
};

export type Preparation =
  | { state: "ready"; payload: MailEnvelope }
  | { state: "skipped" }
  | { state: "lease_lost" }
  | { state: "unavailable"; code: "recipient_unavailable" | "recipient_changed" | "idempotency_window_expired" };

export type NotificationFailureCode =
  | "recipient_unavailable"
  | "recipient_changed"
  | "idempotency_window_expired"
  | "provider_rate_limited"
  | "provider_unavailable"
  | "provider_unauthorized"
  | "provider_rejected"
  | "provider_response_invalid"
  | "worker_request_failed";

export type NotificationOutcome =
  | { outcome: "accepted"; providerMessageId: string }
  | { outcome: "failed"; code: NotificationFailureCode; retryable: boolean; retryAfterSeconds?: number | null };

export interface NotificationRepository {
  claimBatch(): Promise<ClaimedNotification[]>;
  prepare(job: ClaimedNotification, from: string, manageUrl: string): Promise<Preparation>;
  finish(job: ClaimedNotification, outcome: NotificationOutcome): Promise<boolean>;
}

export interface MailSender {
  send(payload: MailEnvelope, idempotencyKey: string): Promise<{ providerMessageId: string }>;
}

export class MailProviderError extends Error {
  readonly code: NotificationFailureCode;
  readonly retryable: boolean;
  readonly retryAfterSeconds: number | null;

  constructor(code: NotificationFailureCode, retryable: boolean, retryAfterSeconds: number | null = null) {
    super(code);
    this.name = "MailProviderError";
    this.code = code;
    this.retryable = retryable;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export const isMailbox = (value: unknown): boolean =>
  typeof value === "string" && value.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);

export function isSender(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 320 || /[\r\n]/.test(value)) return false;
  if (isMailbox(value)) return true;
  const match = value.match(/^[^<>\r\n]+ <([^<>]+)>$/);
  return Boolean(match && isMailbox(match[1]));
}

export function isMailEnvelope(value: unknown): value is MailEnvelope {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<MailEnvelope>;
  return isSender(payload.from)
    && Array.isArray(payload.to) && payload.to.length === 1 && isMailbox(payload.to[0])
    && typeof payload.subject === "string" && payload.subject.length > 0
    && payload.subject.length <= 300 && !/[\r\n]/.test(payload.subject)
    && typeof payload.text === "string" && payload.text.length > 0 && payload.text.length <= 20_000;
}
