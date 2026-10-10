"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Field, FieldMessage, Input, Label } from "@wavekb/ui";
import { createClient } from "@/lib/supabase/client";
import { membershipWalletRepository } from "@/lib/membership/wallet-client-repository";
import { membershipWalletError, walletAddressValid, walletNetworkLabel, walletReasonLabel, walletRouteLabel, type WalletAdminStore, type WalletOrder, type WalletRoute, type WalletSettings } from "@/lib/membership/wallet-types";
import { membershipDate } from "@/components/membership-center";

type Repository = ReturnType<typeof membershipWalletRepository>;
type RouteInput = Omit<Parameters<Repository["saveRoute"]>[0], "requestId">;
type SettingsInput = Omit<Parameters<Repository["saveSettings"]>[0], "requestId">;
type RevokeInput = Omit<Parameters<Repository["revokeOrder"]>[0], "requestId">;
function reason(data: FormData) { const text = String(data.get("reason") ?? "").trim(); if (Array.from(text).length < 3 || Array.from(text).length > 500) throw new Error("变更原因须为 3—500 个有效字符。"); return text; }

export function MembershipWalletRouteForm({ route, pending, save }: { route: WalletRoute; pending: boolean; save: (input: RouteInput) => void }) {
  const [error, setError] = useState(""); const id = `wallet-admin-${route.id}`;
  return <form className="grid min-w-0 gap-4 rounded-xl border bg-surface p-5" onSubmit={(event) => {
    event.preventDefault(); setError(""); const data = new FormData(event.currentTarget);
    try {
      const raw = String(data.get("recipient") ?? "").trim(); const recipient = raw ? route.chain === "tron" ? raw : raw.toLowerCase() : null; const enabled = data.get("enabled") === "on";
      if (recipient && (!walletAddressValid(route.chain, recipient) || recipient === route.contract)) throw new Error("请输入该网络的完整公开收款地址，不能使用代币合约地址。服务端还会核对地址格式。");
      if (enabled && !recipient) throw new Error("缺少收款地址时不能开放此网络。");
      save({ routeId: route.id, recipient, enabled, revision: route.revision, reason: reason(data) });
    } catch (failure) { const text = failure instanceof Error ? failure.message : "请核对收款设置。"; setError(text); event.currentTarget.querySelector<HTMLInputElement>(`input[name="${text.includes("原因") ? "reason" : "recipient"}"]`)?.focus(); }
  }}><h3 className="text-lg font-semibold">{walletRouteLabel(route)}</h3><p className="text-xs leading-5 text-muted-foreground">官方币种合约固定，不支持更改或添加同名假币。修改公开地址只影响新订单，已有订单仍使用其冻结的收款地址与金额。</p><p className="break-all rounded-lg bg-muted/40 p-3 font-mono text-xs leading-5">官方合约：{route.contract}</p>
    <Field><Label htmlFor={`${id}-recipient`}>公开收款地址</Label><Input id={`${id}-recipient`} name="recipient" defaultValue={route.recipient ?? ""} className="min-h-11 font-mono" maxLength={42} autoComplete="off" spellCheck={false} disabled={pending} onChange={() => setError("")} aria-invalid={Boolean(error) && !error.includes("原因")} aria-describedby={`${id}-hint`} /><p id={`${id}-hint`} className="text-xs leading-5 text-muted-foreground">只填写运营控制的公开收款地址，绝不可填写私钥或助记词。未提供地址保持关闭。</p></Field>
    <label className="flex min-h-11 items-start gap-3 text-sm leading-6"><input type="checkbox" name="enabled" defaultChecked={route.enabled} disabled={pending} className="mt-1 size-4" />开放此网络与币种（仍受钱包总开关和服务端开关限制）</label>
    <Field><Label htmlFor={`${id}-reason`}>变更原因</Label><Input id={`${id}-reason`} name="reason" required minLength={3} maxLength={500} className="min-h-11" disabled={pending} aria-invalid={error.includes("原因")} onChange={() => setError("")} /></Field>{error ? <FieldMessage role="alert">{error}</FieldMessage> : null}<Button type="submit" className="min-h-11 w-fit" disabled={pending}>保存 {route.id} 收款配置</Button>
  </form>;
}
export function MembershipWalletSettingsForm({ settings, configured, pending, save }: { settings: WalletSettings; configured: boolean; pending: boolean; save: (input: SettingsInput) => void }) {
  const [error, setError] = useState("");
  return <form className="grid gap-4 rounded-xl border bg-surface p-5" onSubmit={(event) => { event.preventDefault(); setError(""); const data = new FormData(event.currentTarget); try { const enabled = data.get("enabled") === "on"; if (enabled && !configured) throw new Error("至少配置并开放一个收款网络后才能开启钱包付款。"); save({ enabled, revision: settings.revision, reason: reason(data) }); } catch (failure) { setError(failure instanceof Error ? failure.message : "请核对原因。"); event.currentTarget.querySelector<HTMLInputElement>('input[name="reason"]')?.focus(); } }}>
    <h3 className="text-lg font-semibold">钱包付款总开关</h3><p className="text-sm leading-6 text-muted-foreground">默认关闭。准备公开收款地址、链上核验服务与服务端开关后，再手动开放新订单。关闭新购买不取消已有转账的核验。这里不会保存私钥、修改历史订单或自动启用收费。</p>
    {!configured ? <p role="status" className="text-sm text-muted-foreground">收款地址尚未配置，无法开放钱包付款。</p> : null}<label className="flex min-h-11 items-start gap-3 text-sm leading-6"><input type="checkbox" name="enabled" defaultChecked={settings.enabled} disabled={pending || !configured} className="mt-1 size-4" />允许创建新的钱包付款订单</label>
    <Field><Label htmlFor="wallet-settings-reason">变更原因</Label><Input id="wallet-settings-reason" name="reason" required minLength={3} maxLength={500} className="min-h-11" disabled={pending} aria-invalid={Boolean(error)} onChange={() => setError("")} /></Field>{error ? <FieldMessage role="alert">{error}</FieldMessage> : null}<Button type="submit" className="min-h-11 w-fit" disabled={pending}>保存钱包付款开关</Button>
  </form>;
}

export function MembershipWalletRevokeForm({ order, pending, revoke }: { order: WalletOrder; pending: boolean; revoke: (input: RevokeInput) => void }) {
  const [error, setError] = useState(""); const [confirmed, setConfirmed] = useState(false); const id = `wallet-revoke-${order.id}`;
  if (order.status !== "paid") return null;
  return <form className="grid gap-3 rounded-lg border border-destructive/30 p-4" onSubmit={(event) => { event.preventDefault(); setError(""); try { if (!confirmed) throw new Error("请明确确认只撤销此单 VIP 权益，不会退款。"); revoke({ orderId: order.id, reason: reason(new FormData(event.currentTarget)) }); } catch (failure) { setError(failure instanceof Error ? failure.message : "请核对撤销原因。"); event.currentTarget.querySelector<HTMLInputElement>('input[name="reason"]')?.focus(); } }}>
    <p className="text-sm leading-6">仅撤销这笔已付款订单的 VIP 授权，不修改其他订单或手工授权；不会执行链上退款、自动划转或扣款。资金人工处理独立进行。</p>
    <Field><Label htmlFor={`${id}-reason`}>撤销原因</Label><Input id={`${id}-reason`} name="reason" required minLength={3} maxLength={500} className="min-h-11" disabled={pending} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} onChange={() => setError("")} /></Field>
    <label className="flex min-h-11 items-start gap-3 text-sm leading-6"><input type="checkbox" className="mt-1 size-4 shrink-0" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={pending} required />确认只撤销此订单 VIP 权益，系统不会退款</label>
    {error ? <FieldMessage id={`${id}-error`} role="alert">{error}</FieldMessage> : null}<Button type="submit" variant="danger" className="min-h-11 w-fit" disabled={pending || !confirmed}>撤销此单 VIP 权益</Button>
  </form>;
}

export function AdminMembershipWallet({ actorId, initial, initialError = "" }: { actorId: string; initial: WalletAdminStore | null; initialError?: string }) {
  const [store, setStore] = useState(initial); const [error, setError] = useState(initialError); const [message, setMessage] = useState(""); const [pending, setPending] = useState(false); const [uncertain, setUncertain] = useState(false); const [identityChanged, setIdentityChanged] = useState(false);
  const revision = useRef(0); const lock = useRef(false); const original = useRef<{ requestId: string; task: (repository: Repository, requestId: string) => Promise<unknown> } | null>(null);
  useEffect(() => { let active = true; const invalidate = () => { ++revision.current; }; const { data } = createClient().auth.onAuthStateChange((_event, session) => { if (active && session?.user.id !== actorId) { ++revision.current; lock.current = false; original.current = null; setStore(null); setPending(false); setIdentityChanged(true); } }); return () => { active = false; invalidate(); data.subscription.unsubscribe(); }; }, [actorId]);
  async function read(current: number, repository: Repository) { const value = await repository.adminStore(); if (current !== revision.current) throw new Error("authentication_required"); setStore(value); return value; }
  async function run(task?: (repository: Repository, requestId: string) => Promise<unknown>, retry = false) {
    if (lock.current || identityChanged || uncertain && !retry && task) return; lock.current = true; setPending(true); setError(""); setMessage(""); const current = revision.current; const repository = membershipWalletRepository(createClient(), actorId);
    try {
      if (task && !original.current) original.current = { requestId: crypto.randomUUID(), task };
      if (retry) await read(current, repository);
      if (task || retry) { const request = original.current; if (!request) return; await request.task(repository, request.requestId); if (current !== revision.current) return; await read(current, repository); original.current = null; setUncertain(false); setMessage("钱包配置回执已核对，已有订单收款快照保持不变。"); }
      else { await read(current, repository); setMessage(original.current ? "已读取当前配置，仍须核对原保存请求，不能重复编辑提交。" : "已核对当前钱包配置。"); }
    } catch (failure) {
      if (current !== revision.current) return; const code = failure instanceof Error ? failure.message : failure && typeof failure === "object" && "message" in failure ? String(failure.message) : "";
      if (/authentication_required|admin_required|account_ineligible/.test(code)) { ++revision.current; original.current = null; lock.current = false; setStore(null); setPending(false); setIdentityChanged(true); }
      else if (/input_invalid|changed_concurrently|address_invalid|route_not_found|order_not_found|wallet_order_not_paid|request_conflict/.test(code)) { original.current = null; setUncertain(false); setError(membershipWalletError(failure)); try { await read(current, repository); } catch { if (current === revision.current) setStore(null); } }
      else { setStore(null); setError(membershipWalletError(failure)); setUncertain(Boolean(original.current)); if (original.current) setMessage("保存结果尚未确认，原请求已保留。先核对当前配置，再使用原请求重试。"); }
    } finally { if (current === revision.current) { lock.current = false; setPending(false); } }
  }
  if (identityChanged) return <section className="grid gap-3 rounded-xl border bg-surface p-5"><p role="alert">账号或管理员权限已变化，旧钱包配置已清除。</p><a href="/admin/memberships" className="inline-flex min-h-11 w-fit items-center rounded-lg border px-4 text-primary">重新核对当前账号</a></section>;
  return <AdminMembershipWalletSummary store={store} pending={pending} uncertain={uncertain} error={error} message={message} refresh={() => void run()} retry={() => void run(undefined, true)} saveRoute={(input) => void run((repository, requestId) => repository.saveRoute({ ...input, requestId }))} saveSettings={(input) => void run((repository, requestId) => repository.saveSettings({ ...input, requestId }))} revokeOrder={(input) => void run((repository, requestId) => repository.revokeOrder({ ...input, requestId }))} />;
}
export function AdminMembershipWalletSummary({ store, preview = false, pending = false, uncertain = false, error = "", message = "", refresh, retry, saveRoute, saveSettings, revokeOrder = () => {} }: { store: WalletAdminStore | null; preview?: boolean; pending?: boolean; uncertain?: boolean; error?: string; message?: string; refresh: () => void; retry: () => void; saveRoute: (input: RouteInput) => void; saveSettings: (input: SettingsInput) => void; revokeOrder?: (input: RevokeInput) => void }) {
  const blocked = pending || uncertain;
  return <section aria-labelledby="wallet-admin-title" className="grid gap-6"><div className="flex flex-wrap items-center justify-between gap-3"><h2 id="wallet-admin-title" className="text-xl font-semibold">会员钱包收款配置</h2><Button type="button" className="min-h-11" variant="secondary" disabled={pending} onClick={refresh}>核对钱包收款配置</Button></div>{error ? <FieldMessage role="alert">{error}</FieldMessage> : null}{message ? <p role="status" className="text-sm leading-6 text-muted-foreground">{message}</p> : null}{uncertain ? <Button type="button" className="min-h-11 w-fit" variant="secondary" disabled={pending} onClick={retry}>核对并重试原钱包配置</Button> : null}{!store ? <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">尚未核实钱包配置，不会把未知状态显示为可收款。</p> : <>
    <MembershipWalletSettingsForm key={`wallet-settings:${store.settings.revision}`} settings={store.settings} configured={store.routes.some((route) => route.enabled && route.recipient !== null)} pending={blocked} save={saveSettings} />
    <div className="grid gap-4 lg:grid-cols-2">{store.routes.map((route) => <MembershipWalletRouteForm key={`${route.id}:${route.revision}`} route={route} pending={blocked} save={saveRoute} />)}</div>
    <section aria-labelledby="wallet-admin-orders" className="grid min-w-0 gap-4"><h3 id="wallet-admin-orders" className="text-lg font-semibold">最近钱包订单与对账（最多 50 单）</h3><p className="text-sm leading-6 text-muted-foreground">核验和链上回执只读展示。不允许管理员手工标记付款或伪造到账。撤销权益不代表资金退款。</p>
      {store.orders.length ? store.orders.map((order) => <article key={order.id} className="grid min-w-0 gap-3 rounded-xl border bg-surface p-5"><div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">{order.title_snapshot} · {{ pending: "等待付款", expired: "报价过期", paid: "付款已确认", review: "需人工核对", revoked: "权益已撤销" }[order.status]}</h4><span className="font-mono tabular-nums">{order.amount_decimal} {order.asset}</span></div><dl className="grid gap-2 text-xs leading-6"><div><dt className="text-muted-foreground">订单 / 会员账号</dt><dd className="break-all font-mono">{order.id} / {order.buyer_id}</dd></div><div><dt className="text-muted-foreground">网络 / 冻结收款地址</dt><dd className="break-all font-mono">{walletNetworkLabel(order.chain)} / {preview ? "虚拟测试地址 · 不可转账" : order.recipient}</dd></div></dl>
        <div className="grid gap-2 text-sm"><h5 className="font-medium">已提交哈希与核验状态</h5>{store.verifications.filter((proof) => proof.order_id === order.id).length ? store.verifications.filter((proof) => proof.order_id === order.id).map((proof) => <div key={proof.id} className="grid min-w-0 gap-1 rounded-lg bg-muted/40 p-3"><code className="break-all text-xs">{proof.tx_hash}</code><p>{{ queued: "核验排队", leased: "正在核验", waiting: "等待确认", settled: "核验完成", review: "需人工核对" }[proof.status]} · {walletReasonLabel(proof.reason_code)}</p></div>) : <p className="text-xs text-muted-foreground">尚无哈希核验记录。</p>}</div>
        <div className="grid gap-2 text-sm"><h5 className="font-medium">链上事件回执</h5>{store.receipts.filter((receipt) => receipt.order_id === order.id).length ? store.receipts.filter((receipt) => receipt.order_id === order.id).map((receipt) => <div key={receipt.id} className="grid min-w-0 gap-1 rounded-lg bg-muted/40 p-3"><code className="break-all text-xs">{receipt.tx_hash} · 事件 {receipt.event_index}</code><p>{{ paid: "已授予一次权益", review: "待人工对账", ignored_order_state: "未重复授予权益" }[receipt.outcome]} · {walletReasonLabel(receipt.reason_code)}</p><time className="text-xs text-muted-foreground" dateTime={receipt.created_at}>{membershipDate(receipt.created_at)}</time></div>) : <p className="text-xs text-muted-foreground">尚无链上事件回执，不视为付款成功。</p>}</div>
        <MembershipWalletRevokeForm key={`${order.id}:${order.status}`} order={order} pending={blocked} revoke={revokeOrder} />
      </article>) : <p className="text-sm text-muted-foreground">暂无钱包订单或链上对账记录。</p>}
    </section>
    <section className="grid gap-3" aria-labelledby="wallet-admin-history"><h3 id="wallet-admin-history" className="text-lg font-semibold">收款配置审计记录</h3>{store.history.length ? <ol className="divide-y rounded-xl border bg-surface">{store.history.map((entry) => <li key={entry.id} className="grid gap-1 p-4 text-sm"><span>{entry.action === "route_updated" ? "更新收款网络" : entry.action === "wallet_order_revoked" ? "撤销订单 VIP 权益（未退款）" : "更新钱包付款开关"} · {entry.reason}</span><time className="text-muted-foreground" dateTime={entry.created_at}>{membershipDate(entry.created_at)}</time></li>)}</ol> : <p className="text-sm text-muted-foreground">暂无钱包收款配置变更。</p>}</section>
  </>}</section>;
}
