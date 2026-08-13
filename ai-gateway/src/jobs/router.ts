export function classifyProviderError(error: unknown): "auth" | "retryable" | "fatal" {
  const code = (error as { code?: string })?.code;
  const status = (error as { status?: number })?.status;
  if (code === "AUTH" || status === 401 || status === 403) return "auth";
  if (code === "TIMEOUT" || code === "RATE_LIMIT" || code === "UPSTREAM"
      || status === 429 || (status !== undefined && status >= 500)) return "retryable";
  return "fatal";
}
