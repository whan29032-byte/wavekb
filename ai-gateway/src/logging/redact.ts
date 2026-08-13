const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const BEARER = /\b(Bearer\s+)[A-Za-z0-9._~+/-]{12,}=*/gi;
const KEY_VALUE = /\b(sk|key|token|secret)[-_A-Za-z0-9]*[=: ]+["']?([A-Za-z0-9._~+/-]{12,}=*)["']?/gi;
const SENSITIVE_FIELD = /(?:^|_)(?:password|passphrase|access_token|refresh_token|registration_token|api_key|authorization|secret)$/i;

export function redactSensitive(value: unknown): string {
  const text = typeof value === "string"
    ? value
    : JSON.stringify(value, (key, fieldValue) => (
      SENSITIVE_FIELD.test(key) ? "[redacted]" : fieldValue
    ));
  return text
    .replace(EMAIL, "[redacted-email]")
    .replace(BEARER, "$1[redacted]")
    .replace(KEY_VALUE, "$1=[redacted]");
}
