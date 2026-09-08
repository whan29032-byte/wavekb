import { afterEach, beforeEach, expect, it, vi } from "vitest";

type AuthCallback = (event: string, session: unknown) => void;

const mocks = vi.hoisted(() => ({
  authCallback: null as AuthCallback | null,
  createBrowserClient: vi.fn(),
  onAuthStateChange: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: mocks.createBrowserClient,
}));

vi.mock("@/lib/env", () => ({
  requirePublicSupabaseConfig: () => ({ url: "https://project.supabase.co", key: "public-key" }),
}));

beforeEach(() => {
  vi.resetModules();
  window.history.replaceState({}, "", "/");
  mocks.authCallback = null;
  mocks.onAuthStateChange.mockImplementation((callback: AuthCallback) => {
    mocks.authCallback = callback;
    return { data: { subscription: { unsubscribe() {} } } };
  });
  mocks.createBrowserClient.mockReturnValue({ auth: { onAuthStateChange: mocks.onAuthStateChange } });
});

afterEach(() => {
  vi.clearAllMocks();
});

it("retains a verified signup callback that finishes before the form subscribes", async () => {
  window.history.replaceState({}, "", "/register?auth=signup&code=signup-code");
  const auth = await import("./client");
  const session = { user: { id: "new-member" } };

  auth.createClient();
  mocks.authCallback?.("SIGNED_IN", session);
  const receive = vi.fn();
  const stop = auth.onVerifiedAuthCallback("signup", receive);
  await Promise.resolve();

  expect(receive).toHaveBeenCalledWith(session);
  stop();
});

it("does not retain an unrelated initial session for a signup callback", async () => {
  window.history.replaceState({}, "", "/register?auth=signup&code=expired-code");
  const auth = await import("./client");

  auth.createClient();
  mocks.authCallback?.("INITIAL_SESSION", { user: { id: "already-signed-in" } });
  const receive = vi.fn();
  const stop = auth.onVerifiedAuthCallback("signup", receive);
  await Promise.resolve();

  expect(receive).not.toHaveBeenCalled();
  stop();
});

it("retains only the recovery-specific event on a recovery callback URL", async () => {
  window.history.replaceState({}, "", "/recover?mode=update&code=recovery-code");
  const auth = await import("./client");
  const session = { user: { id: "recovery-member" } };

  auth.createClient();
  mocks.authCallback?.("SIGNED_IN", session);
  const receive = vi.fn();
  const stop = auth.onVerifiedAuthCallback("recovery", receive);
  await Promise.resolve();
  expect(receive).not.toHaveBeenCalled();

  mocks.authCallback?.("PASSWORD_RECOVERY", session);
  expect(receive).toHaveBeenCalledWith(session);
  stop();
});
