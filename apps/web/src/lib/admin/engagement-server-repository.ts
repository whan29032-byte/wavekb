import "server-only";
import { requireAdminActor } from "@/lib/admin/auth";
import { createClient } from "@/lib/supabase/server";
import type { CommunityEngagementSettings } from "@/lib/admin/engagement-types";

export async function getAdminEngagementSettings(): Promise<CommunityEngagementSettings> {
  const actor = await requireAdminActor("/admin/engagement");
  if (!actor) throw new Error("admin_required");
  const client = await createClient();
  const result = await client.rpc("admin_get_community_engagement_settings");
  if (result.error) throw result.error;
  return result.data as CommunityEngagementSettings;
}
