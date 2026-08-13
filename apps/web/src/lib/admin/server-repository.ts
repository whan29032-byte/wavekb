import "server-only";
import { requireAdminActor } from "@/lib/admin/auth";
import { createClient } from "@/lib/supabase/server";

export type AdminSummary = {
  total_users: number;
  active_users: number;
  banned_users: number;
  muted_users: number;
  admin_users: number;
  new_today: number;
};

export type AdminUser = {
  id: string;
  email: string;
  public_uid: number | null;
  display_name: string;
  avatar_url: string | null;
  role: "user" | "admin";
  account_status: "active" | "banned";
  muted_until: string | null;
  moderation_note: string;
  email_confirmed: boolean;
  last_sign_in_at: string | null;
  created_at: string;
};

export type AdminAuditEntry = {
  id: string;
  action: "ban" | "unban" | "mute" | "unmute" | "grant_admin" | "revoke_admin" | "set_uid";
  reason: string;
  actor_id: string;
  actor_name: string;
  actor_uid: number | null;
  target_id: string;
  target_name: string;
  target_uid: number | null;
  before_state: Record<string, unknown>;
  after_state: Record<string, unknown>;
  created_at: string;
};

export type AdminDirectoryResource = {
  id: string;
  platform: "x" | "discord";
  name: string;
  description: string;
  url: string;
  avatar_url: string | null;
  active: boolean;
  sort_order: number;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
};

async function adminGatewayRequest<T>(path: string): Promise<T> {
  const actor = await requireAdminActor("/admin/users");
  if (!actor) throw new Error("admin_required");
  const client = await createClient();
  const session = await client.auth.getSession();
  const accessToken = session.data.session?.access_token;
  if (!accessToken) throw new Error("authentication_required");
  const origin = (process.env.AUTH_GATEWAY_INTERNAL_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
  const response = await fetch(`${origin}/v1/admin/${path.replace(/^\/+/, "")}`, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(payload.error || "administration_failed"));
  return payload as T;
}

export async function getAdminSummary(): Promise<AdminSummary> {
  const value = await adminGatewayRequest<Partial<AdminSummary>>("users/summary");
  return {
    total_users: Number(value.total_users || 0),
    active_users: Number(value.active_users || 0),
    banned_users: Number(value.banned_users || 0),
    muted_users: Number(value.muted_users || 0),
    admin_users: Number(value.admin_users || 0),
    new_today: Number(value.new_today || 0),
  };
}

export async function listAdminUsers(input: { query?: string; status?: string; role?: string; page?: number; limit?: number }) {
  const params = new URLSearchParams({
    query: String(input.query || "").slice(0, 120),
    status: ["active", "banned", "muted"].includes(String(input.status)) ? String(input.status) : "all",
    role: ["user", "admin"].includes(String(input.role)) ? String(input.role) : "all",
    page: String(Math.max(1, Number(input.page || 1))),
    limit: String(Math.min(Math.max(1, Number(input.limit || 25)), 100)),
  });
  const value = await adminGatewayRequest<{ users?: AdminUser[]; total?: number; page?: number; limit?: number }>(`users?${params}`);
  return { users: Array.isArray(value.users) ? value.users : [], total: Number(value.total || 0), page: Number(value.page || 1), limit: Number(value.limit || 25) };
}

export async function listAdminAudit(): Promise<AdminAuditEntry[]> {
  const value = await adminGatewayRequest<{ entries?: AdminAuditEntry[] }>("moderation-audit?limit=100&page=1");
  return Array.isArray(value.entries) ? value.entries : [];
}

export async function listAdminDirectory(): Promise<AdminDirectoryResource[]> {
  const value = await adminGatewayRequest<{ resources?: AdminDirectoryResource[] }>("directory");
  return (Array.isArray(value.resources) ? value.resources : []).map((item) => ({ ...item, sort_order: Number(item.sort_order || 0) }));
}
