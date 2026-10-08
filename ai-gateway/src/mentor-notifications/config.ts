import { isSender } from "./contracts.ts";

export type MentorNotificationConfig = {
  enabled: boolean;
  readiness: "disabled" | "unconfigured" | "ready";
  supabaseUrl: string;
  serviceRoleKey: string;
  apiKey: string;
  from: string;
  manageUrl: string;
  pollMs: number;
};

function httpsOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error();
    return url.origin;
  } catch {
    throw new Error("mentor_notification_configuration_invalid");
  }
}

// Separate from the AI config: the mail worker has no AI/provider/trading keys.
// Missing mail configuration keeps the durable queue untouched.
export function loadMentorNotificationConfig(env: Record<string, string | undefined>): MentorNotificationConfig {
  const enabledSetting = env.MENTOR_EMAIL_ENABLED?.trim() || "false";
  if (enabledSetting !== "true" && enabledSetting !== "false") {
    throw new Error("mentor_notification_enable_flag_invalid");
  }
  const enabled = enabledSetting === "true";
  const pollSeconds = Number(env.MENTOR_EMAIL_POLL_SECONDS ?? 15);
  if (!Number.isInteger(pollSeconds) || pollSeconds < 1 || pollSeconds > 300) {
    throw new Error("mentor_notification_poll_setting_invalid");
  }
  const supabaseUrl = env.SUPABASE_URL?.trim() || "";
  const siteUrl = env.MENTOR_EMAIL_SITE_URL?.trim() || "https://wavekb.com";
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  const apiKey = env.MENTOR_EMAIL_API_KEY?.trim() || "";
  const from = env.MENTOR_EMAIL_FROM?.trim() || "";
  const configured = Boolean(supabaseUrl && siteUrl && serviceRoleKey && apiKey && from);
  const config: MentorNotificationConfig = {
    enabled,
    readiness: enabled ? "unconfigured" : "disabled",
    supabaseUrl: "",
    serviceRoleKey,
    apiKey,
    from,
    manageUrl: "",
    pollMs: pollSeconds * 1000,
  };
  if (!enabled || !configured) return config;
  if (!isSender(from) || /[\s]/.test(env.MENTOR_EMAIL_API_KEY ?? "")
    || /[\s]/.test(env.SUPABASE_SERVICE_ROLE_KEY ?? "")) {
    throw new Error("mentor_notification_configuration_invalid");
  }
  config.supabaseUrl = httpsOrigin(supabaseUrl);
  config.manageUrl = `${httpsOrigin(siteUrl)}/mentor/manage`;
  config.readiness = "ready";
  return config;
}
