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
  navigate: vi.fn(),
}));

vi.mock("@/lib/auth/return-path", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/auth/return-path")>(), replaceAuthLocation: mocks.navigate,
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

it("preserves the member destination in the first email, resend and password-completed UID activation", async () => {
  const destination="/membership/plans?plan=vip&period=year#join";
  render(<RegistrationForm returnPath={destination} />);
  fireEvent.change(screen.getByLabelText("昵称"),{target:{value:"测试用户"}});
  fireEvent.change(screen.getByLabelText("邮箱"),{target:{value:"member@example.com"}});
  fireEvent.click(screen.getByRole("button",{name:"发送邮箱验证码"}));
  await screen.findByLabelText("6 位验证码");
  fireEvent.click(screen.getByRole("button",{name:"重新发送"}));
  await waitFor(()=>expect(mocks.signInWithOtp).toHaveBeenCalledTimes(2));
  for (const call of mocks.signInWithOtp.mock.calls) {
    const callback=new URL(call[0].options.emailRedirectTo);
    expect(callback.origin).toBe(window.location.origin);expect(callback.searchParams.get("auth")).toBe("signup");expect(callback.searchParams.get("next")).toBe(destination);
  }
  expect(new URL(screen.getByRole("link",{name:"返回登录"}).getAttribute("href")!,window.location.origin).searchParams.get("next")).toBe(destination);
  fireEvent.change(screen.getByLabelText("6 位验证码"),{target:{value:"123456"}});
  fireEvent.change(screen.getByLabelText("设置密码"),{target:{value:"long-enough-password"}});
  fireEvent.change(screen.getByLabelText("确认密码"),{target:{value:"long-enough-password"}});
  await waitFor(()=>expect((screen.getByRole("button",{name:"验证并创建账号"}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button",{name:"验证并创建账号"}));
  await waitFor(()=>expect(mocks.navigate).toHaveBeenCalledWith(`/activate-uid?next=${encodeURIComponent(destination)}`));
});

it("retains a safe next while removing token-hash credentials and finishing linked password setup", async () => {
  const destination="/membership/plans?plan=vip&period=month";
  window.history.replaceState({},"",`/register?auth=signup&type=email&token_hash=signup-hash&next=${encodeURIComponent(destination)}`);
  mocks.verifyOtp.mockResolvedValue({data:{session:{user:{email:"member@example.com",user_metadata:{display_name:"测试用户"}}}},error:null});
  render(<RegistrationForm returnPath={destination} />);
  await screen.findByLabelText("设置密码");
  const callback=new URL(window.location.href);
  expect(callback.searchParams.get("next")).toBe(destination);expect(callback.searchParams.has("token_hash")).toBe(false);expect(callback.searchParams.has("type")).toBe(false);
  fireEvent.change(screen.getByLabelText("设置密码"),{target:{value:"long-enough-password"}});
  fireEvent.change(screen.getByLabelText("确认密码"),{target:{value:"long-enough-password"}});
  fireEvent.click(screen.getByRole("button",{name:"设置密码并创建账号"}));
  await waitFor(()=>expect(mocks.navigate).toHaveBeenCalledWith(`/activate-uid?next=${encodeURIComponent(destination)}`));
});

it("sanitizes a hostile signup return before emailing or navigating", async () => {
  render(<RegistrationForm returnPath="//attacker.example" />);
  fireEvent.change(screen.getByLabelText("昵称"),{target:{value:"测试用户"}});
  fireEvent.change(screen.getByLabelText("邮箱"),{target:{value:"member@example.com"}});
  fireEvent.click(screen.getByRole("button",{name:"发送邮箱验证码"}));
  await screen.findByLabelText("6 位验证码");
  expect(new URL(mocks.signInWithOtp.mock.calls[0][0].options.emailRedirectTo).searchParams.get("next")).toBe("/community/idea_sharing");
});
