import type { VerifiedUser } from "./verify-user.ts";

export function requireRole(user: VerifiedUser, role: string): void {
  if (user.role !== role) {
    throw Object.assign(new Error("forbidden"), { statusCode: 403 });
  }
}
