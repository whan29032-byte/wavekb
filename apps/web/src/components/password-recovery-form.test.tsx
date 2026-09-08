import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { PasswordRecoveryForm } from "./password-recovery-form";

type VerifiedCallback = (session: unknown) => void;

const mocks = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  unsubscribe: vi.fn(),
  watchVerifiedCallback: vi.fn(),
  verifiedCallback: null as VerifiedCallback | null,
  capturedSession: null as unknown,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      verifyOtp: mocks.verifyOtp,
      getSession: mocks.getSession,
      onAuthStateChange: mocks.onAuthStateChange,
      resetPasswordForEmail: mocks.resetPasswordForEmail,
      updateUser: mocks.updateUser,
    },
  }),
  onVerifiedAuthCallback: mocks.watchVerifiedCallback,
}));

beforeEach(() => {
  window.history.replaceState({}, "", "/recover");
  mocks.verifyOtp.mockResolvedValue({ data: { session: null }, error: null });
  mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
  mocks.watchVerifiedCallback.mockImplementation((_kind: string, callback: VerifiedCallback) => {
    mocks.verifiedCallback = callback;
    const captured = mocks.capturedSession;
    if (captured) queueMicrotask(() => callback(captured));
    return mocks.unsubscribe;
  });
  mocks.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
  mocks.updateUser.mockResolvedValue({ data: {}, error: null });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.verifiedCallback = null;
  mocks.capturedSession = null;
});

it("verifies a recovery token hash and opens the new-password form", async () => {
  window.history.replaceState({}, "", "/recover?type=recovery&token_hash=recovery-hash");
  mocks.verifyOtp.mockResolvedValue({
    data: { session: { user: { id: "member" } } },
    error: null,
  });

  render(<PasswordRecoveryForm />);

  await waitFor(() => expect(mocks.verifyOtp).toHaveBeenCalledWith({
    token_hash: "recovery-hash",
    type: "recovery",
  }));
  expect(await screen.findByLabelText("新密码")).toBeTruthy();
  expect(screen.getByLabelText("确认新密码")).toBeTruthy();
});

it("opens password update only after the current PKCE recovery event", async () => {
  window.history.replaceState({}, "", "/recover?mode=update&code=recovery-code");
  const recoverySession = { user: { id: "recovery-member" } };

  render(<PasswordRecoveryForm />);
  await waitFor(() => expect(mocks.watchVerifiedCallback).toHaveBeenCalledWith("recovery", expect.any(Function)));
  act(() => mocks.verifiedCallback?.(recoverySession));

  expect(await screen.findByLabelText("新密码")).toBeTruthy();
});

it("does not use an unrelated existing session for an invalid recovery link", async () => {
  window.history.replaceState({}, "", "/recover?mode=update&code=expired-code");

  render(<PasswordRecoveryForm />);
  await waitFor(() => expect(mocks.watchVerifiedCallback).toHaveBeenCalled());

  expect(screen.queryByLabelText("新密码")).toBeNull();
});

it("uses a verified recovery callback captured before the form subscribes", async () => {
  window.history.replaceState({}, "", "/recover?mode=update");
  mocks.capturedSession = { user: { id: "recovery-member" } };

  render(<PasswordRecoveryForm />);

  expect(await screen.findByLabelText("新密码")).toBeTruthy();
});
