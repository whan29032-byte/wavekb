import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { publicSupabaseConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const getCurrentUser = cache(async () => {
  if (!publicSupabaseConfig().configured) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user;
});

export async function requireCurrentUser(returnPath: string) {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(returnPath)}`);
  return user;
}

export async function requireActiveMember(returnPath: string) {
  const user = await requireCurrentUser(returnPath);
  const supabase = await createClient();
  const profile = await supabase.from("profiles").select("public_uid").eq("id", user.id).maybeSingle();
  if (profile.error || profile.data?.public_uid == null) {
    redirect(`/activate-uid?next=${encodeURIComponent(returnPath)}`);
  }
  return { ...user, publicUid: Number(profile.data.public_uid) };
}
