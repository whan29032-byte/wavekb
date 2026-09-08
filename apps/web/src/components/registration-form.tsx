"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Button, Field, FieldMessage, Input, Label } from "@wavekb/ui";
import { createClient, onVerifiedAuthCallback } from "@/lib/supabase/client";
import {
  friendlyAuthError,
  type AuthFieldErrors,
  validatePasswordUpdate,
  validateRegistrationCompletion,
  validateRegistrationIdentity,
} from "@/lib/auth/forms";

type RegistrationStep = "identity" | "verify" | "password";

type RegistrationSession = {
  user?: {
    email?: string | null;
    user_metadata?: Record<string, unknown> | null;
  } | null;
} | null;

function registrationRedirectUrl() {
  return `${window.location.origin}/register?auth=signup`;
}

export function RegistrationForm() {
  const [step, setStep] = useState<RegistrationStep>("identity");
  const [pending, setPending] = useState(false);
  const [fields, setFields] = useState({ displayName: "", email: "" });
  const [errors, setErrors] = useState<AuthFieldErrors>({});
  const [message, setMessage] = useState("");

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const tokenHash = search.get("token_hash");
    const hasSignupMarker = search.get("auth") === "signup"
      || (search.get("type") === "email" && Boolean(tokenHash));
    if (!hasSignupMarker) return;

    const client = createClient();
    let active = true;
    let callbackAccepted = false;
    let failureTimer: number | undefined;

    function continueWithSession(session: RegistrationSession) {
      const user = session?.user;
      if (!active || !user) return false;
      callbackAccepted = true;
      const displayName = typeof user.user_metadata?.display_name === "string"
        ? user.user_metadata.display_name
        : "";
      setFields({ displayName, email: user.email ?? "" });
      setErrors({});
      setMessage("邮箱验证成功，请设置登录密码。");
      setStep("password");
      return true;
    }

    const stopWatchingCallback = onVerifiedAuthCallback("signup", (session) => {
      if (continueWithSession(session)) {
        if (failureTimer !== undefined) window.clearTimeout(failureTimer);
      }
    });

    void (async () => {
      if (tokenHash && search.get("type") === "email") {
        const verified = await client.auth.verifyOtp({ token_hash: tokenHash, type: "email" });
        if (!active) return;
        window.history.replaceState(window.history.state, "", "/register?auth=signup");
        if (verified.error) {
          setStep("identity");
          setMessage(friendlyAuthError(verified.error));
          return;
        }
        if (continueWithSession(verified.data.session)) return;
      }

      if (!active || callbackAccepted) return;

      failureTimer = window.setTimeout(() => {
        if (!active || callbackAccepted) return;
        setStep("identity");
        setMessage("注册链接无效或已过期，请重新发送验证邮件。");
      }, 1500);
    })();

    return () => {
      active = false;
      if (failureTimer !== undefined) window.clearTimeout(failureTimer);
      stopWatchingCallback();
    };
  }, []);

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = {
      displayName: String(form.get("displayName") ?? "").trim(),
      email: String(form.get("email") ?? "").trim(),
    };
    const validation = validateRegistrationIdentity(next);
    setErrors(validation);
    setMessage("");
    if (Object.keys(validation).length) return;
    setPending(true);
    const { error } = await createClient().auth.signInWithOtp({
      email: next.email,
      options: {
        shouldCreateUser: true,
        data: { display_name: next.displayName },
        emailRedirectTo: registrationRedirectUrl(),
      },
    });
    setPending(false);
    if (error) {
      setMessage(friendlyAuthError(error));
      return;
    }
    setFields(next);
    setStep("verify");
    setMessage(`验证邮件已发送到 ${next.email}，请输入 6 位验证码，或点击邮件中的验证链接继续。`);
  }

  async function complete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = {
      ...fields,
      verificationCode: String(form.get("verificationCode") ?? "").trim(),
      password: String(form.get("password") ?? ""),
      confirmPassword: String(form.get("confirmPassword") ?? ""),
    };
    const validation = validateRegistrationCompletion(input);
    setErrors(validation);
    setMessage("");
    if (Object.keys(validation).length) return;
    setPending(true);
    const client = createClient();
    const verified = await client.auth.verifyOtp({ email: input.email, token: input.verificationCode, type: "email" });
    if (verified.error) {
      setPending(false);
      setMessage(friendlyAuthError(verified.error));
      return;
    }
    const updated = await client.auth.updateUser({
      password: input.password,
      data: { display_name: input.displayName },
    });
    if (updated.error) {
      setPending(false);
      setMessage(friendlyAuthError(updated.error));
      return;
    }
    window.location.replace("/activate-uid");
  }

  async function saveLinkedPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");
    const validation = validatePasswordUpdate(password, confirmPassword);
    setErrors(validation);
    setMessage("");
    if (Object.keys(validation).length) return;

    setPending(true);
    const data = fields.displayName ? { display_name: fields.displayName } : undefined;
    const updated = await createClient().auth.updateUser({ password, data });
    if (updated.error) {
      setPending(false);
      setMessage(friendlyAuthError(updated.error));
      return;
    }
    window.location.replace("/activate-uid");
  }

  if (step === "identity") {
    return (
      <form className="grid gap-5" onSubmit={requestCode} noValidate>
        <Field>
          <Label htmlFor="displayName">昵称</Label>
          <Input id="displayName" name="displayName" autoComplete="nickname" required minLength={2} maxLength={32} aria-invalid={Boolean(errors.displayName)} aria-describedby={errors.displayName ? "display-name-error" : undefined} />
          {errors.displayName ? <FieldMessage id="display-name-error" role="alert">{errors.displayName}</FieldMessage> : null}
        </Field>
        <Field>
          <Label htmlFor="registrationEmail">邮箱</Label>
          <Input id="registrationEmail" name="email" type="email" autoComplete="email" inputMode="email" required aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? "registration-email-error" : undefined} />
          {errors.email ? <FieldMessage id="registration-email-error" role="alert">{errors.email}</FieldMessage> : null}
        </Field>
        {message ? <FieldMessage role="alert">{message}</FieldMessage> : null}
        <Button type="submit" size="large" disabled={pending}>{pending ? "正在发送" : "发送邮箱验证码"}</Button>
      </form>
    );
  }

  if (step === "password") {
    return (
      <form className="grid gap-5" onSubmit={saveLinkedPassword} noValidate>
        <div className="rounded-lg bg-muted px-4 py-3 text-sm leading-6 text-muted-foreground" role="status">{message}</div>
        <Field>
          <Label htmlFor="linkedRegistrationPassword">设置密码</Label>
          <Input id="linkedRegistrationPassword" name="password" type="password" autoComplete="new-password" required minLength={10} aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? "linked-registration-password-error" : undefined} />
          {errors.password ? <FieldMessage id="linked-registration-password-error" role="alert">{errors.password}</FieldMessage> : <p className="text-xs text-muted-foreground">至少 10 个字符</p>}
        </Field>
        <Field>
          <Label htmlFor="linkedRegistrationPasswordConfirm">确认密码</Label>
          <Input id="linkedRegistrationPasswordConfirm" name="confirmPassword" type="password" autoComplete="new-password" required minLength={10} aria-invalid={Boolean(errors.confirmPassword)} aria-describedby={errors.confirmPassword ? "linked-registration-confirm-error" : undefined} />
          {errors.confirmPassword ? <FieldMessage id="linked-registration-confirm-error" role="alert">{errors.confirmPassword}</FieldMessage> : null}
        </Field>
        {message && !message.startsWith("邮箱验证成功") ? <FieldMessage role="alert">{message}</FieldMessage> : null}
        <Button type="submit" size="large" disabled={pending}>{pending ? "正在创建账号" : "设置密码并创建账号"}</Button>
      </form>
    );
  }

  return (
    <form className="grid gap-5" onSubmit={complete} noValidate>
      <div className="rounded-lg bg-muted px-4 py-3 text-sm leading-6 text-muted-foreground" role="status">{message}</div>
      <Field>
        <Label htmlFor="verificationCode">6 位验证码</Label>
        <Input id="verificationCode" name="verificationCode" inputMode="numeric" autoComplete="one-time-code" required minLength={6} maxLength={6} aria-invalid={Boolean(errors.verificationCode)} aria-describedby={errors.verificationCode ? "code-error" : undefined} />
        {errors.verificationCode ? <FieldMessage id="code-error" role="alert">{errors.verificationCode}</FieldMessage> : null}
      </Field>
      <Field>
        <Label htmlFor="newRegistrationPassword">设置密码</Label>
        <Input id="newRegistrationPassword" name="password" type="password" autoComplete="new-password" required minLength={10} aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? "registration-password-error" : undefined} />
        {errors.password ? <FieldMessage id="registration-password-error" role="alert">{errors.password}</FieldMessage> : <p className="text-xs text-muted-foreground">至少 10 个字符</p>}
      </Field>
      <Field>
        <Label htmlFor="confirmRegistrationPassword">确认密码</Label>
        <Input id="confirmRegistrationPassword" name="confirmPassword" type="password" autoComplete="new-password" required minLength={10} aria-invalid={Boolean(errors.confirmPassword)} aria-describedby={errors.confirmPassword ? "registration-confirm-error" : undefined} />
        {errors.confirmPassword ? <FieldMessage id="registration-confirm-error" role="alert">{errors.confirmPassword}</FieldMessage> : null}
      </Field>
      {message && !message.startsWith("验证邮件已发送") ? <FieldMessage role="alert">{message}</FieldMessage> : null}
      <Button type="submit" size="large" disabled={pending}>{pending ? "正在创建账号" : "验证并创建账号"}</Button>
      <div className="grid grid-cols-2 gap-3">
        <Button type="button" variant="secondary" onClick={() => { setStep("identity"); setMessage(""); }}>修改邮箱</Button>
        <Button type="button" variant="secondary" disabled={pending} onClick={async () => {
          setPending(true);
          const { error } = await createClient().auth.signInWithOtp({
            email: fields.email,
            options: {
              shouldCreateUser: true,
              data: { display_name: fields.displayName },
              emailRedirectTo: registrationRedirectUrl(),
            },
          });
          setPending(false);
          setMessage(error ? friendlyAuthError(error) : `验证邮件已重新发送到 ${fields.email}`);
        }}>重新发送</Button>
      </div>
      <Link className="text-center text-sm font-semibold text-primary hover:underline" href="/login">返回登录</Link>
    </form>
  );
}
