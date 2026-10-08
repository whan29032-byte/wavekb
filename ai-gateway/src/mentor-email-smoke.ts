import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMailbox, isSender, isUuid } from "./mentor-notifications/contracts.ts";
import { ResendMailSender } from "./mentor-notifications/resend.ts";
import type { MailSender } from "./mentor-notifications/contracts.ts";

type Receipt = { test_id: string; first_request_at: string; payload_digest: string; status: "attempted" | "accepted"; provider_message_id?: string; last_event?: string };
type Store = { read(id: string): Receipt | null; save(id: string, receipt: Receipt): void };
const allowedEvents = new Set(["sent", "delivered", "delivery_delayed", "bounced", "complained", "failed", "opened", "clicked", "scheduled", "canceled", "suppressed"]);
const senderKeys = ["MENTOR_EMAIL_API_KEY", "MENTOR_EMAIL_FROM"] as const;

// Only allow-listed settings are read into memory; no values are emitted.
export function readEmailSmokeSettings(source: string): Record<string, string> {
  const settings: Record<string, string> = {};
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (!match || !senderKeys.some((key) => key === match[1])) continue;
    const key = match[1]!;
    if (Object.hasOwn(settings, key)) throw new Error("duplicate_mail_setting");
    let value = match[2] ?? "";
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    settings[key] = value;
  }
  return settings;
}

export function emailSmokePresence(settings: Record<string, string>) {
  return { api_key_configured: Boolean(settings.MENTOR_EMAIL_API_KEY?.trim()), from_configured: Boolean(settings.MENTOR_EMAIL_FROM?.trim()) };
}

export async function verifyTestEmail(settings: Record<string, string>, input: { recipient: string; testId: string; confirmation: string }, dependencies: { store: Store; sender?: MailSender; fetchImpl?: typeof fetch; now?: () => Date }) {
  if (input.confirmation !== "SEND_ONE_TEST_EMAIL" || !isUuid(input.testId) || !isMailbox(input.recipient)
    || /[\r\n,;]/.test(input.recipient)) throw new Error("invalid_mail_test_request");
  const presence = emailSmokePresence(settings);
  if (!presence.api_key_configured || !presence.from_configured) return { ...presence, status: "blocked_unconfigured" };
  const apiKey = (settings.MENTOR_EMAIL_API_KEY ?? "").trim();
  const from = (settings.MENTOR_EMAIL_FROM ?? "").trim();
  if (/\s/.test(apiKey) || !isSender(from)) throw new Error("invalid_mail_test_configuration");
  const now = dependencies.now?.() ?? new Date();
  const payload = { from, to: [input.recipient], subject: "WaveKB：邮件投递测试（非订单通知）", text: `这是一封由网站管理员主动发起的邮件投递测试。\n测试编号：${input.testId}\n\n这不是付款声明、到账通知或订单，不需要导师处理，也不会创建订单或改变任何账户权益。` };
  const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  let receipt = dependencies.store.read(input.testId);
  if (receipt && (receipt.test_id !== input.testId || receipt.payload_digest !== digest)) throw new Error("mail_test_payload_conflict");
  if (receipt?.status !== "accepted") {
    if (receipt && (!Number.isFinite(Date.parse(receipt.first_request_at)) || now.getTime() - Date.parse(receipt.first_request_at) > 23 * 60 * 60 * 1000)) throw new Error("mail_test_idempotency_expired");
    receipt ??= { test_id: input.testId, first_request_at: now.toISOString(), payload_digest: digest, status: "attempted" };
    // Save before the request. A lost response cannot erase the bounded retry
    // window, and a known accepted request will never be sent again.
    dependencies.store.save(input.testId, receipt);
    const sender = dependencies.sender ?? new ResendMailSender(apiKey);
    const accepted = await sender.send(payload, `mentor-email-smoke:${input.testId}`);
    receipt = { ...receipt, status: "accepted", provider_message_id: accepted.providerMessageId };
    dependencies.store.save(input.testId, receipt);
  }
  if (!isUuid(receipt.provider_message_id)) throw new Error("mail_test_receipt_invalid");
  let lastEvent = "unverified";
  let lookup = "unavailable";
  try {
    const response = await (dependencies.fetchImpl ?? fetch)(`https://api.resend.com/emails/${receipt.provider_message_id}`, {
      headers: { authorization: `Bearer ${apiKey}` }, redirect: "error", signal: AbortSignal.timeout(15000),
    });
    // A sending-only key may not retrieve email status. Do not request broader
    // production permissions or print the response's addresses/content.
    if (response.status === 401 || response.status === 403) lookup = "not_permitted";
    else if (response.status === 429) lookup = "rate_limited";
    else if (response.ok) {
      const result = await response.json() as { id?: unknown; last_event?: unknown };
      if (result.id === receipt.provider_message_id && typeof result.last_event === "string" && allowedEvents.has(result.last_event)) {
        lastEvent = result.last_event; lookup = "verified";
        receipt = { ...receipt, last_event: lastEvent };
        dependencies.store.save(input.testId, receipt);
      }
    }
  } catch { /* Known acceptance remains acceptance, not falsely delivery. */ }
  return { test_id: input.testId, first_request_at: receipt.first_request_at, provider_message_id: receipt.provider_message_id, status: "accepted", last_event: lastEvent, delivery_lookup: lookup, inbox_receipt_verified: false };
}

function fileStore(): Store {
  const directory = "/var/lib/elliott-wave-gateway/mail-smoke";
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filename = (id: string) => { if (!isUuid(id)) throw new Error("invalid_mail_test_request"); return path.join(directory, `${id}.json`); };
  return {
    read(id) { try { return JSON.parse(fs.readFileSync(filename(id), "utf8")) as Receipt; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw new Error("mail_test_receipt_unreadable"); } },
    save(id, receipt) { fs.writeFileSync(filename(id), `${JSON.stringify(receipt)}\n`, { mode: 0o600 }); },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const settings = readEmailSmokeSettings(fs.readFileSync("/etc/elliott-wave/gateway.env", "utf8"));
    if (process.argv[2] === "check-config") console.info(JSON.stringify(emailSmokePresence(settings)));
    else if (process.argv[2] === "send-once") {
      const recipient = Buffer.from(process.argv[4] || "", "base64url").toString("utf8");
      const result = await verifyTestEmail(settings, { recipient, testId: process.argv[3] || "", confirmation: process.argv[5] || "" }, { store: fileStore() });
      console.info(JSON.stringify(result));
      if (result.status === "blocked_unconfigured") process.exitCode = 2;
    } else throw new Error("invalid_mail_test_request");
  } catch {
    console.error("mail_test_failed_or_unverified");
    process.exitCode = 1;
  }
}
