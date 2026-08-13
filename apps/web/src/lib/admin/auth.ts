import "server-only";
import { cache } from "react";
import { getCurrentUser, requireCurrentUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export type AdminActor = { id: string; displayName: string };

const getAdminActor = cache(async (): Promise<AdminActor | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  const client = await createClient();
  const profile = await client.from("profiles").select("display_name,role,account_status").eq("id", user.id).maybeSingle();
  if (profile.error || profile.data?.role !== "admin" || profile.data.account_status !== "active") return null;
  return { id: user.id, displayName: profile.data.display_name || "管理员" };
});

export async function requireAdminActor(returnPath: string) {
  await requireCurrentUser(returnPath);
  return getAdminActor();
}
