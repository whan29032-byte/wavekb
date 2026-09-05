"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarCheck, Check, Coins, Medal, Notebook, Receipt, Storefront, Trophy } from "@phosphor-icons/react";
import { canRedeemReward, formatRewardPoints, rewardActionLabel, type RewardCenter as RewardCenterValue, type RewardLeaderboardEntry, type RewardProduct } from "@wavekb/domain";
import { Button, FieldMessage } from "@wavekb/ui";
import { createClient } from "@/lib/supabase/client";
import { IdentityName, IdentityPreview, Nameplate, type IdentityPreviewProfile } from "@/components/nameplate";
import { notifyIdentityChanged, subscribeIdentityChanges } from "@/lib/member/identity-events";
import { loadRewardCenter, rewardMutations } from "@/lib/rewards/client-repository";

const categoryLabels: Record<RewardProduct["category"], string> = { identity: "身份装扮", digital: "数字权益", service: "服务权益", physical: "实体商品" };

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/reward_balance_insufficient/i.test(message)) return "积分余额不足，请先完成签到或研究任务。";
  if (/product_unavailable|product_stock_insufficient/i.test(message)) return "商品已下架或库存不足，请刷新后重试。";
  if (/nameplate_expired|nameplate_not_found/i.test(message)) return "这枚铭牌已到期或不属于当前账号。";
  if (/auth|jwt|permission|row-level/i.test(message)) return "登录状态已失效，请重新登录。";
  return message || "操作没有完成，请稍后重试。";
}

type RewardCenterProps = { actorId: string; initialCenter: RewardCenterValue; leaderboard: RewardLeaderboardEntry[]; profile?: IdentityPreviewProfile };

export function RewardCenter(props: RewardCenterProps) {
  return <RewardCenterContent key={props.actorId} {...props} />;
}

function RewardCenterContent({ actorId, initialCenter, leaderboard, profile }: RewardCenterProps) {
  const router = useRouter();
  const [center, setCenter] = useState(initialCenter);
  const [centerSource, setCenterSource] = useState(initialCenter);
  if (centerSource !== initialCenter) {
    setCenterSource(initialCenter);
    setCenter(initialCenter);
  }
  const currentTitle = profile?.display_title || "";
  const [pending, setPending] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => subscribeIdentityChanges((id) => { if (id === actorId) router.refresh(); }), [actorId, router]);

  async function authenticatedActions() {
    const client = createClient();
    const auth = await client.auth.getUser();
    if (!auth.data.user || auth.data.user.id !== actorId) throw new Error("authentication_required");
    return { client, actions: rewardMutations(client) };
  }

  async function synchronizeCenter(client: ReturnType<typeof createClient>) {
    try {
      setCenter(await loadRewardCenter(client));
    } catch {
      // The mutation result remains authoritative; a later navigation will retry the full read.
    }
  }

  async function checkIn() {
    setPending("checkin");
    setStatus("");
    setError("");
    try {
      const { client, actions } = await authenticatedActions();
      const result = await actions.checkIn();
      setCenter((current) => ({ ...current, checked_today: true, streak: Number(result.streak || current.streak), wallet: { ...current.wallet, balance: Number(result.balance ?? current.wallet.balance) } }));
      setStatus(`签到成功，获得 ${formatRewardPoints(result.points || 0)}。`);
      await synchronizeCenter(client);
      router.refresh();
    } catch (checkinError) {
      setError(friendlyError(checkinError));
    } finally {
      setPending("");
    }
  }

  async function redeem(product: RewardProduct) {
    if (!window.confirm(`确认使用 ${formatRewardPoints(product.price_points)}兑换“${product.name}”？`)) return;
    setPending(`redeem:${product.id}`);
    setStatus("");
    setError("");
    try {
      const { client, actions } = await authenticatedActions();
      const result = await actions.redeem(product.id);
      notifyIdentityChanged(actorId);
      setCenter((current) => ({ ...current, wallet: { ...current.wallet, balance: Number(result.balance ?? current.wallet.balance) } }));
      setStatus(result.status === "fulfilled" ? `“${product.name}”已生效。` : `“${product.name}”兑换申请已提交，等待管理员处理。`);
      await synchronizeCenter(client);
      router.refresh();
    } catch (redeemError) {
      setError(friendlyError(redeemError));
    } finally {
      setPending("");
    }
  }

  async function equip(entitlementId: string, productName: string) {
    setPending(`equip:${entitlementId}`);
    setStatus("");
    setError("");
    try {
      const { client, actions } = await authenticatedActions();
      await actions.equip(entitlementId);
      notifyIdentityChanged(actorId);
      setCenter((current) => ({ ...current, nameplates: current.nameplates.map((item) => ({ ...item, equipped: item.id === entitlementId })) }));
      setStatus(`已佩戴“${productName}”。`);
      await synchronizeCenter(client);
      router.refresh();
    } catch (equipError) {
      setError(friendlyError(equipError));
    } finally {
      setPending("");
    }
  }

  return (
    <div className="grid gap-9">
      <section className="grid gap-6 rounded-xl border bg-surface p-6 md:grid-cols-[minmax(0,1.35fr)_minmax(17rem,.65fr)] md:p-8">
        <div className="grid content-center gap-4"><span className="flex items-center gap-2 text-sm font-semibold text-primary"><Medal aria-hidden size={19} weight="duotone" />积分权益</span><h1 className="max-w-[18ch] text-3xl font-semibold tracking-[-0.04em] md:text-5xl">把认真研究积累成长期权益</h1><p className="max-w-[64ch] text-sm leading-7 text-muted-foreground">签到、首次保存复盘和发布可核验内容都会写入服务端积分账本。兑换时由数据库锁定余额与库存，页面不会自行判定成交。</p><div className="flex flex-wrap gap-2"><Button asChild variant="secondary"><Link href="/workbench/entries/new?kind=review"><Notebook aria-hidden size={18} />去写复盘</Link></Button><Button asChild variant="ghost"><Link href="/member/profile">管理已拥有铭牌</Link></Button></div></div>
        <aside className="grid content-center gap-4 rounded-xl bg-muted p-5" aria-label="积分余额"><span className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><Coins aria-hidden size={19} className="text-primary" />可用积分</span><strong className="text-4xl tabular-nums">{new Intl.NumberFormat("zh-CN").format(center.wallet.balance)}</strong><span className="text-xs text-muted-foreground">累计获得 {formatRewardPoints(center.wallet.lifetime_earned)}</span><Button type="button" disabled={center.checked_today || pending === "checkin"} onClick={checkIn}><CalendarCheck aria-hidden size={18} />{center.checked_today ? "今日已签到" : pending === "checkin" ? "正在签到" : "立即签到"}</Button><span className="text-center text-xs text-muted-foreground">当前连续 {center.streak} 天</span></aside>
      </section>

      <div aria-live="polite" className="min-h-6">{error ? <FieldMessage role="alert">{error}</FieldMessage> : status ? <p className="text-sm font-medium text-primary">{status}</p> : null}</div>

      <section className="grid gap-5" aria-labelledby="reward-missions-title"><header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><span className="text-xs font-semibold text-primary">成长任务</span><h2 id="reward-missions-title" className="mt-1 text-2xl font-semibold">每篇内容首次奖励，签到每天一次</h2></div><Button asChild variant="secondary" size="small"><Link href="/community/idea_sharing/new">发表研究内容</Link></Button></header><div className="overflow-hidden rounded-xl border bg-surface">{[
        ["每日签到", center.checked_today ? "今日已完成" : "每天一次", "+5 至 11", center.checked_today],
        ["完成复盘", "每篇复盘首次保存奖励", "+20", null],
        ["发表思路", "每篇思路首次发布奖励", "+12", null],
        ["提交案例", "每篇案例首次发布奖励", "+15", null],
      ].map(([title, copy, points, done], index) => <div key={String(title)} className={`grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,.5fr)_auto] sm:items-center ${index ? "border-t" : ""}`}><strong className="flex items-center gap-2 text-sm">{done ? <Check aria-hidden size={17} className="text-primary" /> : <span aria-hidden className="size-2 rounded-full bg-border" />}{title}</strong><span className="text-xs text-muted-foreground">{copy}</span><b className="text-sm tabular-nums text-primary">{points}</b></div>)}</div></section>

      <section className="grid gap-5" aria-labelledby="reward-store-title"><header><span className="flex items-center gap-2 text-xs font-semibold text-primary"><Storefront aria-hidden size={17} />积分商城</span><h2 id="reward-store-title" className="mt-1 text-2xl font-semibold">兑换身份与服务权益</h2><p className="mt-1 text-sm text-muted-foreground">铭牌和称号会立即生效，服务与实物权益进入待处理订单。</p></header>{center.products.length ? <div className="grid gap-4 md:grid-cols-2">{center.products.map((product) => { const entitlement = product.product_type === "nameplate" ? center.nameplates.find((item) => item.product_id === product.id && new Date(item.expires_at).getTime() > Date.now()) : undefined; const currentTitleProduct = product.product_type === "title" && Boolean(currentTitle) && product.metadata.display_title === currentTitle; const availability = canRedeemReward(product, center.wallet.balance); const working = pending === `redeem:${product.id}` || (entitlement ? pending === `equip:${entitlement.id}` : false); return <article key={product.id} className="grid gap-5 rounded-xl border bg-surface p-5"><div className="flex items-start gap-4"><span className="grid size-12 shrink-0 place-items-center rounded-xl bg-muted text-primary">{product.product_type === "nameplate" ? <Medal aria-hidden size={24} weight="duotone" /> : product.product_type === "service" ? <Storefront aria-hidden size={24} weight="duotone" /> : <Receipt aria-hidden size={24} weight="duotone" />}</span><div className="min-w-0"><span className="text-xs font-semibold text-primary">{categoryLabels[product.category] || "积分权益"}</span><h3 className="mt-1 text-lg font-semibold">{product.name}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{product.summary || product.description || "使用积分兑换。"}</p></div></div>{product.product_type === "nameplate" && typeof product.metadata.nameplate_style === "string" ? <IdentityPreview style={product.metadata.nameplate_style} profile={profile} /> : null}{product.image_url ? <div className="overflow-hidden rounded-lg bg-muted"><img src={product.image_url} alt={product.name} className="h-36 w-full object-cover" loading="lazy" /></div> : null}<footer className="mt-auto flex items-center justify-between gap-4 border-t pt-4"><div><strong className="block tabular-nums">{formatRewardPoints(product.price_points)}</strong><span className="text-xs text-muted-foreground">{product.stock < 0 ? "不限量" : `库存 ${product.stock}`}</span></div>{currentTitleProduct ? <Button type="button" variant="secondary" disabled>当前称号</Button> : entitlement ? <Button type="button" variant={entitlement.equipped ? "secondary" : "primary"} disabled={entitlement.equipped || Boolean(pending)} onClick={() => equip(entitlement.id, entitlement.product_name)}>{entitlement.equipped ? "当前佩戴" : working ? "正在佩戴" : "佩戴"}</Button> : <Button type="button" disabled={!availability.ok || Boolean(pending)} onClick={() => redeem(product)}>{working ? "正在兑换" : availability.reason === "sold_out" ? "暂时缺货" : availability.reason === "insufficient" ? "积分不足" : "立即兑换"}</Button>}</footer></article>; })}</div> : <div className="rounded-xl border border-dashed bg-surface p-7 text-sm text-muted-foreground">管理员上架商品后会显示在这里。</div>}</section>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,.95fr)]">
        <section className="grid content-start gap-4" aria-labelledby="reward-leaderboard-title"><header className="flex items-center gap-3"><Trophy aria-hidden size={22} weight="duotone" className="text-primary" /><div><h2 id="reward-leaderboard-title" className="text-xl font-semibold">积分排行榜</h2><p className="text-xs text-muted-foreground">按累计获得积分排序。</p></div></header><div className="overflow-hidden rounded-xl border bg-surface">{leaderboard.length ? leaderboard.map((item, index) => <Link key={item.user_id} href={`/member/${item.public_uid}`} className={`grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 hover:bg-muted ${index ? "border-t" : ""}`}><strong className="text-center text-sm tabular-nums text-muted-foreground">{item.rank_no || index + 1}</strong><span className="min-w-0"><IdentityName profile={item} as="strong" className="block truncate text-sm" /><Nameplate uid={item.public_uid} style={item.nameplate_style} compact /></span><strong className="text-sm tabular-nums">{new Intl.NumberFormat("zh-CN").format(item.lifetime_earned)}</strong></Link>) : <p className="p-6 text-sm text-muted-foreground">完成第一次任务后，排行会出现在这里。</p>}</div></section>

        <section className="grid content-start gap-4" aria-labelledby="reward-ledger-title"><header className="flex items-center gap-3"><Receipt aria-hidden size={22} weight="duotone" className="text-primary" /><div><h2 id="reward-ledger-title" className="text-xl font-semibold">积分账本</h2><p className="text-xs text-muted-foreground">最近 20 条收入与支出。</p></div></header><div className="overflow-hidden rounded-xl border bg-surface">{center.ledger.length ? center.ledger.map((item, index) => <article key={item.id} className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3 ${index ? "border-t" : ""}`}><div className="min-w-0"><strong className="block truncate text-sm">{rewardActionLabel(item.action_key)}</strong><span className="block truncate text-xs text-muted-foreground">{item.note}</span><time dateTime={item.created_at} className="block text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString("zh-CN")}</time></div><strong className={`text-sm tabular-nums ${item.points >= 0 ? "text-primary" : "text-foreground"}`}>{item.points > 0 ? "+" : ""}{item.points}</strong></article>) : <p className="p-6 text-sm text-muted-foreground">完成签到、复盘或发布后会生成第一条记录。</p>}</div></section>
      </div>
    </div>
  );
}
