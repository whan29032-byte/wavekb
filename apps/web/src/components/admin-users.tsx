"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle, ClockCountdown, IdentificationCard, Prohibit, UserGear } from "@phosphor-icons/react";
import { Button, Field, FieldMessage, Input, Label } from "@wavekb/ui";
import type { AdminSummary, AdminUser } from "@/lib/admin/server-repository";

function isMuted(user: AdminUser) {
  return Boolean(user.muted_until && new Date(user.muted_until).getTime() > Date.now());
}

function friendlyError(error: unknown) {
  const code = error instanceof Error ? error.message : String(error || "");
  return ({
    admin_required: "当前账号没有管理员权限。",
    cannot_ban_self: "不能封禁自己的管理员账号。",
    cannot_mute_self: "不能禁言自己的管理员账号。",
    cannot_change_own_role: "不能修改自己的管理员权限。",
    uid_unavailable: "这个 UID 已被其他账号占用或预留。",
    user_is_banned: "已封禁账号不能再设置禁言。",
    invalid_uid: "UID 必须是 5 至 6 位数字。",
  } as Record<string, string>)[code] || code || "管理操作没有完成。";
}

type Props = {
  summary: AdminSummary;
  users: AdminUser[];
  total: number;
  page: number;
  limit: number;
  queryString: string;
};

export function AdminUsers({ summary, users, total, page, limit, queryString }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState("");
  const [reason, setReason] = useState<Record<string, string>>({});
  const [uid, setUid] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const totalPages = Math.max(1, Math.ceil(total / limit));

  async function mutate(
    user: AdminUser,
    action: "status" | "mute" | "role" | "uid",
    body: Record<string, unknown>,
    confirmation: string,
  ) {
    const note = String(reason[user.id] || "").trim();
    if (note.length < 2) {
      setError("请先填写至少 2 个字符的操作原因，便于审计复查。");
      return;
    }
    if (!window.confirm(confirmation)) return;
    setPending(`${user.id}:${action}`);
    setError("");
    setStatus("");
    try {
      const response = await fetch(`/api/admin/users/${user.id}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, reason: note }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload.error || "administration_failed"));
      setStatus(`已更新 ${user.display_name || "用户"}，操作已写入审计日志。`);
      setReason((current) => ({ ...current, [user.id]: "" }));
      router.refresh();
    } catch (mutationError) {
      setError(friendlyError(mutationError));
    } finally {
      setPending("");
    }
  }

  function pageHref(nextPage: number) {
    const params = new URLSearchParams(queryString);
    params.set("page", String(nextPage));
    return `/admin/users?${params}`;
  }

  const metrics = [
    ["全部用户", summary.total_users],
    ["今日新增", summary.new_today],
    ["禁言中", summary.muted_users],
    ["已封禁", summary.banned_users],
    ["管理员", summary.admin_users],
  ] as const;

  return (
    <div className="grid gap-6">
      <section className="grid grid-cols-2 overflow-hidden rounded-xl border bg-surface sm:grid-cols-5" aria-label="用户概览">
        {metrics.map(([label, value], index) => (
          <div key={label} className={`grid gap-1 px-4 py-3 ${index ? "border-l" : ""} ${index > 1 ? "border-t sm:border-t-0" : ""}`}>
            <span className="text-xs text-muted-foreground">{label}</span>
            <strong className="text-xl tabular-nums">{value.toLocaleString("zh-CN")}</strong>
          </div>
        ))}
      </section>

      <div aria-live="polite" className="min-h-6">
        {error ? <FieldMessage role="alert">{error}</FieldMessage> : status ? <p className="text-sm font-medium text-primary">{status}</p> : null}
      </div>

      <div className="grid gap-3">
        {users.length ? users.map((user) => {
          const muted = isMuted(user);
          const rowPending = pending.startsWith(`${user.id}:`);
          const name = user.display_name || "未命名用户";
          return (
            <details key={user.id} className="group overflow-hidden rounded-xl border bg-surface">
              <summary className="grid cursor-pointer list-none gap-4 p-4 marker:hidden md:grid-cols-[minmax(13rem,1.4fr)_minmax(8rem,.6fr)_minmax(8rem,.6fr)_auto] md:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="truncate">{name}</strong>
                    {user.role === "admin" ? <span className="rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary">管理员</span> : null}
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{user.email || "未绑定邮箱"}</p>
                </div>
                <div className="text-sm">
                  <span className="block text-xs text-muted-foreground">公开 UID</span>
                  <strong className="tabular-nums">{user.public_uid || "待设置"}</strong>
                </div>
                <div className="text-sm">
                  <span className="block text-xs text-muted-foreground">账户状态</span>
                  <strong className={user.account_status === "banned" ? "text-destructive" : muted ? "text-primary" : "text-foreground"}>
                    {user.account_status === "banned" ? "已封禁" : muted ? "禁言中" : "正常"}
                  </strong>
                </div>
                <span className="rounded-lg border px-3 py-2 text-center text-sm font-medium group-open:border-primary/45 group-open:text-primary">管理</span>
              </summary>

              <div className="grid gap-5 border-t bg-muted/45 p-4 lg:grid-cols-[minmax(13rem,1fr)_minmax(0,2fr)]">
                <div className="grid content-start gap-3 text-xs text-muted-foreground">
                  <span>注册：{new Date(user.created_at).toLocaleString("zh-CN")}</span>
                  <span>登录：{user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString("zh-CN") : "尚无记录"}</span>
                  <span>邮箱：{user.email_confirmed ? "已确认" : "未确认"}</span>
                  {user.moderation_note ? <span className="rounded-lg bg-background p-3 leading-5">最近备注：{user.moderation_note}</span> : null}
                </div>
                <div className="grid gap-4">
                  <Field>
                    <Label htmlFor={`admin-reason-${user.id}`}>本次操作原因</Label>
                    <Input id={`admin-reason-${user.id}`} value={reason[user.id] || ""} onChange={(event) => setReason((current) => ({ ...current, [user.id]: event.target.value }))} maxLength={500} placeholder="必填，将写入审计日志" />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex gap-2">
                      <Input aria-label={`设置 ${name} 的 UID`} value={uid[user.id] ?? String(user.public_uid || "")} onChange={(event) => setUid((current) => ({ ...current, [user.id]: event.target.value }))} inputMode="numeric" maxLength={6} />
                      <Button type="button" variant="secondary" disabled={rowPending} onClick={() => mutate(user, "uid", { uid: Number(uid[user.id] ?? user.public_uid) }, `确认修改 ${name} 的公开 UID？`)}>
                        <IdentificationCard aria-hidden size={17} />保存 UID
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="secondary" disabled={rowPending || user.account_status === "banned"} onClick={() => mutate(user, "mute", { muted_until: new Date(Date.now() + 24 * 3600000).toISOString() }, `确认禁言 ${name} 24 小时？`)}>
                        <ClockCountdown aria-hidden size={17} />禁言 24 小时
                      </Button>
                      {muted ? <Button type="button" variant="secondary" disabled={rowPending} onClick={() => mutate(user, "mute", { muted_until: null }, `确认解除 ${name} 的禁言？`)}>解除禁言</Button> : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 border-t pt-4">
                    <Button type="button" variant="secondary" disabled={rowPending} onClick={() => mutate(user, "role", { role: user.role === "admin" ? "user" : "admin" }, `确认${user.role === "admin" ? "撤销" : "授予"} ${name} 的管理员权限？`)}>
                      <UserGear aria-hidden size={17} />{user.role === "admin" ? "撤销管理员" : "授予管理员"}
                    </Button>
                    <Button type="button" variant={user.account_status === "banned" ? "secondary" : "danger"} disabled={rowPending} onClick={() => mutate(user, "status", { status: user.account_status === "banned" ? "active" : "banned" }, `确认${user.account_status === "banned" ? "解除封禁" : "封禁"} ${name}？`)}>
                      {user.account_status === "banned" ? <CheckCircle aria-hidden size={17} /> : <Prohibit aria-hidden size={17} />}
                      {user.account_status === "banned" ? "解除封禁" : "封禁账号"}
                    </Button>
                  </div>
                </div>
              </div>
            </details>
          );
        }) : <div className="rounded-xl border border-dashed bg-surface p-7 text-sm text-muted-foreground">没有符合当前筛选条件的用户。</div>}
      </div>

      <footer className="flex flex-col gap-3 border-t pt-4 text-sm sm:flex-row sm:items-center sm:justify-between">
        <span className="text-muted-foreground">共 {total} 位用户，第 {page} / {totalPages} 页</span>
        <div className="flex gap-2">
          <Button asChild variant="secondary" size="small" aria-disabled={page <= 1}>
            <Link href={page <= 1 ? pageHref(1) : pageHref(page - 1)} tabIndex={page <= 1 ? -1 : undefined} className={page <= 1 ? "pointer-events-none opacity-50" : undefined}>上一页</Link>
          </Button>
          <Button asChild variant="secondary" size="small" aria-disabled={page >= totalPages}>
            <Link href={page >= totalPages ? pageHref(totalPages) : pageHref(page + 1)} tabIndex={page >= totalPages ? -1 : undefined} className={page >= totalPages ? "pointer-events-none opacity-50" : undefined}>下一页</Link>
          </Button>
        </div>
      </footer>
    </div>
  );
}
