export type RegistrationInput = {
  displayName: string;
  email: string;
  verificationCode?: string;
  password?: string;
  confirmPassword?: string;
};

export type AuthFieldErrors = Partial<Record<keyof RegistrationInput, string>>;

export function safeReturnPath(value: string | null | undefined, fallback = "/community/idea_sharing") {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  try {
    const base = new URL("https://wavekb.invalid");
    const destination = new URL(value, base);
    return destination.origin === base.origin && destination.pathname.startsWith("/")
      ? `${destination.pathname}${destination.search}${destination.hash}`
      : fallback;
  } catch {
    return fallback;
  }
}

export function validateRegistrationIdentity(input: RegistrationInput): AuthFieldErrors {
  const errors: AuthFieldErrors = {};
  if (input.displayName.trim().length < 2 || input.displayName.trim().length > 32) {
    errors.displayName = "昵称需要 2 到 32 个字符。";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
    errors.email = "请输入有效邮箱。";
  }
  return errors;
}

export function validateRegistrationCompletion(input: RegistrationInput): AuthFieldErrors {
  const errors = validateRegistrationIdentity(input);
  if (!/^\d{6}$/.test(input.verificationCode?.trim() ?? "")) {
    errors.verificationCode = "请输入 6 位验证码。";
  }
  if ((input.password ?? "").length < 10) {
    errors.password = "密码至少需要 10 个字符。";
  }
  if (input.password !== input.confirmPassword) {
    errors.confirmPassword = "两次输入的密码不一致。";
  }
  return errors;
}

export function validatePasswordUpdate(password: string, confirmPassword: string) {
  const errors: Pick<AuthFieldErrors, "password" | "confirmPassword"> = {};
  if (password.length < 10) errors.password = "密码至少需要 10 个字符。";
  if (password !== confirmPassword) errors.confirmPassword = "两次输入的密码不一致。";
  return errors;
}

export function friendlyAuthError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/invalid_credentials|invalid login credentials/i.test(message)) return "邮箱、UID 或密码不正确。";
  if (/email_confirmation_required|email not confirmed/i.test(message)) return "请先完成邮箱验证。";
  if (/authentication_required|session.*missing/i.test(message)) return "登录状态已失效，请重新登录。";
  if (/uid_refresh_exhausted/i.test(message)) return "可刷新次数已经用完，请从现有 UID 中选择。";
  if (/uid_selection_expired/i.test(message)) return "本轮 UID 选择已过期，请重新开始。";
  if (/uid_selection_invalid/i.test(message)) return "UID 选择状态无效，请重新开始。";
  if (/uid_unavailable/i.test(message)) return "这个 UID 刚被占用，请换一个候选号码。";
  if (/uid_already_assigned/i.test(message)) return "账号已经拥有 UID。";
  if (/user already registered/i.test(message)) return "该邮箱已注册，请直接登录或重置密码。";
  if (/rate limit|too many|rate_limited/i.test(message)) return "操作过于频繁，请稍后再试。";
  if (/unexpected_failure|error sending recovery email|could not send email/i.test(message)) {
    return "邮件暂时无法发送，请稍后重试；如持续失败请联系网站管理员。";
  }
  if (/network|fetch|timeout/i.test(message)) return "网络连接失败，请检查网络后重试。";
  if (/service_unavailable/i.test(message)) return "账号服务暂时不可用，请稍后重试。";
  return message || "操作失败，请重试。";
}
