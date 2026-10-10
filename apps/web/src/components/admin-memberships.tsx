"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Field, FieldMessage, Input, Label, Textarea } from "@wavekb/ui";
import { membershipRepository } from "@/lib/membership/client-repository";
import { membershipError, type MembershipAdminStore, type MembershipPlan } from "@/lib/membership/types";
import { createClient } from "@/lib/supabase/client";
import { membershipDate } from "@/components/membership-center";

const selectClass = "min-h-11 w-full rounded-lg border border-input bg-surface px-3 text-sm outline-none focus:ring-2 focus:ring-ring";
export function parseBenefitLines(text: string) {
  const result: Record<string, string> = {};
  for (const line of text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    const split = line.indexOf("="); const key = line.slice(0, split).trim(); const value = line.slice(split + 1).trim();
    if (split<1 || !/^[a-z][a-z0-9_]{1,59}$/.test(key) || !value || Array.from(value).length>240 || Object.hasOwn(result,key)) throw new Error("membership_benefits_invalid");
    Object.defineProperty(result, key, { value, enumerable: true, configurable: true, writable: true });
  }
  if (Object.keys(result).length>20) throw new Error("membership_benefits_invalid");
  return result;
}

export function MembershipPlanForm({ plan, pending, save }: { plan: MembershipPlan; pending: boolean; save: (value: Omit<MembershipPlan, "revision"> & { revision: number; reason: string }) => Promise<void> }) {
  const [error,setError] = useState("");
  return <form className="grid gap-4 rounded-xl border bg-surface p-5" onSubmit={(event) => {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    setError("");
    try { void save({ key: plan.key, title: String(data.get("title")), description: String(data.get("description")), benefits: parseBenefitLines(String(data.get("benefits"))), enabled: data.get("enabled") === "on", revision: plan.revision, reason: String(data.get("reason")) }); }
    catch (failure) { setError(membershipError(failure)); form.querySelector<HTMLTextAreaElement>('textarea[name="benefits"]')?.focus(); }
  }}>
    <h3 className="text-lg font-semibold">{plan.title} <span className="text-sm font-normal text-muted-foreground">{plan.enabled ? "可手工授予" : "未启用"}</span></h3>
    <Field><Label htmlFor={`${plan.key}-title`}>方案名称</Label><Input id={`${plan.key}-title`} name="title" defaultValue={plan.title} minLength={2} maxLength={60} required disabled={pending} /></Field>
    <Field><Label htmlFor={`${plan.key}-description`}>方案说明</Label><Textarea id={`${plan.key}-description`} name="description" defaultValue={plan.description} maxLength={1000} disabled={pending} /></Field>
    <Field><Label htmlFor={`${plan.key}-benefits`}>权益清单</Label><Textarea id={`${plan.key}-benefits`} name="benefits" defaultValue={Object.entries(plan.benefits).map(([key,value]) => `${key}=${value}`).join("\n")} aria-invalid={Boolean(error)} aria-describedby={`${plan.key}-benefits-help${error ? ` ${plan.key}-benefits-error` : ""}`} onChange={() => setError("")} disabled={pending} /><p id={`${plan.key}-benefits-help`} className="text-sm leading-6 text-muted-foreground">每行“英文权益代码=中文说明”，最多 20 项，未确认时留空。这里只登记说明，不通过文案启用服务；平台额度与导师优惠须在独立数值配置中设置并由服务端核验，请勿承诺未实现的服务。</p>{error ? <FieldMessage id={`${plan.key}-benefits-error`} role="alert">{error}</FieldMessage> : null}</Field>
    <label className="flex min-h-11 items-center gap-3 text-sm"><input name="enabled" type="checkbox" defaultChecked={plan.enabled} disabled={pending} className="size-4" />允许管理员手工授予此方案（不会开放付款或自动续费）</label>
    <Field><Label htmlFor={`${plan.key}-reason`}>变更原因</Label><Input id={`${plan.key}-reason`} name="reason" minLength={3} maxLength={500} required disabled={pending} /></Field>
    <Button type="submit" className="min-h-11 w-fit" disabled={pending}>{pending ? "保存中…" : "保存方案"}</Button>
  </form>;
}

export type MembershipGrantInput = { planKey: string; action: "grant" | "extend" | "revoke"; endsAt: string | null; reason: string };

export function MembershipGrantForm({ plans, pending, submit, invalid }: { plans: MembershipPlan[]; pending: boolean; submit: (value: MembershipGrantInput) => void; invalid: (message: string) => void }) {
  const [action, setAction] = useState<MembershipGrantInput["action"]>("grant");
  return <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => {
    event.preventDefault(); const data = new FormData(event.currentTarget); const planKey = String(data.get("plan"));
    if (action === "revoke" && !window.confirm("确认撤销此用户的会员？记录将保留，可之后重新授予。")) return;
    if (action !== "revoke" && !Number.isFinite(Date.parse(String(data.get("end"))))) { invalid("请选择有效的到期时间。"); return; }
    submit({ planKey, action, endsAt: action === "revoke" ? null : new Date(String(data.get("end"))).toISOString(), reason: String(data.get("reason")) });
  }}>
    <Field><Label htmlFor="grant-plan">会员方案</Label><select id="grant-plan" name="plan" className={selectClass} disabled={pending} required>{plans.map((plan) => <option key={plan.key} value={plan.key}>{plan.title}{!plan.enabled ? "（未启用，只能撤销）" : ""}</option>)}</select></Field>
    <Field><Label htmlFor="grant-action">操作</Label><select id="grant-action" name="action" className={selectClass} value={action} onChange={(event) => setAction(event.target.value as MembershipGrantInput["action"])} disabled={pending}><option value="grant">授予 / 重新授予</option><option value="extend">延长到期时间</option><option value="revoke">撤销</option></select></Field>
    <Field><Label htmlFor="grant-end">到期时间（本机时区；撤销时忽略）</Label><Input id="grant-end" name="end" type="datetime-local" step={1} required={action !== "revoke"} disabled={pending || action === "revoke"} /></Field>
    <Field><Label htmlFor="grant-reason">操作原因</Label><Input id="grant-reason" name="reason" required minLength={3} maxLength={500} disabled={pending} /></Field>
    <Button type="submit" disabled={pending} className="min-h-11 w-fit">{pending ? "执行中…" : "提交会员变更"}</Button>
  </form>;
}

export function AdminMemberships({ actorId, initial, initialError = "" }: { actorId: string; initial: MembershipAdminStore | null; initialError?: string }) {
  const [store, setStore] = useState(initial);
  const [error, setError] = useState(initialError);
  const [status, setStatus] = useState("");
  const [uid, setUid] = useState("");
  const [pending, setPending] = useState(false);
  const [identityChanged, setIdentityChanged] = useState(false);
  const request = useRef<{ signature: string; id: string } | null>(null);
  const revision = useRef(0);
  useEffect(() => {
    const invalidate = () => { ++revision.current; };
    const { data } = createClient().auth.onAuthStateChange((_event, session) => {
      if (session?.user.id !== actorId) { ++revision.current; setStore(null); setIdentityChanged(true); request.current = null; }
    });
    return () => { invalidate(); data.subscription.unsubscribe(); };
  }, [actorId]);
  async function run(task: (repository: ReturnType<typeof membershipRepository>) => Promise<void>) {
    const current = revision.current; setPending(true); setError(""); setStatus("");
    try { await task(membershipRepository(createClient(), actorId)); }
    catch (failure) { if (current === revision.current) setError(membershipError(failure)); }
    finally { if (current === revision.current) setPending(false); }
  }
  function requestId(value: unknown) {
    const signature = JSON.stringify(value);
    if (request.current?.signature !== signature) request.current = { signature, id: crypto.randomUUID() };
    return request.current.id;
  }
  async function query(repository: ReturnType<typeof membershipRepository>, publicUid: number | null, current = revision.current) {
    if (current !== revision.current) throw new Error("authentication_required");
    // A failed lookup must not leave the previous account as an actionable target.
    setStore((previous) => previous ? { ...previous, member:null, grants:[], history:[] } : null);
    const result = await repository.adminStore(publicUid);
    if (current === revision.current) setStore(result);
  }
  if (identityChanged) return <section className="grid gap-3 rounded-xl border bg-surface p-5"><p role="alert" className="text-sm leading-6">账号已改变，已清除会员管理数据。请重新核对当前账号及管理员权限后继续。</p><a href="/admin/memberships" className="flex min-h-11 w-fit items-center rounded-lg border px-4 py-2 text-sm font-medium text-primary underline underline-offset-4">重新核对当前账号</a></section>;
  return <div className="grid gap-8">
    <div className="rounded-xl border bg-muted/40 p-4 text-sm leading-6 text-muted-foreground">此区域只管理方案说明与可审计的手工授权，不修改购买订单或购买权益。公开价格、数值权益与付款开关在上方独立配置；会员不是管理员，公开内容保持开放。</div>
    <div aria-live="polite">{error ? <FieldMessage role="alert">{error}</FieldMessage> : status ? <p role="status" className="text-sm text-primary">{status}</p> : null}</div>
    <section className="grid gap-4" aria-labelledby="plans-title"><div className="flex flex-wrap items-center justify-between gap-3"><h2 id="plans-title" className="text-xl font-semibold">会员方案</h2><Button type="button" variant="secondary" className="min-h-11" disabled={pending} onClick={() => void run((repository) => query(repository, store?.member?.public_uid ?? null))}>重新核对记录</Button></div>
      {store ? store.plans.map((plan) => <MembershipPlanForm key={`${plan.key}:${plan.revision}`} plan={plan} pending={pending} save={async (value) => {
        await run(async (repository) => { const current = revision.current; await repository.savePlan({ ...value, requestId: requestId(value) }); if (current !== revision.current) return; request.current=null; await query(repository, store.member?.public_uid ?? null, current); if (current === revision.current) setStatus("方案已保存；付款开关与订单在独立购买配置中核对，不自动续费。"); });
      }} />) : <p className="rounded-xl border border-dashed p-6 text-muted-foreground">会员服务暂不可用，请部署迁移后重新核对。</p>}
    </section>
    {!store?.member && store?.history.length ? <section className="grid gap-3" aria-labelledby="plan-audit-title"><h2 id="plan-audit-title" className="text-xl font-semibold">方案变更记录</h2><ol className="divide-y rounded-xl border bg-surface">{store.history.map((item)=><li key={item.id} className="grid gap-1 p-4 text-sm"><strong>{item.plan_key} · 配置方案</strong><span>{item.reason}</span><time dateTime={item.created_at} className="text-muted-foreground">{membershipDate(item.created_at)}</time></li>)}</ol></section> : null}
    <section className="grid gap-4" aria-labelledby="grants-title"><h2 id="grants-title" className="text-xl font-semibold">查询与管理会员</h2><form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); const publicUid=Number(uid); if (!Number.isSafeInteger(publicUid) || publicUid<=0) { setError("请输入有效的站内 UID。"); return; } void run((repository) => query(repository, publicUid)); }}><Field className="flex-1"><Label htmlFor="membership-uid">站内 UID</Label><Input id="membership-uid" value={uid} onChange={(event) => setUid(event.target.value)} inputMode="numeric" pattern="[0-9]+" required disabled={pending} /></Field><Button type="submit" variant="secondary" className="min-h-11" disabled={pending || !store}>{pending ? "正在核对…" : "查询用户"}</Button></form>
      {store?.member ? <div className="grid gap-4 rounded-xl border bg-surface p-5"><header><h3 className="font-semibold">{store.member.display_name} · UID {store.member.public_uid}</h3><p className="text-sm text-muted-foreground">账户状态：{store.member.account_status === "active" ? "正常" : "已限制"}</p></header>
        {store.grants.length ? <ul className="space-y-2 text-sm">{store.grants.map((grant) => <li key={grant.id}>{store.plans.find((plan) => plan.key===grant.plan_key)?.title || grant.plan_key} · {grant.status === "revoked" ? "已撤销" : "授权记录（未撤销）"} · 到期 {membershipDate(grant.ends_at)}</li>)}</ul> : <p className="text-sm text-muted-foreground">尚无会员授权。</p>}
        <MembershipGrantForm key={`${store.member.id}:${store.grants.map((grant) => grant.revision).join(":")}`} plans={store.plans} pending={pending} invalid={setError} submit={(value) => {
          const input={ ...value, userId: store.member!.id, revision: store.grants.find((grant) => grant.plan_key===value.planKey)?.revision || 0 };
          void run(async (repository) => { const current=revision.current; await repository.change({ ...input, requestId:requestId(input) }); if (current !== revision.current) return; request.current=null; await query(repository,store.member!.public_uid,current); if (current===revision.current) setStatus("会员变更已保存，已重新核对当前记录。"); });
        }} />
        <section className="grid gap-3 border-t pt-4"><h4 className="font-semibold">最近变更审计</h4>{store.history.length ? <ol className="space-y-3 text-sm">{store.history.map((item) => <li key={item.id} className="grid gap-1"><strong>{item.action === "granted" ? "授予" : item.action === "extended" ? "延长" : item.action === "plan_updated" ? "配置方案" : "撤销"} · {item.plan_key}</strong><span>{item.reason}</span><time dateTime={item.created_at} className="text-muted-foreground">{membershipDate(item.created_at)}</time></li>)}</ol> : <p className="text-sm text-muted-foreground">暂无变更记录。</p>}</section>
      </div> : <p className="text-sm text-muted-foreground">先按 UID 查询一个用户，再核对其会员授权。</p>}
    </section>
  </div>;
}
