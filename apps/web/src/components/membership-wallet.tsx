"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, FieldMessage, Input, Label } from "@wavekb/ui";
import { createClient } from "@/lib/supabase/client";
import { membershipCommerceRepository } from "@/lib/membership/commerce-client-repository";
import { MembershipWalletCheckoutError, membershipWalletRepository } from "@/lib/membership/wallet-client-repository";
import { clearWalletAttempt, readWalletAttempt, walletAttemptKey, writeWalletAttempt, type WalletAttempt } from "@/lib/membership/wallet-recovery";
import { membershipWalletError, parseWalletQuote, walletAmountDecimal, walletExpectedQuote, walletNetworkLabel, walletRouteLabel, walletTransferHash, type MyMembershipWallet, type WalletOrder, type WalletRouteId, type WalletVerification } from "@/lib/membership/wallet-types";
import type { CommercePlan, MembershipPrice } from "@/lib/membership/commerce-types";
import { membershipDate } from "@/components/membership-center";
import { membershipDiscount } from "@/components/membership-plans-catalog";

function unresolved(mine: MyMembershipWallet, now = Date.now()) {
  return mine.orders.some((order) => ["pending", "review"].includes(order.status) && Date.parse(order.expires_at) > now)
    || mine.verifications.some((proof) => ["queued", "leased", "waiting"].includes(proof.status) && mine.orders.some((order) => order.id === proof.order_id && !["paid", "revoked"].includes(order.status)));
}
function attemptReceipt(mine: MyMembershipWallet, attempt: WalletAttempt): boolean {
  if (attempt.kind === "checkout") {
    const order = mine.orders.find((entry) => entry.request_id === attempt.requestId);
    if (!order) return false;
    if (order.buyer_id !== attempt.ownerId || order.route_id !== attempt.routeId || JSON.stringify(parseWalletQuote(order)) !== JSON.stringify(attempt.expectedQuote)) throw new Error("membership_wallet_checkpoint_changed");
    return true;
  }
  return mine.verifications.some((proof) => proof.order_id === attempt.orderId && proof.tx_hash === attempt.txHash);
}

export function MembershipWallet({ actorId, initial, initialPlans = [], initialError = "" }: { actorId: string; initial: MyMembershipWallet | null; initialPlans?: CommercePlan[]; initialError?: string }) {
  const router = useRouter();
  const [mine, setMine] = useState(initial); const [plans, setPlans] = useState(initialPlans); const [error, setError] = useState(initialError); const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false); const [attempt, setAttempt] = useState<WalletAttempt | null>(null); const [checked, setChecked] = useState(false); const [identityChanged, setIdentityChanged] = useState(false);
  const revision = useRef(0); const lock = useRef(false); const paidIds = useRef(new Set(initial?.orders.filter((order) => order.status === "paid").map((order) => order.id)));
  useEffect(() => {
    let active = true;
    const invalidate = () => { ++revision.current; };
    const restore = () => { try { setAttempt(readWalletAttempt(actorId)); setChecked(true); } catch (failure) { setChecked(false); setError(membershipWalletError(failure)); } };
    restore();
    const { data } = createClient().auth.onAuthStateChange((_event, session) => {
      if (active && session?.user.id !== actorId) { ++revision.current; lock.current = false; setMine(null); setPlans([]); setAttempt(null); setPending(false); setChecked(false); setIdentityChanged(true); }
    });
    const storage = (event: StorageEvent) => { if (event.key !== walletAttemptKey(actorId) && event.key !== null) return; ++revision.current; lock.current = false; setPending(false); restore(); setMessage("其他标签页的原请求已变化，请先核对原订单。不会另建付款。"); };
    window.addEventListener("storage", storage);
    return () => { active = false; invalidate(); data.subscription.unsubscribe(); window.removeEventListener("storage", storage); };
  }, [actorId]);

  async function authenticate(current: number) {
    const result = await createClient().auth.getUser();
    if (current !== revision.current) throw new Error("authentication_required");
    if (result.error || result.data.user?.id !== actorId) { ++revision.current; lock.current = false; setMine(null); setPlans([]); setAttempt(null); setPending(false); setIdentityChanged(true); throw new Error("authentication_required"); }
  }
  async function read(current: number, prices = false) {
    await authenticate(current); const client = createClient();
    const [snapshot, commerce] = await Promise.all([membershipWalletRepository(client, actorId).mine(), prices ? membershipCommerceRepository(client, actorId).mine() : Promise.resolve(null)]);
    await authenticate(current); setMine(snapshot); if (commerce) setPlans(commerce.catalog.plans);
    if (snapshot.orders.some((order) => order.status === "paid" && !paidIds.current.has(order.id))) { paidIds.current = new Set(snapshot.orders.filter((order) => order.status === "paid").map((order) => order.id)); router.refresh(); }
    return { snapshot, plans: commerce?.catalog.plans ?? plans };
  }
  function settleCheckpoint(snapshot: MyMembershipWallet, original: WalletAttempt | null) {
    if (original && attemptReceipt(snapshot, original)) { clearWalletAttempt(original); setAttempt(null); setChecked(true); return true; } return false;
  }
  async function refresh(silent = false) {
    if (lock.current || identityChanged) return; lock.current = true; if (!silent) setPending(true); const current = revision.current;
    try { const result = await read(current, !silent); const original = readWalletAttempt(actorId); settleCheckpoint(result.snapshot, original); setChecked(true); setError(""); if (!silent) setMessage(original ? "原请求已核对，请查看下方原订单或使用原请求继续。" : "已核对本人订单；提交哈希不代表付款成功。"); }
    catch (failure) { if (current === revision.current) { setMine(null); setChecked(false); setError(membershipWalletError(failure)); } }
    finally { if (current === revision.current) { lock.current = false; if (!silent) setPending(false); } }
  }
  const watching = Boolean(mine?.orders.some((order) => ["pending", "expired"].includes(order.status)) || mine?.verifications.some((proof) => ["queued", "leased", "waiting"].includes(proof.status) && mine.orders.some((order) => order.id === proof.order_id && !["paid", "revoked"].includes(order.status))));
  const poll = useEffectEvent(() => { if (document.visibilityState === "visible" && document.hasFocus()) void refresh(true); });
  useEffect(() => {
    if (!watching || identityChanged) return;
    // Poll only existing owner invoices. Never create a checkout or submit a hash.
    const timer = window.setInterval(poll, 15000);
    return () => window.clearInterval(timer);
  }, [watching, identityChanged]);

  async function operate(input?: { plan: CommercePlan; price: MembershipPrice; routeId: WalletRouteId } | { order: WalletOrder; txHash: string }) {
    if (lock.current || identityChanged || !checked) return; lock.current = true; setPending(true); setError(""); setMessage(""); const current = revision.current;
    let original: WalletAttempt | null = null; let persisted = false;
    try {
      const fresh = await read(current, true); original = readWalletAttempt(actorId); persisted = Boolean(original);
      if (settleCheckpoint(fresh.snapshot, original)) { setMessage("已获得原请求回执，无需再次转账。请以下方订单和实际权益为准。"); return; }
      if (!original && input && "plan" in input) {
        if (unresolved(fresh.snapshot)) throw new Error("membership_pending_order_exists");
        const plan = fresh.plans.find((entry) => entry.key === input.plan.key); const price = plan?.prices.find((entry) => entry.id === input.price.id); const route = fresh.snapshot.catalog.routes.find((entry) => entry.id === input.routeId);
        const shownRoute = mine?.catalog.routes.find((entry) => entry.id === input.routeId);
        if (!fresh.snapshot.catalog.purchase_available || !route?.enabled || !route.recipient || !plan || !price || !shownRoute) throw new Error("membership_wallet_unavailable");
        const quote = walletExpectedQuote(plan, price, route); if (JSON.stringify(quote) !== JSON.stringify(walletExpectedQuote(input.plan, input.price, shownRoute))) throw new Error("membership_quote_changed");
        original = { kind: "checkout", ownerId: actorId, requestId: crypto.randomUUID(), routeId: route.id, expectedQuote: quote };
      } else if (!original && input && "order" in input) {
        const order = fresh.snapshot.orders.find((entry) => entry.id === input.order.id);
        if (!order || !["pending", "expired", "review"].includes(order.status)) throw new Error("membership_wallet_order_not_payable");
        original = { kind: "transfer", ownerId: actorId, orderId: order.id, chain: order.chain, txHash: walletTransferHash(order.chain, input.txHash) };
      }
      if (!original) return; writeWalletAttempt(original); persisted = true; setAttempt(original); await authenticate(current);
      if (JSON.stringify(readWalletAttempt(actorId)) !== JSON.stringify(original)) throw new Error("membership_wallet_checkpoint_changed");
      const repository = membershipWalletRepository(createClient(), actorId);
      if (original.kind === "checkout") await repository.create({ priceId: original.expectedQuote.price_id, routeId: original.routeId, requestId: original.requestId, expectedQuote: original.expectedQuote });
      else await repository.submitTransfer({ orderId: original.orderId, chain: original.chain, txHash: original.txHash });
      await authenticate(current); const confirmed = await read(current);
      if (!settleCheckpoint(confirmed.snapshot, original)) throw new Error("membership_wallet_response_invalid");
      setMessage(original.kind === "checkout" ? "付款订单已生成，请严格使用该订单的网络、币种、收款地址和完整金额。" : "交易哈希已提交核验。无需再次转账；确认成功后服务端自动开通 VIP。");
    } catch (failure) {
      if (current !== revision.current) return;
      let recovered = false;
      if (original && persisted) {
        try { const confirmed = await read(current); recovered = settleCheckpoint(confirmed.snapshot, original);
          const code = failure instanceof Error ? failure.message : "";
          if (!recovered && original.kind === "checkout" && failure instanceof MembershipWalletCheckoutError && failure.status === 409 && code === "membership_wallet_quote_changed") { clearWalletAttempt(original); setAttempt(null); setError(membershipWalletError(failure)); setMessage("服务器明确拒绝旧报价，已核实原请求没有订单。请核对新报价后主动创建；不会自动创建另一笔付款。"); return; }
        } catch { /* Keep the exact request when no authoritative receipt exists. */ }
      }
      if (current !== revision.current) return; setError(recovered ? "" : membershipWalletError(failure)); if (/checkpoint|storage|SecurityError|QuotaExceededError/.test(String(failure))) setChecked(false);
      if (recovered) setMessage("原请求回执已恢复，请查看原订单；没有重复发起付款或转账。");
      else if (original && persisted) setMessage("结果仍不确定，原请求已保留。请先核对订单，再使用原请求继续；不要重复转账。");
      else if (original) setMessage("原请求未能安全持久化，尚未发起付款或提交哈希。请核对已有订单后重试，不会继续创建新付款。");
    } finally { if (current === revision.current) { lock.current = false; setPending(false); } }
  }
  if (identityChanged) return <section className="grid gap-3 rounded-xl border bg-surface p-5"><p role="alert">账号已变化，旧钱包订单与收款信息已清除。</p><a href="/membership" className="inline-flex min-h-11 w-fit items-center rounded-lg border px-4 text-primary">重新核对当前账号</a></section>;
  return <MembershipWalletSummary mine={mine} plans={plans} error={error} message={message} pending={pending} blocked={!checked || Boolean(attempt)} hasAttempt={Boolean(attempt)} onRefresh={() => void refresh()} onRecover={() => void operate()} onCreate={(plan, price, routeId) => void operate({ plan, price, routeId })} onSubmit={(order, txHash) => void operate({ order, txHash })} />;
}

export function walletOrderLabel(order: WalletOrder, verification?: WalletVerification, now: number | null = null) {
  if (order.status === "paid") return "付款已确认"; if (order.status === "review" || verification?.status === "review") return "需要人工核对"; if (order.status === "revoked") return "已撤销";
  if (verification?.status === "waiting") return "等待链上确认"; if (verification && ["queued", "leased"].includes(verification.status)) return "正在核验转账";
  return order.status === "expired" || now !== null && Date.parse(order.expires_at) <= now ? "报价已过期" : "等待付款";
}
function WalletInvoice({ order, verification, pending, blocked, preview, now, onSubmit }: { order: WalletOrder; verification?: WalletVerification; pending: boolean; blocked: boolean; preview: boolean; now: number | null; onSubmit: (order: WalletOrder, hash: string) => void }) {
  const [hash, setHash] = useState(""); const [error, setError] = useState(""); const [copyStatus, setCopyStatus] = useState(""); const id = `wallet-hash-${order.id}`;
  const expired = order.status === "expired" || now !== null && Date.parse(order.expires_at) <= now; const payable = now !== null && order.status === "pending" && !expired && !verification;
  const terminal = ["paid", "revoked"].includes(order.status);
  async function copy(kind: "recipient" | "amount") { try { await navigator.clipboard.writeText(kind === "recipient" ? order.recipient : order.amount_decimal); setCopyStatus(kind === "recipient" ? "收款地址已复制，请再次核对网络。" : "完整 6 位金额已复制，不含钱包手续费。"); } catch { setCopyStatus("无法复制，请手动核对并复制完整内容。"); } }
  return <article className="grid min-w-0 gap-4 rounded-xl border bg-surface p-5 md:p-6" aria-labelledby={`wallet-order-${order.id}`}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 id={`wallet-order-${order.id}`} className="text-lg font-semibold">{order.title_snapshot} · {order.term_months === 1 ? "月度" : "年度"}</h3><span className="rounded-lg bg-muted px-3 py-1 text-sm font-medium">{walletOrderLabel(order, verification, now)}</span></div>
    <p className="break-all text-xs leading-5 text-muted-foreground">订单 {order.id}</p>
    <dl className="grid gap-4 text-sm"><div><dt className="text-muted-foreground">网络与币种（必须一致）</dt><dd className="mt-1 font-semibold">{walletNetworkLabel(order.chain)} · {order.asset}</dd></div><div><dt className="text-muted-foreground">实际到账金额（完整 6 位）</dt><dd className="mt-1 break-all font-mono text-2xl font-semibold tabular-nums" data-wallet-amount>{order.amount_decimal} {order.asset}</dd><dd className="mt-1 text-xs leading-5 text-muted-foreground">基价 {walletAmountDecimal(order.base_amount_units)} {order.asset}，包含订单唯一尾数，附加最多 0.009999。不能仅转基价或省略尾数。钱包网络手续费另付，不包含在此到账金额里。</dd></div><div><dt className="text-muted-foreground">本订单冻结的收款地址</dt><dd className="mt-1 break-all rounded-lg bg-muted/40 p-3 font-mono leading-6" data-wallet-recipient>{preview ? "虚拟测试地址 · 不可转账" : order.recipient}</dd></div><div><dt className="text-muted-foreground">转账期限（北京时间）</dt><dd className="mt-1"><time dateTime={order.expires_at}>{membershipDate(order.expires_at)}</time> · 创建后 30 分钟</dd></div></dl>
    {payable ? <div className="grid gap-3"><p className="text-sm leading-6">请在期限内通过同链同币完成转账，确保收款地址实际收到上述完整金额。不要向其他网络发送资产。</p><div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" className="min-h-11" disabled={preview || pending || blocked} onClick={() => void copy("recipient")}>复制收款地址</Button><Button type="button" variant="secondary" className="min-h-11" disabled={preview || pending || blocked} onClick={() => void copy("amount")}>复制完整金额</Button></div></div> : null}
    {copyStatus ? <p role="status" className="text-sm text-muted-foreground">{copyStatus}</p> : null}
    {!terminal && (order.status === "review" || verification?.status === "review") ? <p className="rounded-lg border bg-muted/40 p-4 text-sm leading-6">金额不足、超付、币种 / 网络不符或迟到的付款需要人工核对，不会自动退款或自动开通。请保留交易哈希，不要再次转账。</p> : null}
    {terminal && verification?.status === "review" ? <p className="text-sm leading-6 text-muted-foreground">此订单的额外哈希需人工核对，不更改既有付款状态，不重复授予 VIP，不自动退款。</p> : null}
    {expired && order.status !== "paid" ? <p className="text-sm leading-6 text-muted-foreground">此付款报价已经过期，请勿继续转账。若已在期限内转账，仍可提交原交易哈希；链上确认晚到不等于重新付款。真正迟到的到账将进入人工核对。</p> : null}
    {verification ? <div className="grid gap-2 rounded-lg bg-muted/40 p-4 text-sm"><p>{terminal ? "本订单已终结，旧哈希的等待状态不会阻止续费或反复轮询；请以实际权益为准。" : "已提交交易哈希，系统只在页面可见且聚焦时每 15 秒核对本人订单。请勿重复转账。"}</p><code className="break-all text-xs">{verification.tx_hash}</code></div> : null}
    {["pending", "expired", "review"].includes(order.status) && (!verification || verification.status !== "settled") ? <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); setError(""); try { const value = walletTransferHash(order.chain, hash); onSubmit(order, value); } catch (failure) { setError(membershipWalletError(failure)); event.currentTarget.querySelector<HTMLInputElement>("input")?.focus(); } }}><Field><Label htmlFor={id}>{verification ? "核对后的正确交易哈希" : "已转账的交易哈希"}</Label><Input id={id} className="min-h-11 font-mono" value={hash} onChange={(event) => { setHash(event.target.value); setError(""); }} autoComplete="off" spellCheck={false} maxLength={66} required disabled={pending || blocked || preview} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : `${id}-hint`} /><p id={`${id}-hint`} className="text-xs leading-5 text-muted-foreground">填写该网络完整交易哈希。提交仅进入核验队列，不代表已付款或已开通。若原哈希填错，可核对后提交正确哈希，不要另行转账。</p></Field>{error ? <FieldMessage id={`${id}-error`} role="alert">{error}</FieldMessage> : null}<Button type="submit" className="min-h-11 w-fit" disabled={pending || blocked || preview}>{pending ? "正在核对…" : verification ? "提交修正哈希核验" : "提交交易哈希核验"}</Button></form> : null}
    {order.status === "paid" ? <p className="text-sm leading-6">服务端已确认到账。VIP 权益和到期时间以上方实际权益及下方生效记录为准。</p> : null}
  </article>;
}

export function MembershipWalletSummary({ mine, plans, error = "", message = "", pending = false, blocked = false, hasAttempt = false, preview = false, onRefresh, onRecover, onCreate, onSubmit }: { mine: MyMembershipWallet | null; plans: CommercePlan[]; error?: string; message?: string; pending?: boolean; blocked?: boolean; hasAttempt?: boolean; preview?: boolean; onRefresh: () => void; onRecover: () => void; onCreate: (plan: CommercePlan, price: MembershipPrice, routeId: WalletRouteId) => void; onSubmit: (order: WalletOrder, hash: string) => void }) {
  const [routeId, setRouteId] = useState<string>(""); const [priceId, setPriceId] = useState<string>(""); const [acknowledged, setAcknowledged] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { const update = () => setNow(Date.now()); update(); const timer = window.setInterval(update, 1000); return () => window.clearInterval(timer); }, []);
  const route = mine?.catalog.routes.find((entry) => entry.id === routeId); const plan = plans.find((entry) => entry.prices.some((price) => price.id === priceId)); const price = plan?.prices.find((entry) => entry.id === priceId);
  const choices = mine?.catalog.routes.filter((entry) => entry.enabled && entry.recipient !== null) ?? []; const priceChoices = plans.filter((item) => item.enabled).flatMap((item) => item.prices.filter((entry) => entry.published && entry.currency === "USD").map((entry) => ({ plan: item, price: entry })));
  const canCreate = Boolean(mine?.catalog.purchase_available && !unresolved(mine, now ?? 0) && route?.enabled && route.recipient && plan && price && acknowledged && !blocked && !pending);
  return <section aria-labelledby="membership-wallet-title" className="grid gap-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="membership-wallet-title" className="text-xl font-semibold">VIP 钱包支付</h2><Button type="button" variant="secondary" className="min-h-11" disabled={pending} onClick={onRefresh}>{pending ? "正在核对…" : "核对钱包订单"}</Button></div>
    <p className="text-sm leading-6 text-muted-foreground">使用 USDT / USDC 一次性开通，不自动续费。只支持下列固定网络与官方稳定币；不需要提交私钥、助记词或钱包登录信息。</p>
    {error ? <FieldMessage role="alert">{error}</FieldMessage> : null}{message ? <p role="status" className="rounded-xl border bg-muted/40 p-4 text-sm leading-6">{message}</p> : null}
    {hasAttempt ? <Button type="button" variant="secondary" className="min-h-11 w-fit" disabled={pending} onClick={onRecover}>核对并继续原钱包请求</Button> : null}
    {!mine ? <p className="rounded-xl border border-dashed p-5 text-sm leading-6 text-muted-foreground">未能读取本人钱包支付记录，请点击核对后重试。未知状态不视为已开通，也不显示付款地址。</p> : <>
      <div className="grid gap-2 rounded-xl border bg-surface p-5"><h3 className="font-semibold">当前实际 VIP 权益</h3><p>{mine.effective.has_vip ? "有效 VIP 会员" : "暂无有效 VIP 权益"}</p><p className="text-sm text-muted-foreground">平台 AI 每日 {mine.effective.ai_daily_limit} 次 · {membershipDiscount(mine.effective.mentor_discount_bps)}</p></div>
      {!mine.catalog.purchase_available ? <p role="status" className="rounded-xl border bg-muted/40 p-4 text-sm leading-6">钱包收款尚未配置或未开放，当前不可付款。不显示真实或样例付款地址；原有账号与公开内容不受影响。</p> : unresolved(mine, now ?? 0) ? <p role="status" className="text-sm leading-6">请先处理下方原订单或等待核验结果，不要重复创建订单或转账。</p> : <form className="grid gap-4 rounded-xl border bg-surface p-5" onSubmit={(event) => { event.preventDefault(); if (canCreate && plan && price && route) onCreate(plan, price, route.id); }}>
        <h3 className="font-semibold">选择方案与付款网络</h3><Field><Label htmlFor="wallet-membership-price">VIP 方案</Label><select id="wallet-membership-price" value={priceId} onChange={(event) => { setPriceId(event.target.value); setAcknowledged(false); }} required disabled={pending || blocked} className="min-h-11 w-full rounded-lg border bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"><option value="">请选择月度或年度方案</option>{priceChoices.map(({ plan: item, price: entry }) => <option key={entry.id} value={entry.id}>{item.title} · {entry.term_months === 1 ? "月度" : "年度"} · 基价 {walletAmountDecimal((BigInt(entry.amount_minor) * BigInt(10000)).toString())} USDT / USDC</option>)}</select></Field>
        <Field><Label htmlFor="wallet-membership-route">付款网络与币种</Label><select id="wallet-membership-route" value={routeId} onChange={(event) => { setRouteId(event.target.value); setAcknowledged(false); }} required disabled={pending || blocked} className="min-h-11 w-full rounded-lg border bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"><option value="">请选择与转账钱包一致的网络</option>{choices.map((entry) => <option key={entry.id} value={entry.id}>{walletRouteLabel(entry)}</option>)}</select></Field>
        {plan ? <div className="grid gap-1 rounded-lg bg-muted/40 p-4 text-sm leading-6"><p>该方案平台 AI 每日 {plan.ai_daily_limit} 次 · {membershipDiscount(plan.mentor_discount_bps)}</p><p className="text-muted-foreground">{plan.description}</p></div> : null}
        {!priceChoices.length ? <p role="status" className="text-sm leading-6 text-muted-foreground">尚未发布可购买的 USD 方案，请稍后核对；不能生成付款订单。</p> : null}
        <p className="text-sm leading-6 text-muted-foreground">创建订单后服务端分配唯一小数尾数，实际到账金额比基价增加最多 0.009999。请使用订单显示的全部 6 位小数，另付钱包手续费；不能只转整数。</p><label className="flex min-h-11 items-start gap-3 text-sm leading-6"><input type="checkbox" className="mt-1 size-4 shrink-0" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} disabled={pending || blocked} />我会核对同链同币、完整到账金额，并在 30 分钟内转账。少付、超付或迟到须人工核对，不自动退款。</label><Button type="submit" className="min-h-11 w-fit" disabled={!canCreate || preview}>生成钱包付款订单</Button>
      </form>}
      <div className="grid gap-4"><h3 className="text-lg font-semibold">我的钱包付款订单</h3>{mine.orders.length ? mine.orders.map((order) => <WalletInvoice key={order.id} order={order} verification={mine.verifications.find((entry) => entry.order_id === order.id)} pending={pending} blocked={blocked} preview={preview} now={now} onSubmit={onSubmit} />) : <p className="text-sm text-muted-foreground">暂无钱包付款订单，尚未发起任何转账。</p>}</div>
      <div className="grid gap-3"><h3 className="text-lg font-semibold">钱包购买生效记录</h3>{mine.purchase_grants.length ? <ul className="grid gap-3">{mine.purchase_grants.map((grant) => <li key={grant.id} className="grid gap-2 rounded-xl border bg-surface p-4 text-sm"><strong>{grant.title} · {{ active: "生效中", scheduled: "尚未生效", expired: "已到期", disabled: "方案已停用", revoked: "已撤销" }[grant.status]}</strong><span>北京时间：{membershipDate(grant.starts_at)} — {membershipDate(grant.ends_at)}</span><span className="text-muted-foreground">购买时平台 AI 每日 {grant.ai_daily_limit} 次 · {membershipDiscount(grant.mentor_discount_bps)}</span></li>)}</ul> : <p className="text-sm text-muted-foreground">暂无钱包购买生效记录。</p>}</div>
    </>}
  </section>;
}
