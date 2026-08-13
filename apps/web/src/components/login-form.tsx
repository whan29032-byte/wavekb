"use client";

import { useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Field, FieldMessage, Input, Label } from "@wavekb/ui";

export function LoginForm() {
  const searchParams = useSearchParams();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: form.get("identifier"), password: form.get("password") }),
    }).catch(() => null);
    const payload = response ? await response.json().catch(() => ({})) as { error?: string } : {};
    if (!response?.ok) {
      setError(payload.error || "登录服务暂时不可用，请稍后再试。");
      setPending(false);
      return;
    }
    const next = searchParams.get("next");
    const destination = next?.startsWith("/") && !next.startsWith("//") ? next : "/community/idea_sharing";
    window.location.replace(destination);
  }

  return (
    <form className="grid gap-5" onSubmit={submit}>
      <Field>
        <Label htmlFor="identifier">邮箱或 UID</Label>
        <Input id="identifier" name="identifier" autoComplete="username" required inputMode="email" aria-describedby={error ? "login-error" : undefined} />
      </Field>
      <Field>
        <Label htmlFor="password">密码</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required minLength={10} aria-describedby={error ? "login-error" : undefined} />
      </Field>
      {error ? <FieldMessage id="login-error" role="alert">{error}</FieldMessage> : null}
      <Button type="submit" size="large" disabled={pending}>{pending ? "正在登录" : "登录"}</Button>
    </form>
  );
}
