import type { SupabaseClient } from "@supabase/supabase-js";
import type { CommunityEngagementSettings } from "@/lib/admin/engagement-types";

export async function saveCommunityEngagementSettings(
  client: SupabaseClient,
  settings: CommunityEngagementSettings,
): Promise<CommunityEngagementSettings> {
  const result = await client.rpc("admin_update_community_engagement_settings", {
    p_virtual_enabled: settings.virtual_enabled,
    p_like_points: settings.like_points,
    p_like_daily_cap: settings.like_daily_cap,
    p_active_weight_threshold: settings.active_weight_threshold,
    p_inactive_view_min: settings.inactive_view_min,
    p_inactive_view_max: settings.inactive_view_max,
    p_inactive_like_min: settings.inactive_like_min,
    p_inactive_like_max: settings.inactive_like_max,
    p_active_view_min: settings.active_view_min,
    p_active_view_max: settings.active_view_max,
    p_active_like_min: settings.active_like_min,
    p_active_like_max: settings.active_like_max,
  });
  if (result.error) throw result.error;
  return result.data as CommunityEngagementSettings;
}
