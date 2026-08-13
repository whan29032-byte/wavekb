"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button, Field, FieldMessage, Input, Label } from "@wavekb/ui";
import { createClient } from "@/lib/supabase/client";
import {
  friendlyAuthError,
  type AuthFieldErrors,
  validateRegistrationCompletion,
  validateRegistrationIdentity,
} from "@/lib/auth/forms";

export function RegistrationForm() {
  const [step, setStep] = useState<"identity" | "verify">("identity");
  const [pending, setPending] = useState(false);
  const [fields, setFields] = useState({ displayName: "", email: "" });
  const [errors, setErrors] = useState<AuthFieldErrors>({});
  const [message, setMessage] = useState("");

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
      options: { shouldCreateUser: true, data: { display_name: next.displayName } },
    });
    setPending(false);
    if (error) {
      setMessage(friendlyAuthError(error));
      return;
    }
    setFields(next);
    setStep("verify");
    setMessage(`验证码已发送到 ${next.email}`);
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
      {message && !message.startsWith("验证码已发送") ? <FieldMessage role="alert">{message}</FieldMessage> : null}
      <Button type="submit" size="large" disabled={pending}>{pending ? "正在创建账号" : "验证并创建账号"}</Button>
      <div className="grid grid-cols-2 gap-3">
        <Button type="button" variant="secondary" onClick={() => { setStep("identity"); setMessage(""); }}>修改邮箱</Button>
        <Button type="button" variant="secondary" disabled={pending} onClick={async () => {
          setPending(true);
          const { error } = await createClient().auth.signInWithOtp({ email: fields.email, options: { shouldCreateUser: true, data: { display_name: fields.displayName } } });
          setPending(false);
          setMessage(error ? friendlyAuthError(error) : `验证码已重新发送到 ${fields.email}`);
        }}>重新发送</Button>
      </div>
      <Link className="text-center text-sm font-semibold text-primary hover:underline" href="/login">返回登录</Link>
    </form>
  );
}
