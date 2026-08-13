import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requirePublicSupabaseConfig } from "@/lib/env";

let browserClient: SupabaseClient | undefined;

export function createClient(): SupabaseClient {
  if (browserClient) return browserClient;
  const { url, key } = requirePublicSupabaseConfig();
  browserClient = createBrowserClient(url, key);
  return browserClient;
}
