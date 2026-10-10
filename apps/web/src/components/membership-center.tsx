"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, FieldMessage } from "@wavekb/ui";
import { membershipRepository } from "@/lib/membership/client-repository";
import { membershipError, type MyMembership } from "@/lib/membership/types";
import { createClient } from "@/lib/supabase/client";

const labels = { active: "生效中", revoked: "已撤销", disabled: "方案已停用", scheduled: "尚未生效", expired: "已到期" };
const actions: Record<string, string> = { granted: "授予会员", extended: "延长有效期", revoked: "撤销会员" };
export function membershipDate(value: string) { return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }

export function MembershipCenter({ actorId, initial, initialError = "" }: { actorId: string; initial: MyMembership | null; initialError?: string }) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState(initial);
  const [error, setError] = useState(initialError);
  const [pending, setPending] = useState(false);
  const [identityChanged, setIdentityChanged] = useState(false);
  const revision = useRef(0);
  useEffect(() => {
    const client = createClient(); let active = true;
    const invalidate = () => { ++revision.current; };
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      if (session?.user.id !== actorId && active) {
        ++revision.current;
        setSnapshot(null); setIdentityChanged(true); router.refresh();
      }
    });
    return () => { active = false; invalidate(); data.subscription.unsubscribe(); };
  }, [actorId, router]);
  async function refresh() {
    const current = revision.current;
    setPending(true); setError("");
    try { const result = await membershipRepository(createClient(), actorId).mine(); if (current === revision.current) setSnapshot(result); }
    catch (failure) { if (current === revision.current) { setSnapshot(null); setError(membershipError(failure)); } }
    finally { if (current === revision.current) setPending(false); }
  }
  if (identityChanged) return <section className="grid gap-3 rounded-xl border bg-surface p-5"><p role="status" className="text-sm leading-6">账号已变化，旧会员信息已清除。请重新核对当前账号后继续。</p><a href="/membership" className="flex min-h-11 w-fit items-center rounded-lg border px-4 py-2 text-sm font-medium text-primary underline underline-offset-4">重新核对当前账号</a></section>;
  return <MembershipSummary snapshot={snapshot} error={error} pending={pending} onRefresh={refresh} />;
}

export function MembershipSummary({ snapshot, error = "", pending = false, onRefresh }: { snapshot: MyMembership | null; error?: string; pending?: boolean; onRefresh: () => void }) {
  return <div className="grid gap-8">
    <div className="rounded-xl border bg-muted/40 p-4 text-sm leading-6 text-muted-foreground">下列为管理员授权补充记录，购买订单及实际权益在上方核对。VIP 不是管理员，公开书籍和社区阅读保持免费。</div>
    <section aria-labelledby="membership-status" className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="membership-status" className="text-xl font-semibold">我的会员状态</h2><Button type="button" variant="secondary" className="min-h-11" disabled={pending} onClick={onRefresh}>{pending ? "正在核对…" : "刷新状态"}</Button></div>
      {error ? <FieldMessage role="alert">{error}</FieldMessage> : null}
      {!snapshot ? <p className="rounded-xl border border-dashed p-6 text-muted-foreground">未能核对会员记录。恢复服务后点击刷新，不会将未知状态误显示为有效会员。</p> : snapshot.grants.length ? <div className="grid gap-4 sm:grid-cols-2">{snapshot.grants.map((item) => <article key={item.id} className="grid content-start gap-4 rounded-xl border bg-surface p-5"><div className="flex items-center justify-between gap-3"><h3 className="text-lg font-semibold">{item.title}</h3><span className="rounded-md bg-muted px-2 py-1 text-sm font-medium">{labels[item.status]}</span></div><dl className="grid gap-2 text-sm"><div><dt className="text-muted-foreground">生效时间（北京时间）</dt><dd><time dateTime={item.starts_at}>{membershipDate(item.starts_at)}</time></dd></div><div><dt className="text-muted-foreground">到期时间（北京时间）</dt><dd><time dateTime={item.ends_at}>{membershipDate(item.ends_at)}</time></dd></div></dl>{Object.keys(item.benefits).length ? <ul className="list-inside list-disc space-y-2 text-sm">{Object.entries(item.benefits).map(([key, value]) => <li key={key}>{value}</li>)}</ul> : <p className="text-sm leading-6 text-muted-foreground">此授权没有补充权益说明。平台额度及导师优惠请以上方实际权益为准。</p>}</article>)}</div> : <p className="rounded-xl border border-dashed bg-surface p-6 text-sm leading-6 text-muted-foreground">暂无管理员授权记录，VIP 权益与购买订单请在上方核对。</p>}
    </section>
    {snapshot ? <section aria-labelledby="membership-history" className="grid gap-3"><h2 id="membership-history" className="text-xl font-semibold">会员记录</h2>{snapshot.history.length ? <ol className="divide-y rounded-xl border bg-surface">{snapshot.history.map((item) => <li key={item.id} className="flex flex-wrap justify-between gap-2 p-4 text-sm"><span>{item.title} · {actions[item.action] || item.action}{item.ends_at ? ` · 到期 ${membershipDate(item.ends_at)}` : ""}</span><time className="text-muted-foreground" dateTime={item.created_at}>{membershipDate(item.created_at)}</time></li>)}</ol> : <p className="text-sm text-muted-foreground">暂无授予、延长或撤销记录。</p>}</section> : null}
  </div>;
}
