/** A transport failure cannot prove that a database transaction rolled back. */
export class UncertainMutationError extends Error {
  readonly recoveryPath?: string;
  constructor(message: string, recoveryPath?: string) {
    super(message);
    this.name = "UncertainMutationError";
    this.recoveryPath = recoveryPath;
  }
}

export function isUncertainMutationError(error: unknown): error is UncertainMutationError {
  return error instanceof UncertainMutationError;
}

/** Only explicit database rejections establish rollback, never a timeout/HTTP error. */
export function isDefiniteDatabaseRejection(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && code !== "40003" && /^(?:22|23|28|40|42|P0)[A-Z0-9]{3}$/.test(code);
}

// JSONB may return object keys in another order. Arrays retain their semantic order.
export function sameJsonValue(left: unknown, right: unknown): boolean {
  function ordered(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(ordered);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, ordered(item)]));
    }
    return value;
  }
  return JSON.stringify(ordered(left)) === JSON.stringify(ordered(right));
}
