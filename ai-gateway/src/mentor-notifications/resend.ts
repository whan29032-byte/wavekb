import { isMailEnvelope, isUuid, MailProviderError } from "./contracts.ts";
import type { MailEnvelope, MailSender } from "./contracts.ts";

// Official API contract: https://resend.com/docs/api-reference/emails/send-email
// Fixed origin and no redirects: service credentials never follow a supplied URL.
const SEND_EMAIL_URL = "https://api.resend.com/emails";

export function retryAfterSeconds(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = /^\d+$/.test(value.trim()) ? Number(value.trim()) : (Date.parse(value) - now) / 1000;
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(1800, Math.ceil(seconds)) : null;
}

export class ResendMailSender implements MailSender {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(apiKey: string, fetchImpl: typeof fetch = fetch) {
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
  }

  async send(payload: MailEnvelope, idempotencyKey: string): Promise<{ providerMessageId: string }> {
    if (!this.apiKey || /\s/.test(this.apiKey) || !isMailEnvelope(payload)
      || !/^mentor-payment-claim:[0-9a-f-]{36}$/i.test(idempotencyKey)) {
      throw new MailProviderError("provider_rejected", false);
    }
    let response: Response;
    try {
      response = await this.fetchImpl(SEND_EMAIL_URL, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        // Only the fixed, private envelope is sent; no arbitrary caller fields.
        body: JSON.stringify({ from: payload.from, to: payload.to, subject: payload.subject, text: payload.text }),
      });
    } catch {
      throw new MailProviderError("provider_unavailable", true);
    }
    const remoteDelay = retryAfterSeconds(response.headers.get("retry-after"));
    if (response.status === 429) throw new MailProviderError("provider_rate_limited", true, remoteDelay);
    if (response.status === 401 || response.status === 403) throw new MailProviderError("provider_unauthorized", false);
    let result: Record<string, unknown> | null;
    try {
      result = await response.json() as Record<string, unknown> | null;
    } catch {
      const retryable = response.ok || response.status === 408 || response.status === 425 || response.status >= 500;
      throw new MailProviderError(response.ok ? "provider_response_invalid"
        : retryable ? "provider_unavailable" : "provider_rejected", retryable, remoteDelay);
    }
    if (response.ok) {
      if (!isUuid(result?.id)) throw new MailProviderError("provider_response_invalid", true);
      return { providerMessageId: result.id };
    }
    if (response.status === 408 || response.status === 425 || response.status >= 500
      || (response.status === 409 && result?.name === "concurrent_idempotent_requests")) {
      throw new MailProviderError("provider_unavailable", true, remoteDelay);
    }
    throw new MailProviderError("provider_rejected", false);
  }
}
