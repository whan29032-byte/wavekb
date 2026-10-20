"use client";

import { useEffect } from "react";
import { publicSupabaseConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/client";

const VISITOR_KEY = "wavekb-visitor-id";

function visitorKey() {
  try {
    const existing = window.localStorage.getItem(VISITOR_KEY);
    if (existing && existing.length >= 8) return existing;
    const created = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(VISITOR_KEY, created);
    return created;
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export function PostViewTracker({ postId }: { postId: string }) {
  useEffect(() => {
    if (!publicSupabaseConfig().configured) return;
    try {
      const key = visitorKey();
      void createClient().rpc("record_post_view", { p_post_id: postId, p_viewer_key: key }).then(() => undefined, () => undefined);
    } catch {
      // View telemetry must never block reading the post.
    }
  }, [postId]);

  return null;
}
