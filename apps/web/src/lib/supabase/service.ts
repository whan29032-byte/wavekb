import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { requirePublicSupabaseConfig } from "@/lib/env";

export function createServiceClient(serviceRoleKey: string) {
  const { url } = requirePublicSupabaseConfig();
  return createSupabaseClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
