import { createBrowserClient } from "@supabase/ssr";
import { requirePublicSupabaseConfig } from "@/lib/env";

let browserClient: ReturnType<typeof createBrowserClient> | undefined;

export function createClient() {
  if (browserClient) return browserClient;
  const { url, key } = requirePublicSupabaseConfig();
  browserClient = createBrowserClient(url, key);
  return browserClient;
}
