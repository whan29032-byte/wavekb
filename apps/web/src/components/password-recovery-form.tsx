"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button, Field, FieldMessage, Input, Label } from "@wavekb/ui";
import { friendlyAuthError, validatePasswordUpdate } from "@/lib/auth/forms";
import { createClient } from "@/lib/supabase/client";

type Mode = "request" | "checking" | "update" | "complete";

function recoveryMarker() {
  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return search.get("mode") === "update"
    || search.get("auth") === "recovery"
    || search.get("type") === "recovery"
    || hash.get("type") === "recovery";
}

export function PasswordRecoveryForm() {
  const [mode, setMode] = useState<Mode>("checking");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; confirmPassword?: string }>({});

  useEffect(() => {
    const client = createClient();
    let active = true;
    const marked = recoveryMarker();
    const { data: listener } = client.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY" || (marked && session)) setMode("update");
    });
    void client.auth.getSession().then(({ data }) => {
      if (!active) return;
      setMode(marked && data.session ? "update" : marked ? "checking" : "request");
      if (marked && !data.session) {
        window.setTimeout(() => {
          if (active) {
            setMode("request");
            setError("重置链接无效或已过期，请重新发送密码重置邮件。");
          }
        }, 1200);
      }
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function requestReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setPending(true);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("请输入有效邮箱。");
      setPending(false);
      return;
    }
    const redirectTo = `${window.location.origin}/recover?mode=update`;
    const { error: resetError } = await createClient().auth.resetPasswordForEmail(email, { redirectTo });
    setPending(false);
    if (resetError) setError(friendlyAuthError(resetError));
    else setSuccess("重置邮件已发送。请打开邮件中的链接设置新密码。");
  }

  async function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");
    const validation = validatePasswordUpdate(password, confirmPassword);
    setFieldErrors(validation);
    setError("");
    if (Object.keys(validation).length) return;
    setPending(true);
    const { error: updateError } = await createClient().auth.updateUser({ password });
    setPending(false);
    if (updateError) {
      setError(friendlyAuthError(updateError));
      return;
    }
    setMode("complete");
  }

  if (mode === "checking") {
    return <p className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground" role="status">正在验证重置链接</p>;
  }

  if (mode === "complete") {
    return (
      <div className="grid gap-5">
        <p className="rounded-lg bg-muted px-4 py-3 text-sm leading-6" role="status">新密码已保存，可以继续使用当前账号。</p>
        <Button type="button" size="large" onClick={() => window.location.replace("/community/idea_sharing")}>进入社区</Button>
      </div>
    );
  }

  if (mode === "update") {
    return (
      <form className="grid gap-5" onSubmit={updatePassword} noValidate>
        <Field>
          <Label htmlFor="recoveryPassword">新密码</Label>
          <Input id="recoveryPassword" name="password" type="password" autoComplete="new-password" required minLength={10} aria-invalid={Boolean(fieldErrors.password)} aria-describedby={fieldErrors.password ? "recovery-password-error" : undefined} />
          {fieldErrors.password ? <FieldMessage id="recovery-password-error" role="alert">{fieldErrors.password}</FieldMessage> : <p className="text-xs text-muted-foreground">至少 10 个字符</p>}
        </Field>
        <Field>
          <Label htmlFor="recoveryPasswordConfirm">确认新密码</Label>
          <Input id="recoveryPasswordConfirm" name="confirmPassword" type="password" autoComplete="new-password" required minLength={10} aria-invalid={Boolean(fieldErrors.confirmPassword)} aria-describedby={fieldErrors.confirmPassword ? "recovery-confirm-error" : undefined} />
          {fieldErrors.confirmPassword ? <FieldMessage id="recovery-confirm-error" role="alert">{fieldErrors.confirmPassword}</FieldMessage> : null}
        </Field>
        {error ? <FieldMessage role="alert">{error}</FieldMessage> : null}
        <Button type="submit" size="large" disabled={pending}>{pending ? "正在保存" : "保存新密码"}</Button>
      </form>
    );
  }

  return (
    <form className="grid gap-5" onSubmit={requestReset} noValidate>
      <Field>
        <Label htmlFor="recoveryEmail">注册邮箱</Label>
        <Input id="recoveryEmail" name="email" type="email" inputMode="email" autoComplete="email" required aria-describedby={error ? "recovery-error" : undefined} />
      </Field>
      {error ? <FieldMessage id="recovery-error" role="alert">{error}</FieldMessage> : null}
      {success ? <p className="rounded-lg bg-muted px-4 py-3 text-sm leading-6" role="status">{success}</p> : null}
      <Button type="submit" size="large" disabled={pending}>{pending ? "正在发送" : "发送重置链接"}</Button>
    </form>
  );
}
