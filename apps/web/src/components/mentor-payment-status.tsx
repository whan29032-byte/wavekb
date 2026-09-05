"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@wavekb/ui";
import { createClient } from "@/lib/supabase/client";
import { readBuyerMentorClaims, readBuyerPendingMentorOrders, type BuyerMentorClaim, type BuyerPendingMentorOrder } from "@/lib/mentor/payment-status";

export function useBuyerMentorClaims(actorId: string | null, mentorId?: string) {
  const [state, setState] = useState<{ actorId: string | null; mentorId?: string; claims: BuyerMentorClaim[]; pendingOrders: BuyerPendingMentorOrder[]; loading: boolean; error: string; checkedAt: string | null }>({ actorId, mentorId, claims: [], pendingOrders: [], loading: true, error: "", checkedAt: null });
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
      if (current === generation.current) setState({ actorId, mentorId, claims, pendingOrders, loading: false, error: "", checkedAt: new Date().toISOString() });
    } catch {
      if (current === generation.current) setState({ actorId, mentorId, claims: [], pendingOrders: [], checkedAt: null, loading: false, error: "暂时无法核对付款声明状态。请重试查询，不要重复转账或提交。" });
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

export function MentorClaimList({ claims, pendingOrders = [], checkedAt, error, refresh }: { claims: BuyerMentorClaim[]; pendingOrders?: BuyerPendingMentorOrder[]; checkedAt: string | null; error: string; refresh: () => Promise<void> }) {
  const labels = { submitted: "待导师核对", confirmed: "导师已确认", rejected: "导师未确认付款", cancelled: "已取消" };
  return <section className="grid gap-3 rounded-xl border bg-surface p-5" aria-label="付款声明状态">
    <h2 className="text-xl font-semibold">付款声明</h2>
    <p className="text-sm text-muted-foreground">声明不代表已到账；导师确认后才发放权益。请勿重复转账或提交。</p>
    {pendingOrders.map((order) => <article key={order.id} className="grid gap-2 rounded-lg border p-3 text-sm"><strong>订单已创建，付款声明待核实</strong><span className="break-all text-xs text-muted-foreground">待核实订单编号：{order.id}</span><p>请联系导师核对该订单；没有付款声明不代表没有转账，请勿重复付款。</p><Link className="text-primary" href={`/mentors/${order.mentor_id}`}>查看导师方案</Link></article>)}
    {claims.map((claim) => <article key={claim.id} className="grid gap-2 rounded-lg border p-3 text-sm"><strong>{labels[claim.status]}</strong><span className="break-all text-xs text-muted-foreground">订单编号：{claim.order_id}</span><span>提交时间：<time dateTime={claim.submitted_at}>{new Date(claim.submitted_at).toLocaleString("zh-CN")}</time></span>{claim.reviewed_at ? <span>核对时间：<time dateTime={claim.reviewed_at}>{new Date(claim.reviewed_at).toLocaleString("zh-CN")}</time></span> : null}<Link className="text-primary" href={claim.status === "confirmed" ? "/tutoring" : `/mentors/${claim.mentor_id}`}>{claim.status === "confirmed" ? "查看已发放权益" : "查看导师方案"}</Link></article>)}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {checkedAt ? <p className="text-xs text-muted-foreground">上次查询：<time dateTime={checkedAt}>{new Date(checkedAt).toLocaleTimeString("zh-CN")}</time></p> : null}
    <Button type="button" variant="secondary" className="w-fit" onClick={() => void refresh()}>{error ? "重试查询状态" : "刷新付款状态"}</Button>
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
