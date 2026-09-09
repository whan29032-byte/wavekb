"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Gift, Plus, Receipt, SealCheck } from "@phosphor-icons/react";
import { formatLotteryProbability } from "@wavekb/domain";
import { Button, Field, FieldMessage, Input, Label, Textarea } from "@wavekb/ui";
import { adminRewardLotteryMutations, loadAdminRewardLottery } from "@/lib/admin/reward-lottery-client-repository";
import type { AdminRewardLotteryCampaign, AdminRewardLotteryDraw, AdminRewardLotteryStore, RewardLotteryCampaignInput, RewardLotteryPrizeInput } from "@/lib/admin/reward-lottery-types";
import { createClient } from "@/lib/supabase/client";

type LotteryActions = ReturnType<typeof adminRewardLotteryMutations>;
const selectClass = "h-11 w-full rounded-lg border border-input bg-surface px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-60";

function inputDate(value?: string): string {
  const date = value ? new Date(value) : new Date();
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/admin_required|permission|jwt/i.test(message)) return "当前账号没有抽奖管理权限。";
  if (/campaign_conflict/i.test(message)) return "已有一个开放中的活动，请先关闭后再开启新活动。";
  if (/configuration_invalid/i.test(message)) return "奖池配置无效，请检查奖品数量与概率合计。";
  if (/not_editable/i.test(message)) return "只有草稿活动可以修改。";
  return message || "抽奖后台操作没有完成，请稍后重试。";
}

function CampaignEditor({ campaign, pending, onSave }: { campaign?: AdminRewardLotteryCampaign; pending: boolean; onSave: (input: RewardLotteryCampaignInput) => Promise<boolean> }) {
  const defaultEnd = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const [title, setTitle] = useState(campaign?.title ?? "");
  const [description, setDescription] = useState(campaign?.description ?? "");
  const [imageUrl, setImageUrl] = useState(campaign?.image_url ?? "");
  const [cost, setCost] = useState(String(campaign?.entry_cost_points ?? 100));
  const [startsAt, setStartsAt] = useState(inputDate(campaign?.starts_at));
  const [endsAt, setEndsAt] = useState(inputDate(campaign?.ends_at ?? defaultEnd));
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const points = Number(cost);
    const start = new Date(startsAt);
    const end = new Date(endsAt);
    if (title.trim().length < 2 || title.trim().length > 80) return setError("活动名称应为 2 至 80 个字符。");
    if (!Number.isInteger(points) || points < 1 || points > 100000) return setError("每次消耗积分应为 1 至 100000 的整数。");
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return setError("结束时间必须晚于开始时间。");
    if (imageUrl.trim()) {
      try { if (new URL(imageUrl.trim()).protocol !== "https:") return setError("活动图片必须使用 HTTPS 地址。"); }
      catch { return setError("活动图片 URL 格式不正确。"); }
    }
    setError("");
    await onSave({ id: campaign?.id, title: title.trim(), description: description.trim(), imageUrl, entryCostPoints: points, startsAt: start.toISOString(), endsAt: end.toISOString() });
  }

  return <form className="grid gap-4" onSubmit={submit}>
    <div className="grid gap-3 md:grid-cols-2"><Field><Label htmlFor="lottery-campaign-title">活动名称</Label><Input id="lottery-campaign-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} required /></Field><Field><Label htmlFor="lottery-campaign-cost">每次消耗积分</Label><Input id="lottery-campaign-cost" type="number" min={1} max={100000} step={1} value={cost} onChange={(event) => setCost(event.target.value)} required /></Field></div>
    <Field><Label htmlFor="lottery-campaign-description">活动说明</Label><Textarea id="lottery-campaign-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} /></Field>
    <div className="grid gap-3 md:grid-cols-2"><Field><Label htmlFor="lottery-campaign-start">开始时间</Label><Input id="lottery-campaign-start" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required /></Field><Field><Label htmlFor="lottery-campaign-end">结束时间</Label><Input id="lottery-campaign-end" type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} required /></Field></div>
    <Field><Label htmlFor="lottery-campaign-image">活动图片 URL</Label><Input id="lottery-campaign-image" type="url" value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="可选，HTTPS 地址" /></Field>
    {error ? <FieldMessage role="alert">{error}</FieldMessage> : null}
    <div className="flex justify-end border-t pt-4"><Button type="submit" disabled={pending}>{campaign ? "保存活动" : "创建活动"}</Button></div>
  </form>;
}

function PrizeEditor({ campaignId, existingProbability, pending, onSave }: { campaignId: string; existingProbability: number; pending: boolean; onSave: (input: RewardLotteryPrizeInput) => Promise<boolean> }) {
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [probability, setProbability] = useState("1.00");
  const [stock, setStock] = useState("1");
  const [fulfillment, setFulfillment] = useState<"points" | "manual">("manual");
  const [rewardPoints, setRewardPoints] = useState("50");
  const [sortOrder, setSortOrder] = useState("100");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const percent = Number(probability);
    const inventory = Number(stock);
    const order = Number(sortOrder);
    const points = Number(rewardPoints);
    if (name.trim().length < 2 || name.trim().length > 80) return setError("奖品名称应为 2 至 80 个字符。");
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(probability) || percent < 0.01 || percent > 100) return setError("中奖概率应为 0.01% 至 100.00%，最多两位小数。");
    const basisPoints = Math.round(percent * 100);
    if (existingProbability + basisPoints > 10000) return setError("奖品概率合计不能超过 100.00%。");
    if (!Number.isInteger(inventory) || inventory < 0) return setError("奖品库存必须是大于或等于 0 的整数。");
    if (!Number.isInteger(order)) return setError("排序必须是整数。");
    if (fulfillment === "points" && (!Number.isInteger(points) || points <= 0)) return setError("积分奖品数量必须是正整数。");
    setError("");
    const saved = await onSave({ campaignId, name: name.trim(), summary: summary.trim(), imageUrl: null, probabilityBps: basisPoints, stockTotal: inventory, fulfillmentType: fulfillment, rewardPoints: fulfillment === "points" ? points : null, sortOrder: order });
    if (saved) { setName(""); setSummary(""); setProbability("1.00"); setStock("1"); }
  }

  return <form className="grid gap-4 rounded-xl border bg-surface p-4 md:p-5" noValidate onSubmit={submit}>
    <div className="grid gap-3 md:grid-cols-2"><Field><Label htmlFor="lottery-prize-name">奖品名称</Label><Input id="lottery-prize-name" value={name} onChange={(event) => setName(event.target.value)} required /></Field><Field><Label htmlFor="lottery-prize-summary">奖品说明</Label><Input id="lottery-prize-summary" value={summary} onChange={(event) => setSummary(event.target.value)} /></Field></div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field><Label htmlFor="lottery-prize-probability">中奖概率（%）</Label><Input id="lottery-prize-probability" inputMode="decimal" value={probability} onChange={(event) => setProbability(event.target.value)} required /></Field>
      <Field><Label htmlFor="lottery-prize-stock">奖品库存</Label><Input id="lottery-prize-stock" type="number" min={0} step={1} value={stock} onChange={(event) => setStock(event.target.value)} required /></Field>
      <Field><Label htmlFor="lottery-prize-fulfillment">发放方式</Label><select id="lottery-prize-fulfillment" className={selectClass} value={fulfillment} onChange={(event) => setFulfillment(event.target.value as "points" | "manual")}><option value="manual">管理员人工发放</option><option value="points">积分自动到账</option></select></Field>
      <Field><Label htmlFor="lottery-prize-order">排序</Label><Input id="lottery-prize-order" type="number" step={1} value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} /></Field>
    </div>
    {fulfillment === "points" ? <Field><Label htmlFor="lottery-prize-points">奖励积分</Label><Input id="lottery-prize-points" type="number" min={1} step={1} value={rewardPoints} onChange={(event) => setRewardPoints(event.target.value)} required /></Field> : null}
    {error ? <FieldMessage role="alert">{error}</FieldMessage> : null}
    <div className="flex items-center justify-between gap-4 border-t pt-4"><span className="text-xs text-muted-foreground">添加后奖品总概率不得超过 100.00%</span><Button type="submit" disabled={pending}><Plus aria-hidden size={17} />添加奖品</Button></div>
  </form>;
}

function FulfillmentRow({ draw, pending, onFulfill }: { draw: AdminRewardLotteryDraw; pending: boolean; onFulfill: (note: string) => Promise<boolean> }) {
  const [note, setNote] = useState("");
  const prizeName = String(draw.prize?.name || "人工奖品");
  return <article className="grid gap-3 border-t p-4 first:border-t-0 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,.8fr)_auto] lg:items-center"><div><strong className="block">{prizeName}</strong><span className="text-xs text-muted-foreground">UID {draw.public_uid ?? "未设置"} · {new Date(draw.created_at).toLocaleString("zh-CN")}</span></div><Input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="填写发放方式或兑换码" aria-label={`${prizeName}发放备注`} /><Button type="button" variant="secondary" disabled={pending || note.trim().length < 2} onClick={() => void onFulfill(note.trim())}>确认发放</Button></article>;
}

export function AdminRewardLottery({ actorId, initialStore }: { actorId: string; initialStore: AdminRewardLotteryStore }) {
  const router = useRouter();
  const [store, setStore] = useState(initialStore);
  const [source, setSource] = useState(initialStore);
  const initialCampaign = initialStore.campaigns.find((item) => item.status === "active") ?? initialStore.campaigns.find((item) => item.status === "draft") ?? initialStore.campaigns[0];
  const [selectedId, setSelectedId] = useState(initialCampaign?.id ?? "new");
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  if (source !== initialStore) {
    setSource(initialStore); setStore(initialStore);
    if (selectedId !== "new" && !initialStore.campaigns.some((item) => item.id === selectedId)) setSelectedId(initialStore.campaigns[0]?.id ?? "new");
  }

  const campaign = store.campaigns.find((item) => item.id === selectedId);
  const prizes = useMemo(() => store.prizes.filter((item) => item.campaign_id === campaign?.id).sort((a, b) => a.sort_order - b.sort_order), [store.prizes, campaign?.id]);
  const probabilityTotal = prizes.reduce((sum, item) => sum + item.probability_bps, 0);
  const pendingDraws = store.draws.filter((item) => item.fulfillment_status === "pending");

  async function authenticatedActions(): Promise<{ client: ReturnType<typeof createClient>; actions: LotteryActions }> {
    const client = createClient();
    const auth = await client.auth.getUser();
    if (!auth.data.user || auth.data.user.id !== actorId) throw new Error("authentication_required");
    return { client, actions: adminRewardLotteryMutations(client) };
  }

  async function run(key: string, task: (actions: LotteryActions) => Promise<unknown>, success: string): Promise<boolean> {
    setPending(key); setError(""); setStatus("");
    try {
      const { client, actions } = await authenticatedActions();
      await task(actions);
      try { setStore(await loadAdminRewardLottery(client)); } catch { /* Mutation succeeded; route refresh retries. */ }
      setStatus(success); router.refresh(); return true;
    } catch (mutationError) {
      setError(friendlyError(mutationError)); return false;
    } finally { setPending(""); }
  }

  async function saveCampaign(input: RewardLotteryCampaignInput) {
    return run("campaign", async (actions) => { const id = await actions.upsertCampaign(input); setSelectedId(id); }, input.id ? "活动设置已保存。" : "抽奖活动已创建，请继续添加奖品。");
  }

  async function activate() {
    if (!campaign) return;
    if (!prizes.length || probabilityTotal < 1 || probabilityTotal > 10000) { setError("开启前至少添加一个奖品，奖品概率合计不得超过 100.00%。"); return; }
    if (!window.confirm(`确认开启“${campaign.title}”？开启后活动和奖品不可修改。`)) return;
    await run(`status:${campaign.id}`, (actions) => actions.setStatus(campaign.id, "active"), "抽奖活动已开启。立即生效时间仍以设置的开始时间为准。");
  }

  async function close() {
    if (!campaign || !window.confirm(`确认关闭“${campaign.title}”？关闭后不能恢复。`)) return;
    await run(`status:${campaign.id}`, (actions) => actions.setStatus(campaign.id, "closed"), "抽奖活动已关闭。");
  }

  return <section className="grid gap-6 rounded-xl border bg-muted/25 p-4 md:p-6" aria-labelledby="admin-lottery-title">
    <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><span className="flex items-center gap-2 text-xs font-semibold text-primary"><Gift aria-hidden size={18} weight="duotone" />独立抽奖系统</span><h2 id="admin-lottery-title" className="mt-1 text-2xl font-semibold">单活动翻牌抽奖</h2><p className="mt-1 max-w-[72ch] text-sm leading-6 text-muted-foreground">奖池与积分商城商品分开维护；每位已激活 UID 的用户仅可参与一次，概率和库存会在数据库事务内锁定。</p></div><div className="flex flex-wrap gap-2"><select className={`${selectClass} min-w-48`} aria-label="选择抽奖活动" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}><option value="new">新建活动</option>{store.campaigns.map((item) => <option key={item.id} value={item.id}>{item.title}（{item.status === "draft" ? "草稿" : item.status === "active" ? "开放中" : "已关闭"}）</option>)}</select><Button type="button" variant="secondary" onClick={() => setSelectedId("new")}><Plus aria-hidden size={17} />新建</Button></div></header>
    <div aria-live="polite" className="min-h-6">{error ? <FieldMessage role="alert">{error}</FieldMessage> : status ? <p className="text-sm font-medium text-primary">{status}</p> : null}</div>
    {selectedId === "new" || campaign?.status === "draft" ? <div className="rounded-xl border bg-surface p-4 md:p-5"><CampaignEditor key={campaign?.id ?? "new"} campaign={campaign} pending={pending === "campaign"} onSave={saveCampaign} /></div> : campaign ? <div className="grid gap-3 rounded-xl border bg-surface p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><strong className="text-lg">{campaign.title}</strong><p className="mt-1 text-sm text-muted-foreground">{campaign.description}</p></div><span className="rounded-md bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">{campaign.status === "active" ? "开放中" : "已关闭"}</span></div><dl className="grid gap-3 border-t pt-3 text-sm sm:grid-cols-3"><div><dt className="text-xs text-muted-foreground">每次消耗</dt><dd className="mt-1 font-semibold">{campaign.entry_cost_points} 积分</dd></div><div><dt className="text-xs text-muted-foreground">开始</dt><dd className="mt-1">{new Date(campaign.starts_at).toLocaleString("zh-CN")}</dd></div><div><dt className="text-xs text-muted-foreground">结束</dt><dd className="mt-1">{new Date(campaign.ends_at).toLocaleString("zh-CN")}</dd></div></dl></div> : null}
    {campaign ? <section className="grid gap-4" aria-labelledby="lottery-pool-title"><header className="flex flex-wrap items-end justify-between gap-3"><div><h3 id="lottery-pool-title" className="text-lg font-semibold">奖池</h3><p className="mt-1 text-sm text-muted-foreground">当前中奖概率 {formatLotteryProbability(probabilityTotal)} · 未中奖概率 {formatLotteryProbability(10000 - Math.min(10000, probabilityTotal))}</p></div>{campaign.status === "draft" ? <Button type="button" disabled={Boolean(pending)} onClick={() => void activate()}><SealCheck aria-hidden size={17} />开启活动</Button> : campaign.status === "active" ? <Button type="button" variant="danger" disabled={Boolean(pending)} onClick={() => void close()}>关闭活动</Button> : null}</header><div className="overflow-hidden rounded-xl border bg-surface">{prizes.length ? prizes.map((prize, index) => <article key={prize.id} className={`grid gap-2 p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center ${index ? "border-t" : ""}`}><div><strong>{prize.name}</strong><span className="block text-xs text-muted-foreground">{prize.summary || (prize.fulfillment_type === "points" ? "积分自动到账" : "管理员人工发放")}</span></div><strong className="text-sm tabular-nums">{formatLotteryProbability(prize.probability_bps)}</strong><span className="text-xs text-muted-foreground">剩余 {prize.stock_remaining} / {prize.stock_total}</span></article>) : <p className="p-5 text-sm text-muted-foreground">尚未添加奖品。</p>}</div>{campaign.status === "draft" ? <PrizeEditor campaignId={campaign.id} existingProbability={probabilityTotal} pending={pending === "prize"} onSave={(input) => run("prize", (actions) => actions.upsertPrize(input), "奖品已添加。")} /> : <p className="text-xs text-muted-foreground">活动开启后配置已锁定，避免运行期间概率变化。</p>}</section> : null}
    <section className="grid gap-3" aria-labelledby="lottery-fulfillment-title"><header><span className="flex items-center gap-2 text-xs font-semibold text-primary"><Receipt aria-hidden size={17} />中奖发放</span><h3 id="lottery-fulfillment-title" className="mt-1 text-lg font-semibold">待人工处理</h3></header><div className="overflow-hidden rounded-xl border bg-surface">{pendingDraws.length ? pendingDraws.map((draw) => <FulfillmentRow key={draw.id} draw={draw} pending={pending === `draw:${draw.id}`} onFulfill={(note) => run(`draw:${draw.id}`, (actions) => actions.fulfillDraw(draw.id, note), "奖品已标记为发放完成。")} />) : <p className="p-5 text-sm text-muted-foreground">当前没有待发放奖品。</p>}</div></section>
  </section>;
}
