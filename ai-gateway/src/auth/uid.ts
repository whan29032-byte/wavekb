import { authError, type Identifier } from "./contracts.ts";

const UID_PATTERN = /^[1-9]\d{4,5}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;

export function validateUid(value: unknown): number {
  const text = String(value ?? "").trim();
  if (!UID_PATTERN.test(text)) {
    throw authError("invalid_uid");
  }
  const uid = Number(text);
  if (!Number.isSafeInteger(uid) || uid < 10_000 || uid > 999_999) {
    throw authError("invalid_uid");
  }
  return uid;
}

export function normalizeEmail(value: unknown): string {
  const email = String(value ?? "").trim().toLowerCase();
  if (
    !email
    || email.length > MAX_EMAIL_LENGTH
    || !EMAIL_PATTERN.test(email)
  ) {
    throw authError("invalid_identifier");
  }
  return email;
}

export function classifyIdentifier(value: string): Identifier {
  const text = String(value ?? "").trim();
  if (UID_PATTERN.test(text)) {
    return { kind: "uid", value: String(validateUid(text)) };
  }
  try {
    return { kind: "email", value: normalizeEmail(text) };
  } catch {
    throw authError("invalid_identifier");
  }
}
