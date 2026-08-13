export type UsageRecord = {
  jobId: string;
  ownerId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  confirmed: boolean;
  at: string;
};

export function createUsageRecord(
  input: Omit<UsageRecord, "at">,
  now = () => new Date(),
): UsageRecord {
  if (input.inputTokens < 0 || input.outputTokens < 0 || input.cost < 0) {
    throw new Error("usage values cannot be negative");
  }
  return { ...input, at: now().toISOString() };
}
