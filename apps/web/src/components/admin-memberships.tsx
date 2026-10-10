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
    if (split<1 || !/^[a-z][a-z0-9_]{1,59}$/.test(key) || !value || value.length>240 || Object.hasOwn(result,key)) throw new Error("membership_benefits_invalid");
    Object.defineProperty(result, key, { value, enumerable: true, configurable: true, writable: true });
  }
  if (Object.keys(result).length>20) throw new Error("membership_benefits_invalid");
  return result;
}

export function MembershipPlanForm({ plan, pending, save }: { plan: MembershipPlan; pending: boolean; save: (value: Omit<MembershipPlan, "revision"> & { revision: number; reason: string }) => Promise<void> }) {
  const [error,setError] = useState("");
  return <form className="grid gap-4 rounded-xl border bg-surface p-5" onSubmit={(event) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    setError("");
    try { void save({ key: plan.key, title: String(data.get("title")), description: String(data.get("description")), benefits: parseBenefitLines(String(data.get("benefits"))), enabled: data.get("enabled") === "on", revision: plan.revision, reason: String(data.get("reason")) }); }
    catch (failure) { setError(membershipError(failure)); }
  }}>
    <h3 className="text-lg font-semibold">{plan.title} <span className="text-sm font-normal text-muted-foreground">{plan.enabled ? "可手工授予" : "未启用"}</span></h3>
    <Field><Label htmlFor={`${plan.key}-title`}>方案名称</Label><Input id={`${plan.key}-title`} name="title" defaultValue={plan.title} minLength={2} maxLength={60} required disabled={pending} /></Field>
    <Field><Label htmlFor={`${plan.key}-description`}>方案说明</Label><Textarea id={`${plan.key}-description`} name="description" defaultValue={plan.description} maxLength={1000} disabled={pending} /></Field>
    <Field><Label htmlFor={`${plan.key}-benefits`}>权益清单</Label><Textarea id={`${plan.key}-benefits`} name="benefits" defaultValue={Object.entries(plan.benefits).map(([key,value]) => `${key}=${value}`).join("\n")} aria-describedby={`${plan.key}-benefits-help`} disabled={pending} /><p id={`${plan.key}-benefits-help`} className="text-sm leading-6 text-muted-foreground">每行“英文权益代码=中文说明”，最多 20 项。未确认时请留空。这里只登记权益，尚未接入专属内容、导师折扣或 AI 额度；请勿先承诺未实现的服务。</p></Field>
    <label className="flex min-h-11 items-center gap-3 text-sm"><input name="enabled" type="checkbox" defaultChecked={plan.enabled} disabled={pending} className="size-4" />允许管理员手工授予此方案（不会开放付款或自动续费）</label>
    <Field><Label htmlFor={`${plan.key}-reason`}>变更原因</Label><Input id={`${plan.key}-reason`} name="reason" minLength={3} maxLength={500} required disabled={pending} /></Field>
    <Button type="submit" className="w-fit" disabled={pending}>{pending ? "保存中…" : "保存方案"}</Button>
    {error ? <FieldMessage role="alert">{error}</FieldMessage> : null}
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
  if (identityChanged) return <p role="alert">账号已改变，已清除会员管理数据，请重新打开后台。</p>;
  return <div className="grid gap-8">
    <div className="rounded-xl border bg-muted/40 p-4 text-sm leading-6 text-muted-foreground">目前仅提供可审计的手工会员管理。会员不是管理员；不会修改导师订单、既有公开内容或启用收费。价格、权益与支付渠道确认后再接入购买流程。</div>
    <div aria-live="polite">{error ? <FieldMessage role="alert">{error}</FieldMessage> : status ? <p role="status" className="text-sm text-primary">{status}</p> : null}</div>
    <section className="grid gap-4" aria-labelledby="plans-title"><div className="flex flex-wrap items-center justify-between gap-3"><h2 id="plans-title" className="text-xl font-semibold">会员方案</h2><Button type="button" variant="secondary" disabled={pending} onClick={() => void run((repository) => query(repository, store?.member?.public_uid ?? null))}>重新核对记录</Button></div>
      {store ? store.plans.map((plan) => <MembershipPlanForm key={`${plan.key}:${plan.revision}`} plan={plan} pending={pending} save={async (value) => {
        await run(async (repository) => { const current = revision.current; await repository.savePlan({ ...value, requestId: requestId(value) }); if (current !== revision.current) return; request.current=null; await query(repository, store.member?.public_uid ?? null, current); if (current === revision.current) setStatus("方案已保存；购买与自动续费仍未开放。"); });
      }} />) : <p className="rounded-xl border border-dashed p-6 text-muted-foreground">会员服务暂不可用，请部署迁移后重新核对。</p>}
    </section>
    {!store?.member && store?.history.length ? <section className="grid gap-3" aria-labelledby="plan-audit-title"><h2 id="plan-audit-title" className="text-xl font-semibold">方案变更记录</h2><ol className="divide-y rounded-xl border bg-surface">{store.history.map((item)=><li key={item.id} className="grid gap-1 p-4 text-sm"><strong>{item.plan_key} · 配置方案</strong><span>{item.reason}</span><time dateTime={item.created_at} className="text-muted-foreground">{membershipDate(item.created_at)}</time></li>)}</ol></section> : null}
    <section className="grid gap-4" aria-labelledby="grants-title"><h2 id="grants-title" className="text-xl font-semibold">查询与管理会员</h2><form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); const publicUid=Number(uid); if (!Number.isSafeInteger(publicUid) || publicUid<=0) { setError("请输入有效的站内 UID。"); return; } void run((repository) => query(repository, publicUid)); }}><Field className="flex-1"><Label htmlFor="membership-uid">站内 UID</Label><Input id="membership-uid" value={uid} onChange={(event) => setUid(event.target.value)} inputMode="numeric" pattern="[0-9]+" required disabled={pending} /></Field><Button type="submit" variant="secondary" disabled={pending || !store}>{pending ? "正在核对…" : "查询用户"}</Button></form>
      {store?.member ? <div className="grid gap-4 rounded-xl border bg-surface p-5"><header><h3 className="font-semibold">{store.member.display_name} · UID {store.member.public_uid}</h3><p className="text-sm text-muted-foreground">账户状态：{store.member.account_status === "active" ? "正常" : "已限制"}</p></header>
        {store.grants.length ? <ul className="space-y-2 text-sm">{store.grants.map((grant) => <li key={grant.id}>{store.plans.find((plan) => plan.key===grant.plan_key)?.title || grant.plan_key} · {grant.status === "revoked" ? "已撤销" : "授权记录（未撤销）"} · 到期 {membershipDate(grant.ends_at)}</li>)}</ul> : <p className="text-sm text-muted-foreground">尚无会员授权。</p>}
        <form key={`${store.member.id}:${store.grants.map((grant) => grant.revision).join(":")}`} className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => {
          event.preventDefault(); const data=new FormData(event.currentTarget); const action=String(data.get("action")) as "grant"|"extend"|"revoke"; const planKey=String(data.get("plan"));
          if (action==="revoke" && !window.confirm("确认撤销此用户的会员？记录将保留，可之后重新授予。")) return;
          if (action!=="revoke" && !Number.isFinite(Date.parse(String(data.get("end"))))) { setError("请选择有效的到期时间。"); return; }
          const input={ userId: store.member!.id, planKey, action, endsAt: action==="revoke" ? null : String(data.get("end")) ? new Date(String(data.get("end"))).toISOString() : null, revision: store.grants.find((grant) => grant.plan_key===planKey)?.revision || 0, reason: String(data.get("reason")) };
          void run(async (repository) => { const current=revision.current; await repository.change({ ...input, requestId:requestId(input) }); if (current !== revision.current) return; request.current=null; await query(repository,store.member!.public_uid,current); if (current===revision.current) setStatus("会员变更已保存，已重新核对当前记录。"); });
        }}>
          <Field><Label htmlFor="grant-plan">会员方案</Label><select id="grant-plan" name="plan" className={selectClass} disabled={pending} required>{store.plans.map((plan) => <option key={plan.key} value={plan.key}>{plan.title}{!plan.enabled ? "（未启用，只能撤销）" : ""}</option>)}</select></Field>
          <Field><Label htmlFor="grant-action">操作</Label><select id="grant-action" name="action" className={selectClass} disabled={pending}><option value="grant">授予 / 重新授予</option><option value="extend">延长到期时间</option><option value="revoke">撤销</option></select></Field>
          <Field><Label htmlFor="grant-end">到期时间（本机时区；撤销时忽略）</Label><Input id="grant-end" name="end" type="datetime-local" disabled={pending} /></Field>
          <Field><Label htmlFor="grant-reason">操作原因</Label><Input id="grant-reason" name="reason" required minLength={3} maxLength={500} disabled={pending} /></Field>
          <Button type="submit" disabled={pending} className="w-fit">{pending ? "执行中…" : "提交会员变更"}</Button>
        </form>
        <section className="grid gap-3 border-t pt-4"><h4 className="font-semibold">最近变更审计</h4>{store.history.length ? <ol className="space-y-3 text-sm">{store.history.map((item) => <li key={item.id} className="grid gap-1"><strong>{item.action === "granted" ? "授予" : item.action === "extended" ? "延长" : item.action === "plan_updated" ? "配置方案" : "撤销"} · {item.plan_key}</strong><span>{item.reason}</span><time dateTime={item.created_at} className="text-muted-foreground">{membershipDate(item.created_at)}</time></li>)}</ol> : <p className="text-sm text-muted-foreground">暂无变更记录。</p>}</section>
      </div> : <p className="text-sm text-muted-foreground">先按 UID 查询一个用户，再核对其会员授权。</p>}
    </section>
  </div>;
}
