"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { CheckCircle, Copy, LockKey, WarningCircle } from "@phosphor-icons/react";
import { formatMentorPrice, type MentorOffer, type MentorPaymentMethod } from "@wavekb/domain";
import { Button, Field, FieldMessage, Input, Label } from "@wavekb/ui";
import { createClient } from "@/lib/supabase/client";
import { submitManualMentorPayment } from "@/lib/mentor/client-repository";
import { MentorClaimList, useBuyerMentorClaims } from "@/components/mentor-payment-status";

function paymentConfigurationIssue(method: MentorPaymentMethod | null) {
  if (!method || method.active === false || !method.account_value.trim()) return true;
  // An explicit platform UID is not a chain destination. Retain legacy network
  // text for transparency, but never use or copy it as the payment route.
  if (method.kind === "binance") return !/^\d+$/.test(method.account_value.trim());
  // An identifier/address in the network field creates two possible destinations.
  // Flag the original configuration; never move or infer a destination from it.
  if (/[A-Za-z0-9]{24,}/.test(method.network)) return true;
  if (method.kind !== "crypto") return false;
  return !method.network.trim() || /^(USDT|USDC|BTC|ETH)$/i.test(method.network.trim()) || /^\d+$/.test(method.account_value.trim());
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/authentication|jwt|auth/i.test(message)) return "登录状态已失效，请重新登录后再提交。";
  if (/offer_unavailable|mentor_unavailable/i.test(message)) return "这项辅导方案目前不可购买，请返回导师页刷新。";
  if (/payment_method_unavailable/i.test(message)) return "该收款方式已经停用，请刷新后选择其他方式。";
  if (/network|fetch/i.test(message)) return "网络中断，暂时无法确认付款声明结果。";
  return message || "付款声明没有提交，请稍后重试。";
}

type CheckoutProps = { actorId: string | null; mentorName: string; offers: MentorOffer[]; paymentMethods: MentorPaymentMethod[]; returnPath: string };
type PaymentAttempt = { ownerId: string; mentorId: string; startedAt: string; orderId?: string };

export function MentorCheckout(props: CheckoutProps) {
  return <MentorCheckoutForm key={`${props.actorId}:${props.returnPath}`} {...props} />;
}

function MentorCheckoutForm({ actorId, mentorName, offers, paymentMethods, returnPath }: CheckoutProps) {
  const activeOffers = useMemo(() => offers.filter((offer) => offer.active !== false), [offers]);
  const [offerId, setOfferId] = useState(activeOffers[0]?.id || "");
  const [methodId, setMethodId] = useState(paymentMethods.find((method) => method.active !== false)?.id || "");
  const [buyerNote, setBuyerNote] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "submitted">("idle");
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const selectedMethod = paymentMethods.find((method) => method.id === methodId) ?? null;
  const mentorId = returnPath.split("/").filter(Boolean).at(-1) || "";
  const claims = useBuyerMentorClaims(actorId, mentorId);
  const attemptKey = `wavekb:mentor-payment-attempt:${actorId}:${mentorId}`;
  const [attempt, setAttempt] = useState<PaymentAttempt | null>(null);
  const [localChecked, setLocalChecked] = useState(false);
  const submissionLock = useRef(false);
  const [uncertain, setUncertain] = useState(false);
  const configurationIssue = paymentConfigurationIssue(selectedMethod);
  const pendingClaims = claims.claims.filter((claim) => claim.status === "submitted");

  useEffect(() => {
    const restoreCheckpoint = () => {
      try {
        const stored = localStorage.getItem(attemptKey);
        if (stored) {
          const value = JSON.parse(stored) as PaymentAttempt;
          if (value.ownerId !== actorId || value.mentorId !== mentorId || typeof value.startedAt !== "string" || (value.orderId !== undefined && typeof value.orderId !== "string")) throw new Error("invalid payment checkpoint");
          setAttempt(value);
          setUncertain(true);
          setError("已恢复上次待核实的付款提交；请先查询状态，不要重复转账或提交。");
        }
      } catch {
        setUncertain(true);
        setError("无法读取付款核对标记，请联系导师核实上次提交，勿重复付款。");
      }
      setLocalChecked(true);
    };
    const timer = window.setTimeout(restoreCheckpoint, 0);
    const onStorage = (event: StorageEvent) => { if (event.key === attemptKey && event.newValue) restoreCheckpoint(); };
    window.addEventListener("storage", onStorage);
    return () => { window.clearTimeout(timer); window.removeEventListener("storage", onStorage); };
  }, [actorId, mentorId, attemptKey]);

  useEffect(() => {
    if (!attempt?.orderId || claims.loading || claims.error || !claims.claims.some((claim) => claim.order_id === attempt.orderId)) return;
    const timer = window.setTimeout(() => {
      try {
        localStorage.removeItem(attemptKey);
        setAttempt(null);
        setUncertain(false);
      } catch { /* Keep the checkpoint if local cleanup cannot be confirmed. */ }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [attempt, attemptKey, claims.loading, claims.error, claims.claims]);

  async function copyAccount() {
    if (!selectedMethod || configurationIssue) return;
    try {
      await navigator.clipboard.writeText(selectedMethod.account_value);
      setCopyStatus("收款信息已复制。");
    } catch {
      setCopyStatus("浏览器未允许复制，请手动选择账号。");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!actorId || !mentorId || !offerId || !methodId || submissionLock.current || configurationIssue || !localChecked || claims.loading || claims.error || pendingClaims.length || claims.pendingOrders.length || uncertain || attempt) return;
    submissionLock.current = true;
    setStatus("submitting");
    setError("");
    try {
      const client = createClient();
      const auth = await client.auth.getUser();
      if (!auth.data.user || auth.data.user.id !== actorId) throw new Error("authentication_required");
      if (localStorage.getItem(attemptKey)) throw new Error("已有待核实的付款提交，可能来自另一标签页。请先核对原订单。");
      let checkpoint: PaymentAttempt = { ownerId: actorId, mentorId, startedAt: new Date().toISOString() };
      try { localStorage.setItem(attemptKey, JSON.stringify(checkpoint)); } catch { throw new Error("无法保存付款核对标记，尚未发起订单请求。请修复浏览器存储后再核对。"); }
      setAttempt(checkpoint);
      await submitManualMentorPayment(client, { offerId, paymentMethodId: methodId, buyerNote, onOrderCreated: (orderId) => {
        checkpoint = { ...checkpoint, orderId };
        setAttempt(checkpoint);
        localStorage.setItem(attemptKey, JSON.stringify(checkpoint));
      } });
      setStatus("submitted");
      try { localStorage.removeItem(attemptKey); setAttempt(null); } catch { /* A known claim is still protected by the server read. */ }
      await claims.refresh();
    } catch (submitError) {
      setError(`${friendlyError(submitError)} 若请求已送达，结果可能尚未返回；请先查询状态，不要重复转账或提交。`);
      setUncertain(true);
      setStatus("idle");
      await claims.refresh();
    }
  }

  if (!actorId) return <section className="grid gap-4 rounded-xl border bg-surface p-5"><div><h2 className="text-xl font-semibold">登录后查看付款信息</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">登录用于把订单、付款声明和后续辅导权益绑定到同一账户。</p></div><Button asChild className="w-fit"><Link href={`/login?next=${encodeURIComponent(returnPath)}`}>登录账户</Link></Button></section>;
  if (claims.loading || !localChecked) return <p role="status" className="text-sm text-muted-foreground">正在查询付款声明状态…</p>;
  if (pendingClaims.length || claims.pendingOrders.length || claims.error || uncertain) return <div className="grid gap-4">{uncertain ? <p role="alert" className="text-sm text-destructive">{error} 如果查询后仍没有记录，请联系导师核实这次提交。</p> : null}{attempt?.orderId && !claims.error && !claims.pendingOrders.some((order) => order.id === attempt.orderId) ? <p className="break-all text-sm">待核实订单编号：{attempt.orderId}</p> : null}<MentorClaimList {...claims} /><Button asChild variant="secondary" className="w-fit"><Link href="/tutoring">查看我的辅导</Link></Button></div>;
  if (!activeOffers.length) return <section className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">这位导师暂未开放可购买方案。</section>;
  if (!paymentMethods.length) return <section className="rounded-xl border border-dashed p-6"><h2 className="font-semibold">尚未配置收款方式</h2><p className="mt-1 text-sm text-muted-foreground">导师需要先添加有效收款信息，当前不会创建订单。</p></section>;
  if (status === "submitted") return <section className="grid gap-4 rounded-xl border border-primary/30 bg-primary/8 p-6"><CheckCircle aria-hidden size={30} weight="duotone" className="text-primary" /><div><h2 className="text-xl font-semibold">已通知导师核对付款</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">导师确认收款后，服务器会自动发放权益并创建专属会话。确认前请勿重复提交。</p></div><Button asChild variant="secondary" className="w-fit"><Link href="/tutoring">查看我的辅导</Link></Button></section>;

  return (
    <form className="grid gap-6 rounded-xl border bg-surface p-5 md:p-6" onSubmit={submit}>
      <header className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><LockKey aria-hidden size={20} weight="duotone" /></span><div><h2 className="text-xl font-semibold">选择辅导方案</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">付款由你直接转给{mentorName}。平台只记录声明，导师确认后才发放权益。</p></div></header>
      <fieldset className="grid gap-3"><legend className="text-sm font-semibold">服务方案</legend>{activeOffers.map((offer) => <label key={offer.id} className={`grid cursor-pointer gap-2 rounded-xl border p-4 ${offerId === offer.id ? "border-primary ring-2 ring-primary/15" : "hover:border-primary/45"}`}><span className="flex items-start gap-3"><input type="radio" name="mentor-offer" value={offer.id} checked={offerId === offer.id} onChange={() => setOfferId(offer.id)} className="mt-1 accent-primary" /><span className="min-w-0 flex-1"><strong className="block">{offer.name}</strong><span className="mt-1 block text-sm leading-6 text-muted-foreground">{offer.description || `有效期 ${offer.duration_days} 天，每周可提问 ${offer.weekly_questions} 次。`}</span></span><strong className="shrink-0 tabular-nums">{formatMentorPrice(offer.price_cents, offer.currency)}</strong></span><span className="ml-7 text-xs text-muted-foreground">有效期 {offer.duration_days} 天，每周 {offer.weekly_questions} 次</span></label>)}</fieldset>
      <fieldset className="grid gap-3"><legend className="text-sm font-semibold">导师收款方式</legend>{paymentMethods.filter((method) => method.active !== false).map((method) => <label key={method.id} className={`grid cursor-pointer gap-2 rounded-xl border p-4 ${methodId === method.id ? "border-primary ring-2 ring-primary/15" : "hover:border-primary/45"}`}><span className="flex items-center gap-3"><input type="radio" name="mentor-payment-method" value={method.id} checked={methodId === method.id} onChange={() => { setMethodId(method.id); setCopyStatus(""); }} className="accent-primary" /><strong>{method.label}</strong></span>{methodId === method.id ? <span className="ml-6 grid gap-2"><span className="text-xs text-muted-foreground">{method.kind === "crypto" ? "链上收款地址" : method.kind === "binance" ? "币安 UID" : "收款账号"}</span><span className="break-all rounded-lg bg-muted p-3 font-mono text-sm">{method.account_value}</span><span className="text-xs text-muted-foreground">网络字段（导师原始配置）：{method.network || "未填写"}</span>{method.kind === "binance" ? <span className="text-xs text-muted-foreground">此数字是币安 UID，不是 PayID 或链上地址。请在币安平台内核对收款人及转账方式；网络字段仅展示原始配置，不作为支付路由。</span> : null}{method.account_name ? <span className="text-xs text-muted-foreground">收款人：{method.account_name}</span> : null}{method.instructions ? <span className="text-xs leading-5 text-muted-foreground">{method.instructions}</span> : null}{configurationIssue ? <span role="alert" className="text-sm text-destructive">收款配置需要导师核实：地址或网络不明确。请勿转账，平台不会猜测或修正收款信息。</span> : <Button type="button" variant="secondary" size="small" className="w-fit" onClick={copyAccount}><Copy aria-hidden size={16} />复制收款信息</Button>}{copyStatus ? <span role="status" className="text-xs text-muted-foreground">{copyStatus}</span> : null}</span> : null}</label>)}</fieldset>
      <Field><Label htmlFor="mentor-payment-note">付款备注或转账编号（可选）</Label><Input id="mentor-payment-note" value={buyerNote} onChange={(event) => setBuyerNote(event.target.value)} maxLength={1000} placeholder="填写便于导师核对的转账信息" /></Field>
      <div className="flex items-start gap-2 rounded-lg bg-muted p-3 text-xs leading-5 text-muted-foreground"><WarningCircle aria-hidden size={17} className="mt-0.5 shrink-0 text-primary" /><span>请先完成转账，再点击“我已付款”。点击后只会提交待核对声明，不代表平台已经确认到账。</span></div>
      {error ? <FieldMessage role="alert" className="rounded-lg border border-destructive/35 bg-destructive/10 p-3">{error}</FieldMessage> : null}
      <Button type="submit" size="large" disabled={status === "submitting" || !offerId || !methodId || configurationIssue}>{status === "submitting" ? "正在提交付款声明" : "我已付款，通知导师"}</Button>
    </form>
  );
}
