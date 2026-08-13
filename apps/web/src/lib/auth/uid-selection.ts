export const UID_ACTIONS = ["status", "start", "refresh", "select", "complete"] as const;
export type UidAction = typeof UID_ACTIONS[number];

export type UidSelectionState = {
  candidateUids: number[];
  selectedUid: number | null;
  refreshesUsed: number;
  refreshesRemaining: number;
  expiresAt: string;
  status: "pending" | "completed" | "expired";
  publicUid: number | null;
};

export function isUidAction(value: string): value is UidAction {
  return UID_ACTIONS.includes(value as UidAction);
}

export function isValidUid(value: unknown) {
  return Number.isInteger(Number(value)) && Number(value) >= 10000 && Number(value) <= 999999;
}
