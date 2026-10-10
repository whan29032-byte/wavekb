"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button, FieldMessage } from "@wavekb/ui";
import { createClient } from "@/lib/supabase/client";
import { membershipCommerceRepository } from "@/lib/membership/commerce-client-repository";
import { membershipCommerceError, membershipQuote, type CommercePlan, type MembershipOrder, type MembershipPrice, type MyMembershipCommerce } from "@/lib/membership/commerce-types";
import { clearMembershipAttempt, membershipAttemptKey, membershipCheckoutError, membershipCheckoutFailure, MembershipQuoteRejected, openMembershipCheckout, readMembershipAttempt, safeMembershipCheckoutUrl, writeMembershipAttempt, type MembershipCheckoutAttempt } from "@/lib/membership/checkout-recovery";
import { membershipDate } from "@/components/membership-center";
import { membershipDiscount, membershipMoney } from "@/components/membership-plans-catalog";

const orderLabels = { pending: "待支付 / 待核对", paid: "付款已确认", failed: "支付失败，未授权权益", expired: "订单已过期", refunded: "已退款" };
const grantLabels = { active: "生效中", scheduled: "尚未生效", expired: "已到期", disabled: "方案已停用", revoked: "已撤销", test: "测试记录，不授予正式权益" };
const checkpointError = "无法读取或保存订单核对标记。请先核实已有订单；当前不会发起新的付款请求。";

function orderAttempt(actorId: string, order: MembershipOrder): MembershipCheckoutAttempt {
  return { ownerId: actorId, requestId: order.request_id, expectedQuote: { price_id: order.price_id, plan_key: order.plan_key, price_revision: order.price_revision, plan_revision: order.plan_revision, amount_minor: order.amount_minor, currency: order.currency, term_months: order.term_months } };
}

export function MembershipCommerce({ actorId, initial, initialError = "", readOnly = false }: { actorId: string; initial: MyMembershipCommerce | null; initialError?: string; readOnly?: boolean }) {
  const [mine, setMine] = useState(initial);
  const [error, setError] = useState(initialError);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [attempt, setAttempt] = useState<MembershipCheckoutAttempt | null>(null);
  const [checked, setChecked] = useState(false);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [identityChanged, setIdentityChanged] = useState(false);
  const revision = useRef(0); const lock = useRef(false);

  useEffect(() => {
    let active = true;
    const invalidate = () => { ++revision.current; };
    const restore = () => {
      if (readOnly) { setAttempt(null); setChecked(true); return; }
      try { const value = readMembershipAttempt(actorId); setAttempt(value); setStorageBlocked(false); if (value) setMessage("已恢复原订单请求，请先核对自己的订单，再继续原请求。不要另建订单或重复付款。"); }
      catch { setStorageBlocked(true); setError(checkpointError); }
      setChecked(true);
    };
    restore();
    const { data } = createClient().auth.onAuthStateChange((_event, session) => {
      if (active && session?.user.id !== actorId) { ++revision.current; lock.current = false; setMine(null); setAttempt(null); setPending(false); setIdentityChanged(true); }
    });
    const onStorage = (event: StorageEvent) => {
      if (event.key !== membershipAttemptKey(actorId) && event.key !== null) return;
      ++revision.current; lock.current = false; setPending(false); restore();
      setMessage("其他标签页的订单核对标记已变化，请重新核对订单后继续。");
    };
    window.addEventListener("storage", onStorage);
    return () => { active = false; invalidate(); data.subscription.unsubscribe(); window.removeEventListener("storage", onStorage); };
  }, [actorId, readOnly]);

  async function authenticated(current: number) {
    const auth = await createClient().auth.getUser();
    if (current !== revision.current) throw new Error("authentication_required");
    if (auth.error || auth.data.user?.id !== actorId) { ++revision.current; lock.current = false; setMine(null); setAttempt(null); setPending(false); setIdentityChanged(true); throw new Error("authentication_required"); }
  }

  async function read(current: number) {
    await authenticated(current);
    try { const result = await membershipCommerceRepository(createClient(), actorId).mine(); await authenticated(current); setMine(result); return result; }
    catch (failure) { if (current === revision.current) setMine(null); throw failure; }
  }

  async function refresh() {
    if (lock.current || identityChanged) return;
    lock.current = true; setPending(true); setError(""); const current = revision.current;
    try {
      const value = await read(current);
      if (readOnly) { setStorageBlocked(false); setMessage("已核对既有会员权益与历史订单。"); return; }
      const saved = readMembershipAttempt(actorId);
      if (saved) {
        const order = value.orders.find((item) => item.request_id === saved.requestId);
        if (order && order.status !== "pending") { clearMembershipAttempt(saved); setAttempt(null); setMessage("原订单状态已核实。权益以服务端生效记录为准。"); }
        else { setAttempt(saved); setMessage(order ? "原订单仍待支付或核对，请继续原订单，不要重复付款。" : "暂未读到原请求的订单。仅可使用原请求再次核对，不会另建请求。"); }
      }
      setStorageBlocked(false);
    } catch (failure) { if (current === revision.current) { setError(membershipCommerceError(failure)); if (String(failure).includes("checkpoint")) setStorageBlocked(true); } }
    finally { if (current === revision.current) { lock.current = false; setPending(false); } }
  }

  async function purchase(plan?: CommercePlan, price?: MembershipPrice, existing?: MembershipOrder) {
    if (readOnly || lock.current || identityChanged || !checked || storageBlocked) return;
    lock.current = true; setPending(true); setError(""); setMessage(""); const current = revision.current;
    let checkpoint: MembershipCheckoutAttempt | null = null;
    let preserved = false;
    try {
      // Read authoritative orders before every new request or unknown-result retry.
      const latest = await read(current);
      checkpoint = readMembershipAttempt(actorId);
      preserved = Boolean(checkpoint);
      if (!checkpoint && existing) checkpoint = orderAttempt(actorId, existing);
      if (!checkpoint) {
        if (latest.orders.some((order) => order.status === "pending")) throw new Error("membership_pending_order_exists");
        const freshPlan = latest.catalog.plans.find((item) => item.key === plan?.key);
        const freshPrice = freshPlan?.prices.find((item) => item.id === price?.id);
        if (!latest.catalog.purchase_available || !freshPlan || !freshPrice) throw new Error("membership_billing_unavailable");
        if (!plan || !price || JSON.stringify(membershipQuote(freshPlan, freshPrice)) !== JSON.stringify(membershipQuote(plan, price))) throw new Error("membership_quote_changed");
        checkpoint = { ownerId: actorId, requestId: crypto.randomUUID(), expectedQuote: membershipQuote(freshPlan, freshPrice) };
      }
      const order = latest.orders.find((item) => item.request_id === checkpoint?.requestId);
      if (order && JSON.stringify(orderAttempt(actorId, order)) !== JSON.stringify(checkpoint)) throw new Error("membership_checkpoint_changed");
      if (order && order.status !== "pending") {
        if (readMembershipAttempt(actorId)?.requestId === checkpoint.requestId) clearMembershipAttempt(checkpoint);
        setAttempt(null); setMessage("原订单状态已核实，无需再付款。实际权益请查看生效记录。"); return;
      }
      writeMembershipAttempt(checkpoint); preserved = true; setAttempt(checkpoint);
      await authenticated(current);
      if (order?.checkout_url && order.checkout_expires_at) {
        if (Date.parse(order.checkout_expires_at) <= Date.now()) { setMessage("原支付页面已过期，请等待订单状态更新并重新核对，不要另建订单付款。"); return; }
      }
      if (readMembershipAttempt(actorId)?.requestId !== checkpoint.requestId) throw new Error("membership_checkpoint_changed");
      const result = await createClient().functions.invoke("membership-checkout", { body: { actorId, priceId: checkpoint.expectedQuote.price_id, requestId: checkpoint.requestId, expectedQuote: checkpoint.expectedQuote } });
      await authenticated(current);
      if (result.error) throw await membershipCheckoutFailure(result.error);
      if (!result.data || typeof result.data.orderId !== "string") throw new Error("membership_checkout_response_invalid");
      const checkoutUrl = safeMembershipCheckoutUrl(result.data.checkoutUrl);
      const confirmed = await read(current);
      const receipt = confirmed.orders.find((item) => item.request_id === checkpoint?.requestId);
      if (!receipt || receipt.id !== result.data.orderId || receipt.status !== "pending" || receipt.checkout_url !== checkoutUrl
        || !receipt.checkout_expires_at || Date.parse(receipt.checkout_expires_at) <= Date.now()
        || JSON.stringify(orderAttempt(actorId, receipt)) !== JSON.stringify(checkpoint)) throw new Error("membership_checkout_response_invalid");
      await authenticated(current);
      openMembershipCheckout(checkoutUrl);
    } catch (failure) {
      if (current !== revision.current) return;
      let recovered = false;
      if (checkpoint) {
        try {
          const confirmed = await read(current);
          const order = confirmed.orders.find((item) => item.request_id === checkpoint?.requestId);
          recovered = Boolean(order);
          if (failure instanceof MembershipQuoteRejected && !order && preserved) {
            clearMembershipAttempt(checkpoint); setAttempt(null); setError(membershipCommerceError(failure));
            setMessage("服务器明确拒绝了旧报价，且已核实原请求没有订单。请核对下方新报价，再主动点击购买；不会自动重新购买。"); return;
          }
          if (order && order.status !== "pending" && JSON.stringify(orderAttempt(actorId, order)) === JSON.stringify(checkpoint)) {
            if (preserved) clearMembershipAttempt(checkpoint);
            setAttempt(null); setError(""); setMessage("原订单状态已核对，请以下方服务端记录为准，无需再次付款。实际权益以生效记录为准。"); return;
          }
        } catch { /* An uncertain result keeps the original checkpoint. */ }
      }
      if (current !== revision.current) return;
      if (/checkpoint|storage|SecurityError|QuotaExceededError/i.test(String(failure))) { setStorageBlocked(true); setError(checkpointError); }
      else setError(membershipCheckoutError(failure) || membershipCommerceError(failure));
      if (checkpoint && preserved) setMessage(recovered ? "已读到原订单，请核对下方状态并继续原订单。尚未确认付款成功。" : "结果仍不确定，原请求已保留。请先重新核对订单，再使用原请求继续；不要重新购买或重复付款。");
    } finally { if (current === revision.current) { lock.current = false; setPending(false); } }
  }

  if (identityChanged) return <section className="grid gap-3 rounded-xl border bg-surface p-5"><p role="alert">账号已变化，旧购买与订单信息已清除。请重新核对当前账号。</p><a href="/membership" className="flex min-h-11 w-fit items-center rounded-lg border px-4 py-2 text-sm font-medium text-primary underline underline-offset-4">重新核对当前账号</a></section>;
  return <MembershipCommerceSummary mine={mine} error={error} message={message} pending={pending} purchaseBlocked={!checked || storageBlocked || Boolean(attempt)} recoveryBlocked={!checked || storageBlocked} onRefresh={() => void refresh()} onPurchase={(plan, price) => void purchase(plan, price)} onRecover={() => void purchase()} onContinue={(order) => void purchase(undefined, undefined, order)} hasAttempt={Boolean(attempt)} readOnly={readOnly} />;
}

export function MembershipCommerceSummary({ mine, error = "", message = "", pending = false, purchaseBlocked = false, recoveryBlocked = false, hasAttempt = false, readOnly = false, onRefresh, onPurchase, onRecover, onContinue }: { mine: MyMembershipCommerce | null; error?: string; message?: string; pending?: boolean; purchaseBlocked?: boolean; recoveryBlocked?: boolean; hasAttempt?: boolean; readOnly?: boolean; onRefresh: () => void; onPurchase: (plan: CommercePlan, price: MembershipPrice) => void; onRecover: () => void; onContinue: (order: MembershipOrder) => void }) {
  return <section className="grid gap-6" aria-labelledby="membership-purchases-title">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="membership-purchases-title" className="text-xl font-semibold">{readOnly ? "既有会员权益与历史订单" : "VIP 购买与订单"}</h2><div className="flex flex-wrap gap-2"><Link className="inline-flex min-h-11 items-center rounded-lg border px-3 text-sm font-medium" href="/membership/plans">查看公开会员方案</Link><Button type="button" variant="secondary" className="min-h-11" disabled={pending} onClick={onRefresh}>{pending ? "正在核对…" : "核对购买与订单"}</Button></div></div>
    <p className="text-sm leading-6 text-muted-foreground">月度与年度均为一次性购买，不自动续费。支付回跳不代表开通；只显示服务端确认的订单及权益，测试付款不会授予正式权益。</p>
    <Link href="/knowledge" className="inline-flex min-h-11 w-fit items-center rounded-lg border px-4 text-sm font-medium text-primary">继续阅读公开知识库</Link>
    {error ? <FieldMessage role="alert">{error}</FieldMessage> : null}{message ? <p role="status" className="rounded-lg border bg-muted/40 p-4 text-sm leading-6">{message}</p> : null}
    {hasAttempt && !readOnly ? <Button type="button" variant="secondary" className="min-h-11 w-fit" disabled={pending || recoveryBlocked} onClick={onRecover}>核对并继续原请求</Button> : null}
    {!mine ? <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">购买服务暂不可用，未核实的订单与权益不会显示为已开通。</p> : <>
      <div className="grid gap-2 rounded-xl border bg-surface p-5"><h3 className="font-semibold">当前实际权益</h3><p className="text-sm">{mine.effective.has_vip ? "有效 VIP 会员" : "暂无有效 VIP 权益"}</p><p className="text-sm text-muted-foreground">AI 平台每日额度：{mine.effective.ai_daily_limit} 次 · {membershipDiscount(mine.effective.mentor_discount_bps)}</p><p className="text-xs leading-5 text-muted-foreground">不限制免费自带 Key；平台服务是否可用还须服务端配置。导师优惠以实际结算报价为准。</p></div>
      {readOnly ? null : !mine.catalog.purchase_available ? <p role="status" className="text-sm text-muted-foreground">付款尚未开放，可先查看方案和既有订单。</p> : <div className="grid gap-4 sm:grid-cols-2">{mine.catalog.plans.map((plan) => <article key={plan.key} className="grid gap-3 rounded-xl border bg-surface p-5"><h3 className="font-semibold">{plan.title}</h3><p className="text-sm text-muted-foreground">每日平台额度 {plan.ai_daily_limit} 次 · {membershipDiscount(plan.mentor_discount_bps)}</p>{mine.catalog.payment_mode === "test" ? <p className="text-sm text-muted-foreground">测试模式：不授予正式权益</p> : null}{plan.prices.map((price) => <div key={price.id} className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm">{membershipMoney(price.amount_minor, price.currency)} / {price.term_months === 1 ? "1 个月" : "12 个月"}</p><Button type="button" className="min-h-11" disabled={pending || purchaseBlocked || mine.orders.some((order) => order.status === "pending")} onClick={() => onPurchase(plan, price)}>{mine.catalog.payment_mode === "test" ? "测试购买" : "购买"}{price.term_months === 1 ? "月度" : "年度"}</Button></div>)}</article>)}</div>}
      <div className="grid gap-3"><h3 className="text-lg font-semibold">购买生效记录</h3>{mine.purchase_grants.length ? <ul className="grid gap-3">{mine.purchase_grants.map((grant) => <li key={grant.id} className="grid gap-2 rounded-xl border bg-surface p-4 text-sm"><strong>{grant.title} · {grantLabels[grant.status]}</strong><span>北京时间：{membershipDate(grant.starts_at)} — {membershipDate(grant.ends_at)}</span><span className="text-muted-foreground">购买时权益：平台每日 {grant.ai_daily_limit} 次 · {membershipDiscount(grant.mentor_discount_bps)}</span></li>)}</ul> : <p className="text-sm text-muted-foreground">暂无购买生效记录。管理员手工授权在下方单独展示。</p>}</div>
      <div className="grid gap-3"><h3 className="text-lg font-semibold">我的会员订单</h3>{mine.orders.length ? <ol className="grid gap-3">{mine.orders.map((order) => <li key={order.id} className="grid gap-3 rounded-xl border bg-surface p-4"><div className="flex flex-wrap justify-between gap-2"><strong className="text-sm">{order.title_snapshot} · {orderLabels[order.status]}</strong><span className="text-sm">{membershipMoney(order.amount_minor, order.currency)} / {order.term_months} 个月</span></div><p className="break-all text-xs text-muted-foreground">订单 {order.id} · {order.payment_mode === "test" ? "测试订单，不授予正式权益" : "正式订单"}</p><p className="text-xs text-muted-foreground"><time dateTime={order.created_at}>{membershipDate(order.created_at)}</time> · 购买时平台每日 {order.ai_daily_limit_snapshot} 次 · {membershipDiscount(order.mentor_discount_bps_snapshot)}</p>{order.status === "pending" && !readOnly ? <Button type="button" variant="secondary" className="min-h-11 w-fit" disabled={pending || recoveryBlocked} onClick={() => onContinue(order)}>核对并继续此订单</Button> : null}</li>)}</ol> : <p className="text-sm text-muted-foreground">暂无会员购买订单。</p>}</div>
    </>}
  </section>;
}
