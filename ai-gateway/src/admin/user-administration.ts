import type { GatewayConfig } from "../config.ts";
import type { GatewayUser } from "../server.ts";
import { SupabaseRest } from "../storage/supabase-rest.ts";

export type UserListInput = {
  query?: string;
  status?: string;
  role?: string;
  page?: number;
  limit?: number;
};

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw Object.assign(new Error("invalid_request"), { statusCode: 400 });
  }
  return parsed;
}

function requiredId(value: unknown): string {
  const id = String(value || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw Object.assign(new Error("invalid_request"), { statusCode: 400 });
  }
  return id;
}

function reason(value: unknown): string {
  const output = String(value || "").trim();
  if (output.length > 500) {
    throw Object.assign(new Error("reason_too_long"), { statusCode: 400 });
  }
  return output;
}

function databaseError(error: unknown): never {
  const message = String((error as any)?.message || "");
  const known = [
    "admin_required",
    "user_not_found",
    "invalid_status",
    "invalid_role",
    "invalid_uid",
    "invalid_mute_until",
    "reason_too_long",
    "cannot_ban_self",
    "cannot_mute_self",
    "cannot_change_own_role",
    "user_is_banned",
    "uid_unavailable",
  ].find((code) => message.includes(code));
  const conflicts = new Set([
    "cannot_ban_self",
    "cannot_mute_self",
    "cannot_change_own_role",
    "user_is_banned",
    "uid_unavailable",
  ]);
  throw Object.assign(
    new Error(known || "administration_failed"),
    {
      statusCode: known === "admin_required"
        ? 403
        : known === "user_not_found"
        ? 404
        : conflicts.has(known || "")
        ? 409
        : known
        ? 400
        : 503,
    },
  );
}

export class UserAdministrationApi {
  private readonly database: SupabaseRest;

  constructor(config: GatewayConfig) {
    this.database = new SupabaseRest(config);
  }

  private async rpc(name: string, body: Record<string, unknown>): Promise<any> {
    try {
      return await this.database.request(`/rest/v1/rpc/${name}`, {
        method: "POST",
        body,
      });
    } catch (error) {
      return databaseError(error);
    }
  }

  async summary(actor: GatewayUser): Promise<Record<string, unknown>> {
    return await this.rpc("admin_user_summary", { p_actor: actor.id });
  }

  async listUsers(actor: GatewayUser, input: UserListInput): Promise<{
    users: unknown[];
    page: number;
    limit: number;
    total: number;
  }> {
    const page = boundedInteger(input.page, 1, 1, 100000);
    const limit = boundedInteger(input.limit, 25, 1, 100);
    const query = String(input.query || "").trim().slice(0, 120);
    const status = String(input.status || "all");
    const role = String(input.role || "all");
    if (!["all", "active", "banned", "muted"].includes(status)) {
      throw Object.assign(new Error("invalid_status"), { statusCode: 400 });
    }
    if (!["all", "user", "admin"].includes(role)) {
      throw Object.assign(new Error("invalid_role"), { statusCode: 400 });
    }
    const rows = await this.rpc("admin_list_users", {
      p_actor: actor.id,
      p_query: query,
      p_status: status,
      p_role: role,
      p_limit: limit,
      p_offset: (page - 1) * limit,
    });
    return {
      users: Array.isArray(rows) ? rows : [],
      page,
      limit,
      total: Number(rows?.[0]?.total_count || 0),
    };
  }

  async setStatus(
    actor: GatewayUser,
    targetId: unknown,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const status = String(input.status || "");
    if (!["active", "banned"].includes(status)) {
      throw Object.assign(new Error("invalid_status"), { statusCode: 400 });
    }
    return await this.rpc("admin_set_account_status", {
      p_actor: actor.id,
      p_target: requiredId(targetId),
      p_status: status,
      p_reason: reason(input.reason),
    });
  }

  async setMute(
    actor: GatewayUser,
    targetId: unknown,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const value = input.muted_until;
    let mutedUntil: string | null = null;
    if (value !== null && value !== undefined && String(value).trim()) {
      const date = new Date(String(value));
      if (!Number.isFinite(date.getTime())) {
        throw Object.assign(new Error("invalid_mute_until"), { statusCode: 400 });
      }
      mutedUntil = date.toISOString();
    }
    return await this.rpc("admin_set_mute", {
      p_actor: actor.id,
      p_target: requiredId(targetId),
      p_muted_until: mutedUntil,
      p_reason: reason(input.reason),
    });
  }

  async setRole(
    actor: GatewayUser,
    targetId: unknown,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const role = String(input.role || "");
    if (!["user", "admin"].includes(role)) {
      throw Object.assign(new Error("invalid_role"), { statusCode: 400 });
    }
    return await this.rpc("admin_set_role", {
      p_actor: actor.id,
      p_target: requiredId(targetId),
      p_role: role,
      p_reason: reason(input.reason),
    });
  }

  async setUid(
    actor: GatewayUser,
    targetId: unknown,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const uid = Number(input.uid);
    if (!Number.isInteger(uid) || uid < 10000 || uid > 999999) {
      throw Object.assign(new Error("invalid_uid"), { statusCode: 400 });
    }
    return await this.rpc("admin_set_uid", {
      p_actor: actor.id,
      p_target: requiredId(targetId),
      p_uid: uid,
      p_reason: reason(input.reason),
    });
  }

  async listAudit(
    actor: GatewayUser,
    input: { page?: number; limit?: number },
  ): Promise<{ entries: unknown[]; page: number; limit: number }> {
    const page = boundedInteger(input.page, 1, 1, 100000);
    const limit = boundedInteger(input.limit, 50, 1, 100);
    const rows = await this.rpc("admin_list_moderation_audit", {
      p_actor: actor.id,
      p_limit: limit,
      p_offset: (page - 1) * limit,
    });
    return {
      entries: Array.isArray(rows) ? rows : [],
      page,
      limit,
    };
  }
}
