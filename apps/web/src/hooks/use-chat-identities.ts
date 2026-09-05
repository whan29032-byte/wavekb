"use client";

import { useEffect, useState } from "react";
import type { PublicProfile } from "@wavekb/domain";
import { createClient } from "@/lib/supabase/client";
import { subscribeIdentityChanges } from "@/lib/member/identity-events";
import { loadPublicIdentities } from "@/lib/member/public-identities";

type ChatIdentity = Pick<PublicProfile, "id" | "public_uid" | "display_name" | "avatar_url" | "display_title" | "nameplate_style">;

// Only fetch open conversations; a failed optional identity refresh must not
// remove the friends panel or reset drafts and window controls.
export function useChatIdentities(memberIds: string[]) {
  const idsKey = JSON.stringify([...new Set(memberIds)].sort());
  const [profiles, setProfiles] = useState<Record<string, ChatIdentity>>({});
  useEffect(() => {
    const ids = JSON.parse(idsKey) as string[];
    if (!ids.length) return;
    let active = true;
    let revision = 0;
    async function refresh() {
      const request = ++revision;
      try {
        const profiles = await loadPublicIdentities(createClient(), ids);
        if (!active || request !== revision) return;
        const next: Record<string, ChatIdentity> = {};
        for (const row of profiles) {
          if (ids.includes(row.id)) next[row.id] = { id: row.id, public_uid: row.public_uid, display_name: row.display_name, avatar_url: row.avatar_url, display_title: row.display_title, nameplate_style: row.nameplate_style };
        }
        setProfiles(next);
      } catch { /* Existing identity stays visible during a transient failure. */ }
    }
    void refresh();
    const unsubscribe = subscribeIdentityChanges((id) => { if (ids.includes(id)) void refresh(); });
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = window.setInterval(onVisible, 15000);
    document.addEventListener("visibilitychange", onVisible);
    return () => { active = false; unsubscribe(); window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [idsKey]);
  return profiles;
}
