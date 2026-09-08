import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RegistrationForm } from "./registration-form";

type VerifiedCallback = (session: unknown) => void;

const mocks = vi.hoisted(() => ({
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
  updateUser: vi.fn(),
  getSession: vi.fn(),
  watchVerifiedCallback: vi.fn(),
  unsubscribe: vi.fn(),
  verifiedCallback: null as VerifiedCallback | null,
  capturedSession: null as unknown,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signInWithOtp: mocks.signInWithOtp,
      verifyOtp: mocks.verifyOtp,
      updateUser: mocks.updateUser,
      getSession: mocks.getSession,
    },
  }),
  onVerifiedAuthCallback: mocks.watchVerifiedCallback,
}));

beforeEach(() => {
  window.history.replaceState({}, "", "/register");
  mocks.signInWithOtp.mockResolvedValue({ data: {}, error: null });
  mocks.verifyOtp.mockResolvedValue({ data: { session: null }, error: null });
  mocks.updateUser.mockResolvedValue({ data: {}, error: null });
  mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
  mocks.watchVerifiedCallback.mockImplementation((_kind: string, callback: VerifiedCallback) => {
    mocks.verifiedCallback = callback;
    const captured = mocks.capturedSession;
    if (captured) queueMicrotask(() => callback(captured));
    return mocks.unsubscribe;
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.verifiedCallback = null;
  mocks.capturedSession = null;
});

it("returns magic-link registration emails to the password setup page", async () => {
  render(<RegistrationForm />);
  fireEvent.change(screen.getByLabelText("昵称"), { target: { value: "测试用户" } });
  fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "member@example.com" } });
  fireEvent.submit(screen.getByRole("button", { name: "发送邮箱验证码" }).closest("form")!);

  await waitFor(() => expect(mocks.signInWithOtp).toHaveBeenCalledWith({
    email: "member@example.com",
    options: {
      shouldCreateUser: true,
      data: { display_name: "测试用户" },
      emailRedirectTo: `${window.location.origin}/register?auth=signup`,
    },
  }));
});

it("continues password setup when a registration link establishes a session", async () => {
  window.history.replaceState({}, "", "/register?auth=signup&code=signup-code");
  const session = {
    user: {
      email: "member@example.com",
      user_metadata: { display_name: "测试用户" },
    },
  };

  render(<RegistrationForm />);
  await waitFor(() => expect(mocks.watchVerifiedCallback).toHaveBeenCalledWith("signup", expect.any(Function)));
  act(() => mocks.verifiedCallback?.(session));

  expect(await screen.findByLabelText("设置密码")).toBeTruthy();
  expect(screen.queryByLabelText("6 位验证码")).toBeNull();
});

it("does not treat an existing session as proof that a registration link succeeded", async () => {
  window.history.replaceState({}, "", "/register?auth=signup&code=expired-code");

  render(<RegistrationForm />);
  await waitFor(() => expect(mocks.watchVerifiedCallback).toHaveBeenCalled());

  expect(screen.queryByLabelText("设置密码")).toBeNull();
});

it("uses a verified callback captured before the form subscribes", async () => {
  window.history.replaceState({}, "", "/register?auth=signup");
  mocks.capturedSession = {
    user: {
      email: "member@example.com",
      user_metadata: { display_name: "测试用户" },
    },
  };

  render(<RegistrationForm />);

  expect(await screen.findByLabelText("设置密码")).toBeTruthy();
});

it("accepts a token-hash registration link without relying on PKCE browser state", async () => {
  window.history.replaceState({}, "", "/register?auth=signup&type=email&token_hash=signup-hash");
  mocks.verifyOtp.mockResolvedValue({
    data: {
      session: {
        user: {
          email: "member@example.com",
          user_metadata: { display_name: "测试用户" },
        },
      },
    },
    error: null,
  });

  render(<RegistrationForm />);

  await waitFor(() => expect(mocks.verifyOtp).toHaveBeenCalledWith({
    token_hash: "signup-hash",
    type: "email",
  }));
  expect(await screen.findByLabelText("设置密码")).toBeTruthy();
  expect(screen.queryByLabelText("6 位验证码")).toBeNull();
});
