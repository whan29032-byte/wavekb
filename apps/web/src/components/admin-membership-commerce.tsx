"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Field, FieldMessage, Input, Label } from "@wavekb/ui";
import { createClient } from "@/lib/supabase/client";
import { membershipCommerceRepository } from "@/lib/membership/commerce-client-repository";
import { membershipCommerceError, type CommercePlan, type CommerceSettings, type MembershipCommerceAdminStore, type MembershipPrice } from "@/lib/membership/commerce-types";
import { membershipDate } from "@/components/membership-center";

type Repository = ReturnType<typeof membershipCommerceRepository>;
type PriceInput = Omit<Parameters<Repository["savePrice"]>[0], "requestId">;
type EntitlementsInput = Omit<Parameters<Repository["saveEntitlements"]>[0], "requestId">;
type SettingsInput = Omit<Parameters<Repository["saveSettings"]>[0], "requestId">;
const selectClass = "min-h-11 w-full rounded-lg border border-input bg-surface px-3 text-sm outline-none focus:ring-2 focus:ring-ring";

// Exact decimal parsing: never silently round a price or percentage supplied by an administrator.
export function membershipDecimalMinor(value: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) throw new Error("请输入最多两位小数的有效数值。");
  const [whole, fraction = ""] = value.trim().split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(result)) throw new Error("数值超出支持范围。");
  return result;
}

function Reason({ id, pending, error = "", onChange }: { id: string; pending: boolean; error?: string; onChange?: () => void }) {
  return <Field><Label htmlFor={id}>变更原因</Label><Input id={id} name="reason" required minLength={3} maxLength={500} disabled={pending} className="min-h-11" aria-invalid={error.includes("原因")} aria-describedby={error ? `${id}-error` : undefined} onChange={onChange} /></Field>;
}

function reason(data: FormData) {
  const value = String(data.get("reason")).trim();
  if (Array.from(value).length < 3 || Array.from(value).length > 500) throw new Error("变更原因须为 3—500 个有效字符。");
  return value;
}

export function MembershipPriceForm({ price, pending, save }: { price: MembershipPrice; pending: boolean; save: (input: PriceInput) => void }) {
  const [error, setError] = useState(""); const id = `commerce-price-${price.id}`;
  return <form className="grid gap-4 rounded-xl border bg-surface p-5" onSubmit={(event) => {
    event.preventDefault(); const data = new FormData(event.currentTarget); setError("");
    try { const amountMinor = membershipDecimalMinor(String(data.get("amount"))); if (amountMinor < 1 || amountMinor > 100000000) throw new Error("价格须为 0.01 至 1,000,000.00。"); save({ id: price.id, planKey: price.plan_key, termMonths: price.term_months, amountMinor, currency: price.currency, published: data.get("published") === "on", revision: price.revision, reason: reason(data) }); }
    catch (failure) { const message = failure instanceof Error ? failure.message : "请核对价格。"; setError(message); event.currentTarget.querySelector<HTMLInputElement>(`input[name="${message.includes("原因") ? "reason" : "amount"}"]`)?.focus(); }
  }}><h4 className="font-semibold">{price.term_months === 1 ? "月度价格" : "年度价格"} · {price.currency}</h4><p className="text-xs leading-5 text-muted-foreground">一次性购买 {price.term_months} 个月，不自动续费。价格调整仅影响新订单，不修改已冻结订单或现有购买权益。</p><Field><Label htmlFor={`${id}-amount`}>价格（{price.currency}）</Label><Input id={`${id}-amount`} name="amount" type="number" min="0.01" max="1000000" step="0.01" required defaultValue={(price.amount_minor / 100).toFixed(2)} disabled={pending} className="min-h-11" aria-invalid={Boolean(error) && !error.includes("原因")} aria-describedby={error ? `${id}-reason-error` : undefined} onChange={() => setError("")} /></Field><label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" name="published" defaultChecked={price.published} disabled={pending} className="size-4" />公开此价格（不会单独打开付款）</label><Reason id={`${id}-reason`} pending={pending} error={error} onChange={() => setError("")} />{error ? <FieldMessage id={`${id}-reason-error`} role="alert">{error}</FieldMessage> : null}<Button type="submit" className="min-h-11 w-fit" disabled={pending}>保存{price.term_months === 1 ? "月度" : "年度"}价格</Button></form>;
}

export function MembershipEntitlementsForm({ plan, pending, save }: { plan: CommercePlan; pending: boolean; save: (input: EntitlementsInput) => void }) {
  const [error, setError] = useState(""); const id = `commerce-entitlement-${plan.key}`;
  return <form className="grid gap-4 rounded-xl border bg-surface p-5" onSubmit={(event) => {
    event.preventDefault(); const data = new FormData(event.currentTarget); setError("");
    try { const aiDailyLimit = Number(data.get("quota")); const mentorDiscountBps = membershipDecimalMinor(String(data.get("discount"))); if (!Number.isSafeInteger(aiDailyLimit) || aiDailyLimit < 0 || aiDailyLimit > 10000) throw new Error("平台额度须为 0—10000 的整数。"); if (mentorDiscountBps > 9900) throw new Error("导师优惠最高 99%，仅支持正金额付款，不能设置 100% 免费。"); save({ planKey: plan.key, aiDailyLimit, mentorDiscountBps, revision: plan.revision, reason: reason(data) }); }
    catch (failure) { const message = failure instanceof Error ? failure.message : "请核对权益数值。"; setError(message); event.currentTarget.querySelector<HTMLInputElement>(`input[name="${message.includes("原因") ? "reason" : message.includes("平台额度") ? "quota" : "discount"}"]`)?.focus(); }
  }}><h4 className="font-semibold">{plan.title} · 数值权益</h4><p className="text-xs leading-5 text-muted-foreground">额度仅针对配置并开放的平台 AI 服务，不限制免费自带 Key。10% 优惠即导师 9 折；0 代表关闭对应额度或优惠。优惠最高 99%，仅支持正金额付款，不能设置 100% 免费。已付款订单继续使用其购买快照。</p><Field><Label htmlFor={`${id}-quota`}>每日平台 AI 次数</Label><Input id={`${id}-quota`} name="quota" type="number" min={0} max={10000} step={1} required defaultValue={plan.ai_daily_limit} disabled={pending} className="min-h-11" onChange={() => setError("")} /></Field><Field><Label htmlFor={`${id}-discount`}>导师价格优惠（%）</Label><Input id={`${id}-discount`} name="discount" type="number" min={0} max={99} step="0.01" required defaultValue={(plan.mentor_discount_bps / 100).toFixed(2)} disabled={pending} className="min-h-11" onChange={() => setError("")} /></Field><Reason id={`${id}-reason`} pending={pending} error={error} onChange={() => setError("")} />{error ? <FieldMessage id={`${id}-reason-error`} role="alert">{error}</FieldMessage> : null}<Button type="submit" className="min-h-11 w-fit" disabled={pending}>保存数值权益</Button></form>;
}

export function MembershipCommerceSettingsForm({ settings, pending, save }: { settings: CommerceSettings; pending: boolean; save: (input: SettingsInput) => void }) {
  const [error, setError] = useState("");
  return <form className="grid gap-4 rounded-xl border bg-surface p-5" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); setError(""); try { save({ billingEnabled: data.get("billing") === "on", paymentMode: data.get("mode") === "live" ? "live" : "test", revision: settings.revision, reason: reason(data) }); } catch (failure) { setError(failure instanceof Error ? failure.message : "请填写有效原因。"); event.currentTarget.querySelector<HTMLInputElement>('input[name="reason"]')?.focus(); } }}><h3 className="text-lg font-semibold">付款开关</h3><p className="text-sm leading-6 text-muted-foreground">公开价格与允许付款是独立设置。开启前须由运营配置对应模式的 Stripe 商户密钥、支付回调及服务端开关；此处不会写入密钥。没有完整商户配置时，购买仍会被服务端拒绝。关闭新购买不停止已有付款回调核对。</p><Field><Label htmlFor="commerce-payment-mode">付款模式</Label><select id="commerce-payment-mode" name="mode" defaultValue={settings.payment_mode} disabled={pending} className={selectClass}><option value="test">测试（不授予正式权益）</option><option value="live">正式</option></select></Field><label className="flex min-h-11 items-center gap-3 text-sm"><input name="billing" type="checkbox" defaultChecked={settings.billing_enabled} disabled={pending} className="size-4" />允许发起新的一次性会员购买</label><Reason id="commerce-settings-reason" pending={pending} error={error} onChange={() => setError("")} />{error ? <FieldMessage id="commerce-settings-reason-error" role="alert">{error}</FieldMessage> : null}<Button type="submit" className="min-h-11 w-fit" disabled={pending}>保存付款设置</Button></form>;
}

export function AdminMembershipCommerce({ actorId, initial, initialError = "" }: { actorId: string; initial: MembershipCommerceAdminStore | null; initialError?: string }) {
  const [store, setStore] = useState(initial); const [error, setError] = useState(initialError); const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false); const [uncertain, setUncertain] = useState(false); const [identityChanged, setIdentityChanged] = useState(false);
  const revision = useRef(0); const lock = useRef(false);
  const original = useRef<{ id: string; task: (repository: Repository, requestId: string) => Promise<unknown> } | null>(null);
  useEffect(() => {
    const invalidate = () => { ++revision.current; };
    const { data } = createClient().auth.onAuthStateChange((_event, session) => {
      if (session?.user.id !== actorId) { ++revision.current; lock.current = false; original.current = null; setStore(null); setPending(false); setIdentityChanged(true); }
    });
    return () => { invalidate(); data.subscription.unsubscribe(); };
  }, [actorId]);

  async function read(current: number, repository: Repository) {
    if (current !== revision.current) throw new Error("authentication_required");
    setStore(null);
    const result = await repository.adminStore();
    if (current !== revision.current) throw new Error("authentication_required");
    setStore(result); return result;
  }

  async function run(task?: (repository: Repository, requestId: string) => Promise<unknown>, retry = false) {
    if (lock.current || identityChanged || uncertain && !retry && task) return;
    lock.current = true; setPending(true); setError(""); setMessage(""); const current = revision.current;
    const repository = membershipCommerceRepository(createClient(), actorId);
    try {
      if (task && !original.current) original.current = { id: crypto.randomUUID(), task };
      if (retry) await read(current, repository);
      if (task || retry) {
        const request = original.current; if (!request) return;
        await request.task(repository, request.id);
        if (current !== revision.current) return;
        await read(current, repository); original.current = null; setUncertain(false); setMessage("配置回执已验证，并已重新读取当前配置。已有订单快照不变。");
      } else { await read(current, repository); setMessage(original.current ? "已重新读取当前配置，上次保存结果仍须使用原请求核对。请勿重复编辑提交。" : "已重新读取当前配置。"); }
    } catch (failure) {
      if (current !== revision.current) return;
      const code = failure instanceof Error ? failure.message : failure && typeof failure === "object" && "message" in failure ? String(failure.message) : String(failure);
      if (/authentication_required|admin_required|account_ineligible/.test(code)) { ++revision.current; original.current = null; setStore(null); setIdentityChanged(true); lock.current = false; setPending(false); }
      else if (/membership_input_invalid|membership_changed_concurrently|membership_plan_not_found|membership_price_identity_immutable|request_conflict/.test(code)) {
        original.current = null; setUncertain(false); setError(membershipCommerceError(failure));
        try { await read(current, repository); if (current === revision.current) setMessage("服务器已明确拒绝此变更，已重新读取当前配置。核对后可重新编辑提交。"); } catch { if (current === revision.current) setStore(null); }
      }
      else { setError(membershipCommerceError(failure)); setUncertain(Boolean(original.current)); if (original.current) setMessage("保存结果尚未确认，已保留原请求。重新核对后只使用原请求重试，不会伪装已保存。"); }
    } finally { if (current === revision.current) { lock.current = false; setPending(false); } }
  }
  if (identityChanged) return <section className="grid gap-3 rounded-xl border bg-surface p-5"><p role="alert">账号已变化，旧付款与权益配置已清除。请重新核对当前账号及管理员权限。</p><a href="/admin/memberships" className="flex min-h-11 w-fit items-center rounded-lg border px-4 py-2 text-sm font-medium text-primary underline underline-offset-4">重新核对当前账号</a></section>;
  return <AdminMembershipCommerceSummary store={store} error={error} message={message} pending={pending} uncertain={uncertain} refresh={() => void run()} retry={() => void run(undefined, true)} savePrice={(input) => void run((repository, requestId) => repository.savePrice({ ...input, requestId }))} saveEntitlements={(input) => void run((repository, requestId) => repository.saveEntitlements({ ...input, requestId }))} saveSettings={(input) => void run((repository, requestId) => repository.saveSettings({ ...input, requestId }))} />;
}

export function AdminMembershipCommerceSummary({ store, error = "", message = "", pending = false, uncertain = false, refresh, retry, savePrice, saveEntitlements, saveSettings }: { store: MembershipCommerceAdminStore | null; error?: string; message?: string; pending?: boolean; uncertain?: boolean; refresh: () => void; retry: () => void; savePrice: (input: PriceInput) => void; saveEntitlements: (input: EntitlementsInput) => void; saveSettings: (input: SettingsInput) => void }) {
  const disabled = pending || uncertain;
  return <section aria-labelledby="commerce-admin-title" className="grid gap-6"><div className="flex flex-wrap items-center justify-between gap-3"><h2 id="commerce-admin-title" className="text-xl font-semibold">会员价格、权益与付款配置</h2><Button type="button" variant="secondary" className="min-h-11" disabled={pending} onClick={refresh}>{pending ? "正在核对…" : "重新核对付款配置"}</Button></div>{error ? <FieldMessage role="alert">{error}</FieldMessage> : null}{message ? <p role="status" className="text-sm leading-6 text-muted-foreground">{message}</p> : null}{uncertain ? <Button type="button" variant="secondary" className="min-h-11 w-fit" disabled={pending} onClick={retry}>核对并重试原配置请求</Button> : null}{!store ? <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">购买配置尚不可用。未知设置不会显示为已开放付款。</p> : <><MembershipCommerceSettingsForm key={`settings:${store.settings.revision}`} settings={store.settings} pending={disabled} save={saveSettings} />{store.plans.map((plan) => <section key={plan.key} className="grid gap-4" aria-label={`${plan.title}购买配置`}><h3 className="text-lg font-semibold">{plan.title}{!plan.enabled ? "（未启用，请在手工方案配置中启用）" : ""}</h3><div className="grid gap-4 lg:grid-cols-3"><MembershipEntitlementsForm key={`entitlements:${plan.key}:${plan.revision}`} plan={plan} pending={disabled} save={saveEntitlements} />{plan.prices.map((price) => <MembershipPriceForm key={`${price.id}:${price.revision}`} price={price} pending={disabled} save={savePrice} />)}</div></section>)}<section className="grid gap-3" aria-labelledby="commerce-admin-history"><h3 id="commerce-admin-history" className="text-lg font-semibold">购买配置审计</h3>{store.history.length ? <ol className="divide-y rounded-xl border bg-surface">{store.history.map((item) => <li key={item.id} className="grid gap-1 p-4 text-sm"><strong>{{ price_updated: "价格调整", entitlements_updated: "数值权益调整", settings_updated: "付款设置调整" }[item.action]}</strong><span>{item.reason}</span><time className="text-muted-foreground" dateTime={item.created_at}>{membershipDate(item.created_at)}</time></li>)}</ol> : <p className="text-sm text-muted-foreground">暂无购买配置变更记录。</p>}</section></>}</section>;
}
