"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Check, ChatsCircle, PencilSimple, Plus, X } from "@phosphor-icons/react";
import { formatMentorPrice, type MentorOffer, type MentorPaymentClaim, type MentorPaymentMethod, type MentorSettings, type MentorStudent } from "@wavekb/domain";
import { Button, Field, FieldMessage, Input, Label, Textarea } from "@wavekb/ui";
import { createClient } from "@/lib/supabase/client";
import { reviewMentorPaymentClaim, saveMentorOffer, saveMentorPaymentMethod } from "@/lib/mentor/client-repository";

const selectClassName = "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50";
const paymentKinds: Array<[MentorPaymentMethod["kind"], string]> = [["alipay", "支付宝"], ["wechat", "微信"], ["bank", "银行卡"], ["binance", "币安"], ["crypto", "链上地址"], ["other", "其他"]];

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/permission|row-level|claim_access_denied|jwt|auth/i.test(message)) return "当前账号没有权限执行这项操作。";
  if (/claim_already_reviewed/i.test(message)) return "这条付款声明已经处理，请刷新页面。";
  return message || "操作没有完成，请稍后重试。";
}

type ManagedClaim = MentorPaymentClaim & { thread_id?: string | null };

export function MentorManagement({ initialSettings, initialStudents, initialClaims }: { initialSettings: MentorSettings; initialStudents: MentorStudent[]; initialClaims: ManagedClaim[] }) {
  const [offers, setOffers] = useState(initialSettings.offers);
  const [methods, setMethods] = useState(initialSettings.payment_methods);
  const [claims, setClaims] = useState(initialClaims);
  const [editingOffer, setEditingOffer] = useState<MentorOffer | null>(null);
  const [editingMethod, setEditingMethod] = useState<MentorPaymentMethod | null>(null);
  const [offerPending, setOfferPending] = useState(false);
  const [methodPending, setMethodPending] = useState(false);
  const [reviewingClaim, setReviewingClaim] = useState<string | null>(null);
  const [offerStatus, setOfferStatus] = useState("");
  const [methodStatus, setMethodStatus] = useState("");
  const [claimError, setClaimError] = useState("");

  async function submitOffer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setOfferPending(true);
    setOfferStatus("");
    const data = new FormData(form);
    try {
      const saved = await saveMentorOffer(createClient(), {
        id: editingOffer?.id,
        mentorId: initialSettings.profile.id,
        name: String(data.get("name") || ""),
        description: String(data.get("description") || ""),
        price: Number(data.get("price")),
        durationDays: Number(data.get("durationDays")),
        weeklyQuestions: Number(data.get("weeklyQuestions")),
        active: data.get("active") === "on",
        sortOrder: editingOffer?.sort_order,
      });
      setOffers((current) => [...current.filter((offer) => offer.id !== saved.id), saved].sort((a, b) => Number(a.sort_order || 100) - Number(b.sort_order || 100)));
      setEditingOffer(null);
      form.reset();
      setOfferStatus("服务方案已保存。");
    } catch (error) {
      setOfferStatus(friendlyError(error));
    } finally {
      setOfferPending(false);
    }
  }

  async function submitMethod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setMethodPending(true);
    setMethodStatus("");
    const data = new FormData(form);
    try {
      const saved = await saveMentorPaymentMethod(createClient(), {
        id: editingMethod?.id,
        mentorId: initialSettings.profile.id,
        kind: String(data.get("kind")) as MentorPaymentMethod["kind"],
        label: String(data.get("label") || ""),
        accountName: String(data.get("accountName") || ""),
        accountValue: String(data.get("accountValue") || ""),
        network: String(data.get("network") || ""),
        instructions: String(data.get("instructions") || ""),
        active: data.get("active") === "on",
        sortOrder: editingMethod?.sort_order,
      });
      setMethods((current) => [...current.filter((method) => method.id !== saved.id), saved].sort((a, b) => Number(a.sort_order || 100) - Number(b.sort_order || 100)));
      setEditingMethod(null);
      form.reset();
      setMethodStatus("收款方式已保存。");
    } catch (error) {
      setMethodStatus(friendlyError(error));
    } finally {
      setMethodPending(false);
    }
  }

  async function reviewClaim(claim: MentorPaymentClaim, confirm: boolean) {
    const action = confirm ? "确认已收到这笔款项并发放辅导权益" : "拒绝这条付款声明";
    if (!window.confirm(`${action}？`)) return;
    setReviewingClaim(claim.claim_id);
    setClaimError("");
    try {
      const threadId = await reviewMentorPaymentClaim(createClient(), claim.claim_id, confirm);
      setClaims((current) => current.map((item) => item.claim_id === claim.claim_id ? { ...item, status: confirm ? "confirmed" : "rejected", thread_id: threadId } : item));
    } catch (error) {
      setClaimError(friendlyError(error));
    } finally {
      setReviewingClaim(null);
    }
  }

  return (
    <div className="grid gap-8">
      <section className="grid gap-5" aria-labelledby="mentor-claims-title"><header><h2 id="mentor-claims-title" className="text-2xl font-semibold">待核对付款</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">只在实际到账后确认。确认会立即创建权益和专属会话，不能仅凭付款备注判断。</p></header>{claimError ? <FieldMessage role="alert">{claimError}</FieldMessage> : null}{claims.length ? <div className="grid gap-3">{claims.map((claim) => { const threadId = claim.thread_id; return <article key={claim.claim_id} className="grid gap-4 rounded-xl border bg-surface p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong>{claim.display_name}</strong>{claim.public_uid ? <Link href={`/member/${claim.public_uid}`} className="text-xs text-primary hover:underline">UID {claim.public_uid}</Link> : null}<span className={`rounded-md px-2 py-1 text-xs font-medium ${claim.status === "submitted" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>{claim.status === "submitted" ? "等待核对" : claim.status === "confirmed" ? "已确认" : claim.status === "rejected" ? "已拒绝" : "已取消"}</span></div><p className="mt-2 text-sm"><strong>{claim.offer_name}</strong><span className="ml-2 tabular-nums text-muted-foreground">{formatMentorPrice(claim.amount_cents, claim.currency)}</span></p><p className="mt-1 text-xs text-muted-foreground">{claim.payment_label || "未标记收款方式"}，提交于 {new Date(claim.submitted_at).toLocaleString("zh-CN")}</p>{claim.buyer_note ? <p className="mt-3 rounded-lg bg-muted p-3 text-sm leading-6">付款备注：{claim.buyer_note}</p> : null}</div><div className="flex flex-wrap gap-2">{claim.status === "submitted" ? <><Button type="button" variant="danger" size="small" disabled={reviewingClaim !== null} onClick={() => reviewClaim(claim, false)}><X aria-hidden size={16} />拒绝</Button><Button type="button" size="small" disabled={reviewingClaim !== null} onClick={() => reviewClaim(claim, true)}><Check aria-hidden size={16} />确认到账</Button></> : threadId ? <Button asChild size="small" variant="secondary"><Link href={`/tutoring/${threadId}`}>打开会话</Link></Button> : null}</div></article>; })}</div> : <div className="rounded-xl border border-dashed bg-surface p-6 text-sm text-muted-foreground">目前没有付款声明。</div>}</section>

      <section className="grid gap-5" aria-labelledby="mentor-students-title"><header><h2 id="mentor-students-title" className="text-2xl font-semibold">我的学员</h2><p className="mt-1 text-sm text-muted-foreground">这里只有当前导师账号的会话，不会因为管理员身份扩展到其他导师。</p></header>{initialStudents.length ? <div className="grid gap-3 sm:grid-cols-2">{initialStudents.map((student) => <Link key={student.thread_id} href={`/tutoring/${student.thread_id}`} className="grid gap-2 rounded-xl border bg-surface p-4 hover:border-primary/45"><div className="flex items-center justify-between gap-3"><strong className="truncate">{student.display_name}</strong><span className={`rounded-md px-2 py-1 text-xs ${student.access_status === "active" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>{student.access_status === "active" ? "辅导中" : "权益已结束"}</span></div><p className="truncate text-sm text-muted-foreground">{student.last_message || "还没有消息"}</p><span className="flex items-center gap-2 text-xs font-medium text-primary"><ChatsCircle aria-hidden size={16} />打开辅导会话</span></Link>)}</div> : <div className="rounded-xl border border-dashed bg-surface p-6 text-sm text-muted-foreground">确认第一笔付款并发放权益后，学员会出现在这里。</div>}</section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section className="grid content-start gap-5 rounded-xl border bg-surface p-5 md:p-6" aria-labelledby="mentor-offers-title"><header><h2 id="mentor-offers-title" className="text-xl font-semibold">服务方案</h2><p className="mt-1 text-sm text-muted-foreground">停用方案会从公开目录隐藏，但不会删除历史订单。</p></header>{offers.length ? <div className="grid gap-2">{offers.map((offer) => <article key={offer.id} className="flex items-center justify-between gap-4 rounded-lg bg-muted p-3"><div className="min-w-0"><strong className="block truncate text-sm">{offer.name}</strong><span className="text-xs text-muted-foreground">{formatMentorPrice(offer.price_cents, offer.currency)}，{offer.duration_days} 天，每周 {offer.weekly_questions} 次，{offer.active ? "已上架" : "已停用"}</span></div><Button type="button" variant="ghost" size="icon" aria-label={`编辑 ${offer.name}`} onClick={() => setEditingOffer(offer)}><PencilSimple aria-hidden size={17} /></Button></article>)}</div> : null}<form key={editingOffer?.id || "new-offer"} className="grid gap-4 border-t pt-5" onSubmit={submitOffer}><div className="flex items-center justify-between gap-3"><h3 className="font-semibold">{editingOffer ? "编辑方案" : "添加方案"}</h3>{editingOffer ? <Button type="button" variant="ghost" size="small" onClick={() => setEditingOffer(null)}>取消编辑</Button> : null}</div><Field><Label htmlFor="mentor-offer-name">服务名称</Label><Input id="mentor-offer-name" name="name" defaultValue={editingOffer?.name || ""} minLength={2} maxLength={80} required placeholder="30 天结构陪跑" /></Field><Field><Label htmlFor="mentor-offer-description">方案说明</Label><Textarea id="mentor-offer-description" name="description" defaultValue={editingOffer?.description || ""} rows={3} maxLength={5000} /></Field><div className="grid gap-4 sm:grid-cols-3"><Field><Label htmlFor="mentor-offer-price">价格（USDT）</Label><Input id="mentor-offer-price" name="price" type="number" min={0} step="0.01" defaultValue={editingOffer ? editingOffer.price_cents / 100 : ""} required /></Field><Field><Label htmlFor="mentor-offer-days">有效天数</Label><Input id="mentor-offer-days" name="durationDays" type="number" min={1} max={366} defaultValue={editingOffer?.duration_days || 30} required /></Field><Field><Label htmlFor="mentor-offer-weekly">每周次数</Label><Input id="mentor-offer-weekly" name="weeklyQuestions" type="number" min={1} max={100} defaultValue={editingOffer?.weekly_questions || 3} required /></Field></div><label className="flex items-center gap-2 text-sm font-medium"><input name="active" type="checkbox" defaultChecked={editingOffer?.active ?? true} className="accent-primary" />在公开目录上架</label>{offerStatus ? <p role="status" className="text-sm text-muted-foreground">{offerStatus}</p> : null}<Button type="submit" disabled={offerPending} className="w-fit"><Plus aria-hidden size={17} />{offerPending ? "正在保存" : editingOffer ? "保存方案" : "添加方案"}</Button></form></section>

        <section className="grid content-start gap-5 rounded-xl border bg-surface p-5 md:p-6" aria-labelledby="mentor-payments-title"><header><h2 id="mentor-payments-title" className="text-xl font-semibold">收款方式</h2><p className="mt-1 text-sm text-muted-foreground">停用后新买家不可见，已有付款声明仍保留原始引用。</p></header>{methods.length ? <div className="grid gap-2">{methods.map((method) => <article key={method.id} className="flex items-center justify-between gap-4 rounded-lg bg-muted p-3"><div className="min-w-0"><strong className="block truncate text-sm">{method.label}</strong><span className="block truncate text-xs text-muted-foreground">{method.account_value}，{method.active === false ? "已停用" : "可用"}</span></div><Button type="button" variant="ghost" size="icon" aria-label={`编辑 ${method.label}`} onClick={() => setEditingMethod(method)}><PencilSimple aria-hidden size={17} /></Button></article>)}</div> : null}<form key={editingMethod?.id || "new-method"} className="grid gap-4 border-t pt-5" onSubmit={submitMethod}><div className="flex items-center justify-between gap-3"><h3 className="font-semibold">{editingMethod ? "编辑收款方式" : "添加收款方式"}</h3>{editingMethod ? <Button type="button" variant="ghost" size="small" onClick={() => setEditingMethod(null)}>取消编辑</Button> : null}</div><div className="grid gap-4 sm:grid-cols-2"><Field><Label htmlFor="mentor-method-kind">类型</Label><select id="mentor-method-kind" name="kind" className={selectClassName} defaultValue={editingMethod?.kind || "binance"}>{paymentKinds.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field><Label htmlFor="mentor-method-label">显示名称</Label><Input id="mentor-method-label" name="label" defaultValue={editingMethod?.label || ""} minLength={2} maxLength={60} required placeholder="币安 UID" /></Field></div><Field><Label htmlFor="mentor-method-account-name">收款人或昵称</Label><Input id="mentor-method-account-name" name="accountName" defaultValue={editingMethod?.account_name || ""} maxLength={120} /></Field><Field><Label htmlFor="mentor-method-account-value">账号、UID 或地址</Label><Input id="mentor-method-account-value" name="accountValue" defaultValue={editingMethod?.account_value || ""} minLength={2} maxLength={240} required /></Field><Field><Label htmlFor="mentor-method-network">网络或币种</Label><Input id="mentor-method-network" name="network" defaultValue={editingMethod?.network || ""} maxLength={80} placeholder="TRC20" /></Field><Field><Label htmlFor="mentor-method-instructions">付款说明</Label><Textarea id="mentor-method-instructions" name="instructions" defaultValue={editingMethod?.instructions || ""} rows={3} maxLength={1000} /></Field><label className="flex items-center gap-2 text-sm font-medium"><input name="active" type="checkbox" defaultChecked={editingMethod?.active ?? true} className="accent-primary" />允许新买家选择</label>{methodStatus ? <p role="status" className="text-sm text-muted-foreground">{methodStatus}</p> : null}<Button type="submit" disabled={methodPending} className="w-fit"><Plus aria-hidden size={17} />{methodPending ? "正在保存" : editingMethod ? "保存收款方式" : "添加收款方式"}</Button></form></section>
      </div>
    </div>
  );
}
