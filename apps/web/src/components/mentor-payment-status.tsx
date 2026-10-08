"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatMentorPrice } from "@wavekb/domain";
import { Button, Input, Label } from "@wavekb/ui";
import { createClient } from "@/lib/supabase/client";
import { cancelUnsubmittedMentorOrder, resumeManualMentorPayment } from "@/lib/mentor/client-repository";
import { readBuyerMentorClaims, readBuyerPendingMentorOrders, type BuyerMentorClaim, type BuyerPendingMentorOrder, type MentorOrderSummary } from "@/lib/mentor/payment-status";

export function useBuyerMentorClaims(actorId: string | null, mentorId?: string) {
  const [state, setState] = useState<{ actorId: string | null; mentorId?: string; claims: BuyerMentorClaim[]; pendingOrders: BuyerPendingMentorOrder[]; loading: boolean; error: string; checkedAt: string | null; revision: number }>({ actorId, mentorId, claims: [], pendingOrders: [], loading: true, error: "", checkedAt: null, revision: 0 });
  const generation = useRef(0);
  const busy = useRef(false);
  const refresh = useCallback(async () => {
    if (!actorId || busy.current) return;
    busy.current = true;
    const current = generation.current;
    try {
      const client = createClient();
      const [claims, orders] = await Promise.all([readBuyerMentorClaims(client, actorId, mentorId), readBuyerPendingMentorOrders(client, actorId, mentorId)]);
      const pendingOrders = orders.filter((order) => !claims.some((claim) => claim.order_id === order.id));
      if (current === generation.current) setState((previous) => ({ actorId, mentorId, claims, pendingOrders, loading: false, error: "", checkedAt: new Date().toISOString(), revision: previous.revision + 1 }));
    } catch {
      if (current === generation.current) setState((previous) => ({ actorId, mentorId, claims: [], pendingOrders: [], checkedAt: null, loading: false, error: "暂时无法核对付款声明状态。请重试查询，不要重复转账或提交。", revision: previous.revision }));
    } finally {
      if (current === generation.current) busy.current = false;
    }
  }, [actorId, mentorId]);

  useEffect(() => {
    const current = ++generation.current;
    busy.current = false;
    const initialRead = window.setTimeout(() => void refresh(), 0);
    const poll = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = window.setInterval(poll, 15000);
    document.addEventListener("visibilitychange", poll);
    return () => { generation.current = current + 1; busy.current = false; window.clearTimeout(initialRead); window.clearInterval(timer); document.removeEventListener("visibilitychange", poll); };
  }, [refresh]);
  const matches = state.actorId === actorId && state.mentorId === mentorId;
  return { ...state, claims: matches ? state.claims : [], pendingOrders: matches ? state.pendingOrders : [], loading: !matches || state.loading, error: matches ? state.error : "", refresh };
}

function OrderTerms({ order }: { order: MentorOrderSummary | null | undefined }) {
  if (!order) return null;
  return <p className="text-sm leading-6 text-muted-foreground">{order.offer_name_snapshot || "辅导方案"}{typeof order.amount_cents === "number" ? ` · ${formatMentorPrice(order.amount_cents, order.currency || "USDT")}` : ""}{order.duration_days_snapshot ? ` · ${order.duration_days_snapshot} 天` : ""}{order.weekly_questions_snapshot ? ` · 每周 ${order.weekly_questions_snapshot} 次` : ""}</p>;
}

function PendingOrderRecovery({ order, refresh, onResolved }: { order: BuyerPendingMentorOrder; refresh: () => Promise<void>; onResolved?: (orderId: string) => void }) {
  const [note, setNote] = useState("");
  const [unpaid, setUnpaid] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  async function recover(cancel: boolean) {
    if (lock.current || cancel && !unpaid) return;
    lock.current = true; setPending(true); setError("");
    try {
      const client = createClient();
      if (cancel) await cancelUnsubmittedMentorOrder(client, order.id, true);
      else await resumeManualMentorPayment(client, order.id, note);
      if (cancel) {
        const key = `wavekb:mentor-payment-attempt:${order.buyer_id}:${order.mentor_id}`;
        try {
          const marker = JSON.parse(localStorage.getItem(key) || "null");
          if (marker?.orderId === order.id) localStorage.removeItem(key);
        } catch { /* A failed local cleanup never reverses the confirmed cancellation. */ }
      }
      onResolved?.(order.id);
    } catch {
      setError("暂时无法核对处理结果。请刷新状态；重试仍使用原订单，不要再次转账。");
    } finally { await refresh(); lock.current = false; setPending(false); }
  }
  if (order.payment_provider !== "manual" || !order.payment_method_id) return <p className="text-sm leading-6 text-muted-foreground">此订单不是可补交声明的手工付款订单。请回到原支付页面核对，或联系导师处理；不要再次转账。</p>;
  return <div className="grid gap-3">
    <p className="text-sm leading-6">原订单已保存，但还没有付款声明。已转账请选择补交声明；只有确认从未转账，才可以取消。</p>
    <div className="grid gap-1"><Label htmlFor={`mentor-recovery-note-${order.id}`}>转账编号或核对备注（可选）</Label><Input id={`mentor-recovery-note-${order.id}`} className="min-h-11" value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} disabled={pending} /></div>
    <Button type="button" variant="secondary" className="min-h-11 w-fit" disabled={pending} onClick={() => void recover(false)}>已付款，补交原订单声明</Button>
    <label className="flex min-h-11 items-center gap-2 py-2 text-sm"><input type="checkbox" checked={unpaid} disabled={pending} onChange={(event) => setUnpaid(event.target.checked)} className="accent-primary" />我确认此订单从未转账，需要取消</label>
    <Button type="button" variant="ghost" className="min-h-11 w-fit" disabled={pending || !unpaid} onClick={() => void recover(true)}>取消未付款原订单</Button>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
  </div>;
}

export function MentorClaimList({ claims, pendingOrders = [], checkedAt, error, refresh }: { claims: BuyerMentorClaim[]; pendingOrders?: BuyerPendingMentorOrder[]; checkedAt: string | null; error: string; refresh: () => Promise<void> }) {
  const labels = { submitted: "待导师核对", confirmed: "导师已确认", rejected: "导师未确认付款", cancelled: "已取消" };
  return <section className="grid gap-3 rounded-xl border bg-surface p-5" aria-label="付款声明状态">
    <h2 className="text-xl font-semibold">付款声明</h2>
    <p className="text-sm text-muted-foreground">声明不代表已到账；导师确认后才发放权益。请勿重复转账或提交。</p>
    {pendingOrders.map((order) => <article key={order.id} className="grid gap-3 rounded-lg border p-3 text-sm"><strong>订单已创建，付款声明待核实</strong><OrderTerms order={order} /><span className="break-all text-xs text-muted-foreground">待核实订单编号：{order.id}</span><PendingOrderRecovery order={order} refresh={refresh} /><Link className="text-primary" href={`/mentors/${order.mentor_id}`}>查看导师方案</Link></article>)}
    {claims.map((claim) => <article key={claim.id} className="grid gap-2 rounded-lg border p-3 text-sm"><strong>{labels[claim.status]}</strong><OrderTerms order={claim.order} /><span className="break-all text-xs text-muted-foreground">订单编号：{claim.order_id}</span><span>提交时间：<time dateTime={claim.submitted_at}>{new Date(claim.submitted_at).toLocaleString("zh-CN")}</time></span>{claim.reviewed_at ? <span>核对时间：<time dateTime={claim.reviewed_at}>{new Date(claim.reviewed_at).toLocaleString("zh-CN")}</time></span> : null}<Link className="text-primary" href={claim.status === "confirmed" ? "/tutoring" : `/mentors/${claim.mentor_id}`}>{claim.status === "confirmed" ? "查看已发放权益" : "查看导师方案"}</Link></article>)}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {checkedAt ? <p className="text-xs text-muted-foreground">上次查询：<time dateTime={checkedAt}>{new Date(checkedAt).toLocaleTimeString("zh-CN")}</time></p> : null}
    <Button type="button" variant="secondary" className="min-h-11 w-fit" onClick={() => void refresh()}>{error ? "重试查询状态" : "刷新付款状态"}</Button>
  </section>;
}

export function MentorPaymentSummary({ claims, pendingOrders = [], error, refresh, onOrderResolved }: { claims: BuyerMentorClaim[]; pendingOrders?: BuyerPendingMentorOrder[]; error: string; refresh: () => Promise<void>; onOrderResolved?: (orderId: string) => void }) {
  const unresolvedClaims = claims.filter((claim) => claim.status === "submitted");
  const unresolvedCount = unresolvedClaims.length + pendingOrders.length;
  return <section className="grid gap-3 rounded-xl border bg-surface p-5" aria-label="付款待核对摘要">
    <h2 className="text-xl font-semibold">{error ? "付款状态暂时无法核实" : `${unresolvedCount} 项待核对付款`}</h2>
    <p className="text-sm leading-6 text-muted-foreground">{error ? "请先重新查询付款状态；在核实前请勿重复转账或提交。" : "包含已提交的付款声明或尚未提交声明的待处理订单。完整状态和历史记录请在“我的辅导”中查看。"}</p>
    {unresolvedClaims.map((claim) => <article key={claim.id} className="grid gap-1 rounded-lg border p-3"><strong className="text-sm">待导师核对</strong><OrderTerms order={claim.order} /><span className="text-xs text-muted-foreground">提交时间：<time dateTime={claim.submitted_at}>{new Date(claim.submitted_at).toLocaleString("zh-CN")}</time></span></article>)}
    {pendingOrders.map((order) => <article key={order.id} className="grid gap-3 rounded-lg border p-3"><strong className="text-sm">原订单待补交声明</strong><OrderTerms order={order} /><PendingOrderRecovery order={order} refresh={refresh} onResolved={onOrderResolved} /></article>)}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <div className="flex flex-wrap gap-3"><Button type="button" variant="secondary" className="min-h-11 w-fit" onClick={() => void refresh()}>{error ? "重试查询状态" : "刷新付款状态"}</Button><Link className="flex min-h-11 items-center self-center text-sm font-medium text-primary hover:underline" href="/tutoring">查看完整付款记录</Link></div>
  </section>;
}

export function MentorPaymentStatus({ actorId }: { actorId: string }) {
  const state = useBuyerMentorClaims(actorId);
  const router = useRouter();
  const previousClaims = useRef<{ actorId: string; pendingIds: string[] }>({ actorId, pendingIds: [] });
  useEffect(() => {
    if (state.loading || state.error) return;
    if (previousClaims.current.actorId === actorId && state.claims.some((claim) => claim.status === "confirmed" && previousClaims.current.pendingIds.includes(claim.id))) router.refresh();
    previousClaims.current = { actorId, pendingIds: state.claims.filter((claim) => claim.status === "submitted").map((claim) => claim.id) };
  }, [actorId, state.claims, state.loading, state.error, router]);
  if (state.loading) return <p role="status" className="text-sm text-muted-foreground">正在查询付款声明状态…</p>;
  if (!state.claims.length && !state.pendingOrders.length && !state.error) return null;
  return <MentorClaimList {...state} />;
}
