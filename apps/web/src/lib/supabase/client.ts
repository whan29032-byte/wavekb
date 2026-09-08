import { createBrowserClient } from "@supabase/ssr";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { requirePublicSupabaseConfig } from "@/lib/env";

let browserClient: SupabaseClient | undefined;

export type VerifiedAuthCallbackKind = "signup" | "recovery";

type VerifiedAuthCallback = {
  kind: VerifiedAuthCallbackKind;
  session: Session;
  capturedAt: number;
};

type VerifiedAuthCallbackListener = {
  kind: VerifiedAuthCallbackKind;
  receive: (session: Session) => void;
};

const callbackListeners = new Set<VerifiedAuthCallbackListener>();
let capturedCallback: VerifiedAuthCallback | undefined;

function automaticAuthCallbackKind(): VerifiedAuthCallbackKind | null {
  if (typeof window === "undefined") return null;
  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const hasCallbackCredentials = Boolean(search.get("code"))
    || (Boolean(hash.get("access_token")) && Boolean(hash.get("refresh_token")));
  if (!hasCallbackCredentials) return null;
  if (window.location.pathname === "/register" && search.get("auth") === "signup") return "signup";
  if (window.location.pathname === "/recover" && (
    search.get("mode") === "update"
    || search.get("auth") === "recovery"
    || search.get("type") === "recovery"
    || hash.get("type") === "recovery"
  )) return "recovery";
  return null;
}

function publishVerifiedAuthCallback(kind: VerifiedAuthCallbackKind, session: Session) {
  const matching = [...callbackListeners].filter((listener) => listener.kind === kind);
  if (matching.length) {
    for (const listener of matching) listener.receive(session);
    return;
  }
  capturedCallback = { kind, session, capturedAt: Date.now() };
}

export function onVerifiedAuthCallback(kind: VerifiedAuthCallbackKind, receive: (session: Session) => void) {
  const listener = { kind, receive };
  let active = true;
  callbackListeners.add(listener);

  const captured = capturedCallback;
  if (captured?.kind === kind && Date.now() - captured.capturedAt <= 60_000) {
    capturedCallback = undefined;
    queueMicrotask(() => {
      if (active) receive(captured.session);
    });
  }

  return () => {
    active = false;
    callbackListeners.delete(listener);
  };
}

export function createClient(): SupabaseClient {
  if (browserClient) return browserClient;
  const { url, key } = requirePublicSupabaseConfig();
  const callbackKind = automaticAuthCallbackKind();
  browserClient = createBrowserClient(url, key);
  if (callbackKind) {
    let callbackPublished = false;
    browserClient.auth.onAuthStateChange((event, session) => {
      const expectedEvent = callbackKind === "recovery" ? "PASSWORD_RECOVERY" : "SIGNED_IN";
      if (!callbackPublished && event === expectedEvent && session) {
        callbackPublished = true;
        publishVerifiedAuthCallback(callbackKind, session);
      }
    });
  }
  return browserClient;
}
