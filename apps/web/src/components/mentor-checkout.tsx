"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { CheckCircle, Copy, LockKey, WarningCircle } from "@phosphor-icons/react";
import { formatMentorPrice, type MentorOffer, type MentorPaymentMethod } from "@wavekb/domain";
import { Button, Field, FieldMessage, Input, Label } from "@wavekb/ui";
import { createClient } from "@/lib/supabase/client";
import { submitManualMentorPayment } from "@/lib/mentor/client-repository";

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/authentication|jwt|auth/i.test(message)) return "登录状态已失效，请重新登录后再提交。";
  if (/offer_unavailable|mentor_unavailable/i.test(message)) return "这项辅导方案目前不可购买，请返回导师页刷新。";
  if (/payment_method_unavailable/i.test(message)) return "该收款方式已经停用，请刷新后选择其他方式。";
  if (/network|fetch/i.test(message)) return "付款声明没有提交，请检查网络后重试。";
  return message || "付款声明没有提交，请稍后重试。";
}

export function MentorCheckout({ actorId, mentorName, offers, paymentMethods, returnPath }: { actorId: string | null; mentorName: string; offers: MentorOffer[]; paymentMethods: MentorPaymentMethod[]; returnPath: string }) {
  const activeOffers = useMemo(() => offers.filter((offer) => offer.active !== false), [offers]);
  const [offerId, setOfferId] = useState(activeOffers[0]?.id || "");
  const [methodId, setMethodId] = useState(paymentMethods[0]?.id || "");
  const [buyerNote, setBuyerNote] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "submitted">("idle");
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const selectedMethod = paymentMethods.find((method) => method.id === methodId) ?? null;

  async function copyAccount() {
    if (!selectedMethod) return;
    try {
      await navigator.clipboard.writeText(selectedMethod.account_value);
      setCopyStatus("收款信息已复制。");
    } catch {
      setCopyStatus("浏览器未允许复制，请手动选择账号。");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!actorId || !offerId || !methodId) return;
    setStatus("submitting");
    setError("");
    try {
      const client = createClient();
      const auth = await client.auth.getUser();
      if (!auth.data.user || auth.data.user.id !== actorId) throw new Error("authentication_required");
      await submitManualMentorPayment(client, { offerId, paymentMethodId: methodId, buyerNote });
      setStatus("submitted");
    } catch (submitError) {
      setError(friendlyError(submitError));
      setStatus("idle");
    }
  }

  if (!activeOffers.length) return <section className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">这位导师暂未开放可购买方案。</section>;
  if (!actorId) return <section className="grid gap-4 rounded-xl border bg-surface p-5"><div><h2 className="text-xl font-semibold">登录后查看付款信息</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">登录用于把订单、付款声明和后续辅导权益绑定到同一账户。</p></div><Button asChild className="w-fit"><Link href={`/login?next=${encodeURIComponent(returnPath)}`}>登录账户</Link></Button></section>;
  if (!paymentMethods.length) return <section className="rounded-xl border border-dashed p-6"><h2 className="font-semibold">尚未配置收款方式</h2><p className="mt-1 text-sm text-muted-foreground">导师需要先添加有效收款信息，当前不会创建订单。</p></section>;
  if (status === "submitted") return <section className="grid gap-4 rounded-xl border border-primary/30 bg-primary/8 p-6"><CheckCircle aria-hidden size={30} weight="duotone" className="text-primary" /><div><h2 className="text-xl font-semibold">已通知导师核对付款</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">导师确认收款后，服务器会自动发放权益并创建专属会话。确认前请勿重复提交。</p></div><Button asChild variant="secondary" className="w-fit"><Link href="/tutoring">查看我的辅导</Link></Button></section>;

  return (
    <form className="grid gap-6 rounded-xl border bg-surface p-5 md:p-6" onSubmit={submit}>
      <header className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><LockKey aria-hidden size={20} weight="duotone" /></span><div><h2 className="text-xl font-semibold">选择辅导方案</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">付款由你直接转给{mentorName}。平台只记录声明，导师确认后才发放权益。</p></div></header>
      <fieldset className="grid gap-3"><legend className="text-sm font-semibold">服务方案</legend>{activeOffers.map((offer) => <label key={offer.id} className={`grid cursor-pointer gap-2 rounded-xl border p-4 ${offerId === offer.id ? "border-primary ring-2 ring-primary/15" : "hover:border-primary/45"}`}><span className="flex items-start gap-3"><input type="radio" name="mentor-offer" value={offer.id} checked={offerId === offer.id} onChange={() => setOfferId(offer.id)} className="mt-1 accent-primary" /><span className="min-w-0 flex-1"><strong className="block">{offer.name}</strong><span className="mt-1 block text-sm leading-6 text-muted-foreground">{offer.description || `有效期 ${offer.duration_days} 天，每周可提问 ${offer.weekly_questions} 次。`}</span></span><strong className="shrink-0 tabular-nums">{formatMentorPrice(offer.price_cents, offer.currency)}</strong></span><span className="ml-7 text-xs text-muted-foreground">有效期 {offer.duration_days} 天，每周 {offer.weekly_questions} 次</span></label>)}</fieldset>
      <fieldset className="grid gap-3"><legend className="text-sm font-semibold">导师收款方式</legend>{paymentMethods.map((method) => <label key={method.id} className={`grid cursor-pointer gap-2 rounded-xl border p-4 ${methodId === method.id ? "border-primary ring-2 ring-primary/15" : "hover:border-primary/45"}`}><span className="flex items-center gap-3"><input type="radio" name="mentor-payment-method" value={method.id} checked={methodId === method.id} onChange={() => { setMethodId(method.id); setCopyStatus(""); }} className="accent-primary" /><strong>{method.label}</strong>{method.network ? <span className="text-xs text-muted-foreground">{method.network}</span> : null}</span>{methodId === method.id ? <span className="ml-6 grid gap-2"><span className="break-all rounded-lg bg-muted p-3 font-mono text-sm">{method.account_value}</span>{method.account_name ? <span className="text-xs text-muted-foreground">收款人：{method.account_name}</span> : null}{method.instructions ? <span className="text-xs leading-5 text-muted-foreground">{method.instructions}</span> : null}<Button type="button" variant="secondary" size="small" className="w-fit" onClick={copyAccount}><Copy aria-hidden size={16} />复制收款信息</Button>{copyStatus ? <span role="status" className="text-xs text-muted-foreground">{copyStatus}</span> : null}</span> : null}</label>)}</fieldset>
      <Field><Label htmlFor="mentor-payment-note">付款备注或转账编号（可选）</Label><Input id="mentor-payment-note" value={buyerNote} onChange={(event) => setBuyerNote(event.target.value)} maxLength={1000} placeholder="填写便于导师核对的转账信息" /></Field>
      <div className="flex items-start gap-2 rounded-lg bg-muted p-3 text-xs leading-5 text-muted-foreground"><WarningCircle aria-hidden size={17} className="mt-0.5 shrink-0 text-primary" /><span>请先完成转账，再点击“我已付款”。点击后只会提交待核对声明，不代表平台已经确认到账。</span></div>
      {error ? <FieldMessage role="alert" className="rounded-lg border border-destructive/35 bg-destructive/10 p-3">{error}</FieldMessage> : null}
      <Button type="submit" size="large" disabled={status === "submitting" || !offerId || !methodId}>{status === "submitting" ? "正在提交付款声明" : "我已付款，通知导师"}</Button>
    </form>
  );
}
