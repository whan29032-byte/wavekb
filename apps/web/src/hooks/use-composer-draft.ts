"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export type ComposerDraftStatus = "checking" | "ready" | "restored" | "saved" | "unavailable" | "stale";

/** Text/configuration only: selected File objects deliberately never enter local storage. */
export function useComposerDraft<T extends { baseUpdatedAt: string | null }>(
  key: string,
  value: T,
  restore: (stored: unknown) => boolean,
) {
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<ComposerDraftStatus>("checking");
  const [conflicting, setConflicting] = useState<unknown>(null);
  const restoreRef = useRef(restore);
  const valueRef = useRef(value);
  const loadedRef = useRef(false);
  const completedRef = useRef(false);
  const blockedRef = useRef(false);
  const [initialSerialized] = useState(() => JSON.stringify(value));
  const lastSavedRef = useRef(initialSerialized);
  // Keep event-time snapshots current without writing storage on every keystroke.
  useLayoutEffect(() => { restoreRef.current = restore; valueRef.current = value; });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored: unknown = JSON.parse(localStorage.getItem(key) || "null");
        if (stored && typeof stored === "object" && !Array.isArray(stored)) {
          const base = (stored as { baseUpdatedAt?: unknown }).baseUpdatedAt;
          if (valueRef.current.baseUpdatedAt !== null && base !== valueRef.current.baseUpdatedAt) {
            blockedRef.current = true;
            setConflicting(stored);
            setStatus("stale");
          } else setStatus(restoreRef.current(stored) ? "restored" : "ready");
        } else setStatus("ready");
      } catch { setStatus("unavailable"); }
      loadedRef.current = true;
      setLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [key]);

  const flush = useCallback(() => {
    if (!loadedRef.current || completedRef.current || blockedRef.current) return;
    const serialized = JSON.stringify(valueRef.current);
    if (serialized === lastSavedRef.current) return;
    try {
      localStorage.setItem(key, JSON.stringify({ ...valueRef.current, version: 2, savedAt: new Date().toISOString() }));
      lastSavedRef.current = serialized;
      setStatus("saved");
    } catch { setStatus("unavailable"); }
  }, [key]);

  useEffect(() => {
    if (!loaded) return;
    const timer = window.setTimeout(flush, 350);
    return () => window.clearTimeout(timer);
  }, [flush, loaded, value]);

  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      flush();
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [flush]);

  function resolveConflict(useLocal: boolean) {
    if (useLocal && !restoreRef.current(conflicting)) return;
    blockedRef.current = false;
    setConflicting(null);
    // Only clear after the user explicitly chooses the server version.
    if (!useLocal) {
      try { localStorage.removeItem(key); setStatus("ready"); }
      catch { setStatus("unavailable"); }
    } else setStatus("restored");
  }

  function complete() {
    completedRef.current = true;
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(key) || "null");
      if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        const record = stored as Record<string, unknown>;
        // Another tab may have saved a different draft while our request was
        // in flight. Never clear its unsent work with this tab's success.
        if (Object.entries(valueRef.current).some(([field, current]) => JSON.stringify(record[field]) !== JSON.stringify(current))) return;
      }
      localStorage.removeItem(key);
    }
    catch { /* A published post must not be reported as failed due to local cleanup. */ }
  }

  return { loaded, status, conflict: status === "stale", flush, complete, resolveConflict };
}
