export function classifyProviderError(error: unknown): "auth" | "retryable" | "fatal" {
  const code = (error as { code?: string })?.code;
  const status = (error as { status?: number })?.status;
  // Contract, citation and safety failures must never be retried as if they
  // were transient provider outages. Both analysis task families use this
  // terminal path after their one bounded same-provider repair attempt.
  if (code === "invalid_model_output" || code === "invalid_trade_review_output"
    || code === "knowledge_unavailable" || code === "input_context_too_large") return "fatal";
  if (code === "AUTH" || status === 401 || status === 403) return "auth";
  if (code === "TIMEOUT" || code === "RATE_LIMIT" || code === "UPSTREAM"
      || status === 429 || (status !== undefined && status >= 500)) return "retryable";
  return "fatal";
}
