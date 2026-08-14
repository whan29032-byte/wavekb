"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, Coins, Medal, Package, Plus, Prohibit, Receipt, UserCircle } from "@phosphor-icons/react";
import { Button, Field, FieldMessage, Input, Label, Textarea } from "@wavekb/ui";
import { adminRewardMutations, loadAdminRewardStore } from "@/lib/admin/rewards-client-repository";
import type { AdminRewardProduct, AdminRewardRedemption, AdminRewardStore, AdminRewardWallet, RewardProductInput } from "@/lib/admin/rewards-types";
import { createClient } from "@/lib/supabase/client";

type RewardActions = ReturnType<typeof adminRewardMutations>;

const controlClass = "h-11 w-full rounded-lg border border-input bg-surface px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-60";
const nameplateStyles = ["blackgold", "platinum", "purplegold", "rainbow", "newyear"] as const;
const redemptionLabels = { pending: "待处理", fulfilled: "已发放", cancelled: "已取消", refunded: "已退款" } as const;

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/admin_required|permission|row-level|jwt/i.test(message)) return "当前登录状态没有管理员权限，请重新登录后再试。";
  if (/reward_balance_insufficient/i.test(message)) return "扣减后余额不能小于零。";
  if (/reward_adjustment_note_required/i.test(message)) return "请填写至少 2 个字符的积分调整原因。";
  if (/reward_adjustment_invalid/i.test(message)) return "积分变更必须是绝对值不超过 100000 的非零整数。";
  if (/product_name_invalid/i.test(message)) return "商品名称应为 2 至 80 个字符。";
  if (/product_value_invalid/i.test(message)) return "商品积分必须大于 0，库存只能是 -1 或非负整数。";
  if (/duration_invalid/i.test(message)) return "铭牌有效期应在 1 至 3650 天之间。";
  if (/nameplate_product_not_found/i.test(message)) return "选择的铭牌商品不存在。";
  return message || "后台积分操作没有完成。";
}

function ProductEditor({ product, pending, onSave }: { product?: AdminRewardProduct; pending: boolean; onSave: (input: RewardProductInput) => Promise<boolean> }) {
  const [name, setName] = useState(product?.name || "");
  const [summary, setSummary] = useState(product?.summary || "");
  const [description, setDescription] = useState(product?.description || "");
  const [imageUrl, setImageUrl] = useState(product?.image_url || "");
  const [category, setCategory] = useState<AdminRewardProduct["category"]>(product?.category || "identity");
  const [productType, setProductType] = useState<AdminRewardProduct["product_type"]>(product?.product_type || "nameplate");
  const [pricePoints, setPricePoints] = useState(String(product?.price_points ?? 100));
  const [stock, setStock] = useState(String(product?.stock ?? -1));
  const [sortOrder, setSortOrder] = useState(String(product?.sort_order ?? 100));
  const [active, setActive] = useState(product?.active ?? true);
  const [nameplateStyle, setNameplateStyle] = useState(String(product?.metadata?.nameplate_style || "blackgold"));
  const [durationDays, setDurationDays] = useState(String(product?.metadata?.duration_days || 30));
  const [displayTitle, setDisplayTitle] = useState(String(product?.metadata?.display_title || ""));
  const [localError, setLocalError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const points = Number(pricePoints);
    const inventory = Number(stock);
    const order = Number(sortOrder);
    if (name.trim().length < 2 || name.trim().length > 80) return setLocalError("商品名称应为 2 至 80 个字符。");
    if (!Number.isInteger(points) || points <= 0 || !Number.isInteger(inventory) || inventory < -1 || !Number.isInteger(order)) return setLocalError("请检查积分、库存和排序值；库存 -1 表示不限量。");
    if (imageUrl.trim()) {
      try {
        if (new URL(imageUrl.trim()).protocol !== "https:") return setLocalError("展示图必须使用 HTTPS 地址。");
      } catch {
        return setLocalError("展示图 URL 格式不正确。");
      }
    }
    const metadata: Record<string, unknown> = productType === "nameplate"
      ? { nameplate_style: nameplateStyle, duration_days: Number(durationDays) }
      : productType === "title" ? { display_title: displayTitle.trim() } : {};
    if (productType === "nameplate" && (!Number.isInteger(Number(durationDays)) || Number(durationDays) < 1 || Number(durationDays) > 3650)) return setLocalError("铭牌有效期应为 1 至 3650 天的整数。");
    if (productType === "title" && (!displayTitle.trim() || displayTitle.trim().length > 24)) return setLocalError("身份称号应为 1 至 24 个字符。");
    setLocalError("");
    const saved = await onSave({ id: product?.id, name: name.trim(), summary, description, imageUrl, category, productType, pricePoints: points, stock: inventory, metadata, active, sortOrder: order });
    if (!saved) return;
    if (!product) {
      setName(""); setSummary(""); setDescription(""); setImageUrl(""); setPricePoints("100"); setStock("-1"); setSortOrder("100");
    }
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field><Label htmlFor={`reward-name-${product?.id || "new"}`}>商品名称</Label><Input id={`reward-name-${product?.id || "new"}`} value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required /></Field>
        <Field><Label htmlFor={`reward-summary-${product?.id || "new"}`}>一句话说明</Label><Input id={`reward-summary-${product?.id || "new"}`} value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={160} /></Field>
      </div>
      <Field><Label htmlFor={`reward-description-${product?.id || "new"}`}>完整说明</Label><Textarea id={`reward-description-${product?.id || "new"}`} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} className="min-h-24" /></Field>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field><Label>分类</Label><select className={controlClass} value={category} onChange={(event) => setCategory(event.target.value as AdminRewardProduct["category"])}><option value="identity">身份装扮</option><option value="digital">数字权益</option><option value="service">服务权益</option><option value="physical">实体商品</option></select></Field>
        <Field><Label>交付类型</Label><select className={controlClass} value={productType} onChange={(event) => setProductType(event.target.value as AdminRewardProduct["product_type"])}><option value="nameplate">动态铭牌</option><option value="title">身份称号</option><option value="digital">数字权益</option><option value="service">人工服务</option><option value="physical">实体商品</option></select></Field>
        <Field><Label>兑换积分</Label><Input type="number" min={1} step={1} value={pricePoints} onChange={(event) => setPricePoints(event.target.value)} required /></Field>
        <Field><Label>库存</Label><Input type="number" min={-1} step={1} value={stock} onChange={(event) => setStock(event.target.value)} aria-describedby={`reward-stock-help-${product?.id || "new"}`} /><span id={`reward-stock-help-${product?.id || "new"}`} className="text-xs text-muted-foreground">-1 表示不限量</span></Field>
      </div>
      {productType === "nameplate" ? <div className="grid gap-3 sm:grid-cols-2"><Field><Label>铭牌样式</Label><select className={controlClass} value={nameplateStyle} onChange={(event) => setNameplateStyle(event.target.value)}>{nameplateStyles.map((style) => <option key={style} value={style}>{style}</option>)}</select></Field><Field><Label>兑换有效天数</Label><Input type="number" min={1} max={3650} step={1} value={durationDays} onChange={(event) => setDurationDays(event.target.value)} /></Field></div> : null}
      {productType === "title" ? <Field><Label>兑换后称号</Label><Input value={displayTitle} onChange={(event) => setDisplayTitle(event.target.value)} maxLength={24} required /></Field> : null}
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end">
        <Field><Label>展示图 URL</Label><Input type="url" value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} maxLength={2048} placeholder="可选，必须使用 HTTPS" /></Field>
        <Field><Label>排序</Label><Input type="number" step={1} value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} /></Field>
        <label className="flex min-h-11 items-center gap-2 rounded-lg border bg-background px-3 text-sm font-medium"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />前台展示</label>
      </div>
      {localError ? <FieldMessage role="alert">{localError}</FieldMessage> : null}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"><span className="text-xs text-muted-foreground">商品不做物理删除，下架请关闭“前台展示”。</span><Button type="submit" disabled={pending}>{product ? "保存商品" : <><Plus aria-hidden size={17} />新建商品</>}</Button></div>
    </form>
  );
}

function WalletRow({ wallet, products, pending, onAdjust, onGrant }: { wallet: AdminRewardWallet; products: AdminRewardProduct[]; pending: boolean; onAdjust: (delta: number, note: string) => Promise<boolean>; onGrant: (productId: string, days: number, equip: boolean) => Promise<boolean> }) {
  const [delta, setDelta] = useState("");
  const [note, setNote] = useState("");
  const [productId, setProductId] = useState("");
  const [days, setDays] = useState("30");
  const [equip, setEquip] = useState(true);
  const [error, setError] = useState("");
  const name = wallet.display_name || "未命名用户";

  async function adjust() {
    const amount = Number(delta);
    if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 100000) return setError("请输入绝对值不超过 100000 的非零整数。");
    if (note.trim().length < 2) return setError("请填写至少 2 个字符的积分调整原因。");
    if (!window.confirm(`确认将 ${name} 的积分调整 ${amount > 0 ? "+" : ""}${amount}？`)) return;
    setError("");
    if (!await onAdjust(amount, note.trim())) return;
    setDelta(""); setNote("");
  }

  async function grant() {
    const duration = Number(days);
    if (!productId) return setError("请先选择铭牌商品。");
    if (!Number.isInteger(duration) || duration < 1 || duration > 3650) return setError("有效期应在 1 至 3650 天之间。");
    const product = products.find((item) => item.id === productId);
    if (!window.confirm(`确认向 ${name} 发放“${product?.name || "铭牌"}”${duration} 天${equip ? "并立即佩戴" : ""}？`)) return;
    setError("");
    if (!await onGrant(productId, duration, equip)) return;
    setProductId("");
  }

  return (
    <details className="group overflow-hidden rounded-xl border bg-surface">
      <summary className="grid cursor-pointer list-none gap-3 p-4 marker:hidden sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
        <span className="min-w-0"><strong className="block truncate">{name}</strong><span className="text-xs text-muted-foreground">UID {wallet.public_uid || "待设置"} · {wallet.display_title || "普通研究者"}</span></span>
        <span className="text-sm"><span className="block text-xs text-muted-foreground">当前余额</span><strong className="tabular-nums">{wallet.balance.toLocaleString("zh-CN")}</strong></span>
        <span className="rounded-lg border px-3 py-2 text-center text-sm font-medium group-open:border-primary/45 group-open:text-primary">调整</span>
      </summary>
      <div className="grid gap-5 border-t bg-muted/45 p-4 lg:grid-cols-2">
        <section className="grid content-start gap-3"><header><h3 className="font-semibold">调整积分</h3><p className="mt-1 text-xs text-muted-foreground">正数增加，负数扣减；原因会写入该用户积分账本。</p></header><div className="grid gap-3 sm:grid-cols-[9rem_minmax(0,1fr)_auto]"><Input type="number" step={1} value={delta} onChange={(event) => setDelta(event.target.value)} placeholder="+100 或 -50" aria-label={`调整 ${name} 的积分`} /><Input value={note} onChange={(event) => setNote(event.target.value)} maxLength={120} placeholder="调整原因" aria-label={`调整 ${name} 的积分原因`} /><Button type="button" variant="secondary" disabled={pending} onClick={adjust}><Coins aria-hidden size={17} />应用</Button></div></section>
        <section className="grid content-start gap-3"><header><h3 className="font-semibold">发放限时铭牌</h3><p className="mt-1 text-xs text-muted-foreground">重复发放会从现有到期日继续累加。</p></header><div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem_auto]"><select className={controlClass} value={productId} onChange={(event) => setProductId(event.target.value)} aria-label={`选择发给 ${name} 的铭牌`}><option value="">选择铭牌</option>{products.map((item) => <option key={item.id} value={item.id}>{item.name}{item.active ? "" : "（已下架）"}</option>)}</select><Input type="number" min={1} max={3650} value={days} onChange={(event) => setDays(event.target.value)} aria-label="铭牌有效天数" /><Button type="button" variant="secondary" disabled={pending} onClick={grant}><Medal aria-hidden size={17} />发放</Button></div><label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={equip} onChange={(event) => setEquip(event.target.checked)} />发放后立即设为当前铭牌</label></section>
        {error ? <FieldMessage role="alert" className="lg:col-span-2">{error}</FieldMessage> : null}
      </div>
    </details>
  );
}

function RedemptionRow({ item, pending, onSave }: { item: AdminRewardRedemption; pending: boolean; onSave: (status: AdminRewardRedemption["status"], note: string) => Promise<boolean> }) {
  const [status, setStatus] = useState(item.status);
  const [note, setNote] = useState(item.fulfillment_note || "");
  async function save() {
    if (note.trim().length < 2) return;
    const warning = status === "refunded" ? "退款会通过幂等数据库奖励把已花积分退回。" : "订单状态将立即更新。";
    if (!window.confirm(`${warning}\n\n确认更新“${item.product_name}”？`)) return;
    await onSave(status, note.trim());
  }
  return <article className="grid gap-3 border-t p-4 first:border-t-0 lg:grid-cols-[minmax(15rem,1fr)_9rem_minmax(12rem,.8fr)_auto] lg:items-center"><div className="min-w-0"><strong className="block truncate">{item.product_name}</strong><span className="text-xs text-muted-foreground">{item.display_name || "用户"} · UID {item.public_uid || "待设置"} · {item.points_spent.toLocaleString("zh-CN")} 积分</span><time className="mt-1 block text-xs text-muted-foreground" dateTime={item.created_at}>{new Date(item.created_at).toLocaleString("zh-CN")}</time></div><select className={controlClass} value={status} onChange={(event) => setStatus(event.target.value as AdminRewardRedemption["status"])} aria-label={`更新 ${item.product_name} 状态`}>{Object.entries(redemptionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><Input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="处理备注，至少 2 个字符" aria-label={`${item.product_name} 处理备注`} /><Button type="button" variant="secondary" disabled={pending || note.trim().length < 2} onClick={save}><Receipt aria-hidden size={17} />更新</Button></article>;
}

export function AdminRewards({ actorId, initialStore }: { actorId: string; initialStore: AdminRewardStore }) {
  const router = useRouter();
  const [store, setStore] = useState(initialStore);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [redemptionStatus, setRedemptionStatus] = useState("all");
  const [entitlementQuery, setEntitlementQuery] = useState("");

  const redemptions = useMemo(() => store.redemptions.filter((item) => redemptionStatus === "all" || item.status === redemptionStatus).slice(0, 100), [store.redemptions, redemptionStatus]);
  const entitlements = useMemo(() => { const query = entitlementQuery.trim().toLowerCase(); return store.entitlements.filter((item) => !query || [item.display_name, item.public_uid, item.product_name, item.style].some((value) => String(value || "").toLowerCase().includes(query))).slice(0, 100); }, [store.entitlements, entitlementQuery]);

  async function authenticatedActions(): Promise<{ client: ReturnType<typeof createClient>; actions: RewardActions }> {
    const client = createClient();
    const auth = await client.auth.getUser();
    if (!auth.data.user || auth.data.user.id !== actorId) throw new Error("authentication_required");
    return { client, actions: adminRewardMutations(client) };
  }

  async function run(key: string, task: (actions: RewardActions) => Promise<unknown>, success: string) {
    setPending(key); setError(""); setStatus("");
    try {
      const { client, actions } = await authenticatedActions();
      await task(actions);
      try { setStore(await loadAdminRewardStore(client)); } catch { /* The mutation is authoritative; router.refresh retries the read. */ }
      setStatus(success);
      router.refresh();
    } catch (mutationError) {
      setError(friendlyError(mutationError));
      throw mutationError;
    } finally {
      setPending("");
    }
  }

  async function safeRun(key: string, task: (actions: RewardActions) => Promise<unknown>, success: string) {
    try { await run(key, task, success); return true; } catch { return false; }
  }

  return (
    <div className="grid gap-8">
      <div aria-live="polite" className="min-h-6">{error ? <FieldMessage role="alert">{error}</FieldMessage> : status ? <p className="text-sm font-medium text-primary">{status}</p> : null}</div>

      <section className="grid gap-4" aria-labelledby="reward-create-title"><header><span className="flex items-center gap-2 text-xs font-semibold text-primary"><Plus aria-hidden size={17} />安全上架</span><h2 id="reward-create-title" className="mt-1 text-xl font-semibold">新建积分商品</h2><p className="mt-1 text-sm text-muted-foreground">创建身份、数字、服务或实体权益。价格与库存由数据库在兑换时再次锁定。</p></header><div className="rounded-xl border bg-surface p-4 md:p-5"><ProductEditor pending={pending === "product:new"} onSave={(input) => safeRun("product:new", (actions) => actions.upsertProduct(input), "新商品已保存。")} /></div></section>

      <section className="grid gap-4" aria-labelledby="reward-catalog-title"><header className="flex items-end justify-between gap-4"><div><span className="flex items-center gap-2 text-xs font-semibold text-primary"><Package aria-hidden size={17} />商品目录</span><h2 id="reward-catalog-title" className="mt-1 text-xl font-semibold">编辑价格、库存和展示状态</h2></div><span className="text-xs text-muted-foreground">{store.products.filter((item) => item.active).length} 个展示中</span></header><div className="grid gap-3">{store.products.length ? store.products.map((product) => <details key={`${product.id}:${product.updated_at}`} className="group overflow-hidden rounded-xl border bg-surface"><summary className="grid cursor-pointer list-none gap-3 p-4 marker:hidden sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center"><span className="min-w-0"><strong className="block truncate">{product.name}</strong><span className="text-xs text-muted-foreground">{product.product_type} · 排序 {product.sort_order}</span></span><strong className="text-sm tabular-nums">{product.price_points.toLocaleString("zh-CN")} 积分</strong><span className="text-xs text-muted-foreground">{product.stock < 0 ? "不限量" : `库存 ${product.stock}`}</span><span className={`rounded-md px-2 py-1 text-center text-xs font-medium ${product.active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>{product.active ? "展示中" : "已下架"}</span></summary><div className="border-t bg-muted/35 p-4"><ProductEditor product={product} pending={pending === `product:${product.id}`} onSave={(input) => safeRun(`product:${product.id}`, (actions) => actions.upsertProduct(input), `“${product.name}”已保存。`)} /></div></details>) : <p className="rounded-xl border border-dashed bg-surface p-6 text-sm text-muted-foreground">还没有积分商品。</p>}</div></section>

      <section className="grid gap-4" aria-labelledby="reward-entitlements-title"><header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><span className="flex items-center gap-2 text-xs font-semibold text-primary"><Medal aria-hidden size={17} />铭牌授权</span><h2 id="reward-entitlements-title" className="mt-1 text-xl font-semibold">有效期、来源和佩戴状态</h2><p className="mt-1 text-sm text-muted-foreground">撤销后数据库会自动恢复该用户其他有效铭牌或经典样式。</p></div><Input type="search" value={entitlementQuery} onChange={(event) => setEntitlementQuery(event.target.value)} placeholder="搜索用户或铭牌" aria-label="搜索铭牌授权" className="sm:max-w-sm" /></header><div className="overflow-hidden rounded-xl border bg-surface">{entitlements.length ? entitlements.map((item, index) => <article key={item.id} className={`grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(12rem,.55fr)_auto] lg:items-center ${index ? "border-t" : ""}`}><div className="min-w-0"><strong className="block truncate">{item.product_name} · {item.style}</strong><span className="text-xs text-muted-foreground">{item.display_name || "用户"} · UID {item.public_uid || "待设置"} · {item.source === "admin_grant" ? "后台发放" : "积分兑换"}</span></div><div className="text-xs text-muted-foreground"><span className="block">有效至 {new Date(item.expires_at).toLocaleString("zh-CN")}</span>{item.equipped ? <strong className="mt-1 block text-primary">当前佩戴</strong> : null}</div><Button type="button" variant="danger" size="small" disabled={pending === `entitlement:${item.id}`} onClick={() => { if (window.confirm(`确认撤销 ${item.display_name || "该用户"} 的“${item.product_name}”？此操作会移除授权。`)) void safeRun(`entitlement:${item.id}`, (actions) => actions.revokeNameplate(item.id), "铭牌授权已撤销。"); }}><Prohibit aria-hidden size={16} />撤销授权</Button></article>) : <p className="p-6 text-sm text-muted-foreground">没有匹配的铭牌授权。</p>}</div></section>

      <section className="grid gap-4" aria-labelledby="reward-redemptions-title"><header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><span className="flex items-center gap-2 text-xs font-semibold text-primary"><Receipt aria-hidden size={17} />兑换订单</span><h2 id="reward-redemptions-title" className="mt-1 text-xl font-semibold">处理人工交付与退款</h2><p className="mt-1 text-sm text-muted-foreground">退款由数据库幂等入账，多次保存不会重复返还积分。</p></div><select className={`${controlClass} sm:max-w-44`} value={redemptionStatus} onChange={(event) => setRedemptionStatus(event.target.value)} aria-label="筛选兑换状态"><option value="all">全部状态</option>{Object.entries(redemptionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></header><div className="overflow-hidden rounded-xl border bg-surface">{redemptions.length ? redemptions.map((item) => <RedemptionRow key={`${item.id}:${item.status}:${item.fulfillment_note}`} item={item} pending={pending === `redemption:${item.id}`} onSave={(nextStatus, note) => safeRun(`redemption:${item.id}`, (actions) => actions.updateRedemption(item.id, nextStatus, note), `“${item.product_name}”订单已更新。`)} />) : <p className="p-6 text-sm text-muted-foreground">没有符合筛选条件的兑换订单。</p>}</div>
      </section>

      <footer className="rounded-xl border bg-muted/45 p-4 text-xs leading-5 text-muted-foreground"><CheckCircle aria-hidden size={17} className="mr-2 inline text-primary" />商品、钱包、订单和铭牌变更均由 Supabase 管理员 RPC 再次校验。页面不包含 service-role key，也不提供物理删除商品的入口。</footer>
    </div>
  );
}

export function AdminUserRewards({ actorId, initialStore }: { actorId: string; initialStore: AdminRewardStore }) {
  const router = useRouter();
  const [store, setStore] = useState(initialStore);
  const [pending, setPending] = useState("");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const products = useMemo(() => store.products.filter((item) => item.product_type === "nameplate"), [store.products]);
  const wallets = useMemo(() => { const value = query.trim().toLowerCase(); return store.wallets.filter((item) => !value || [item.display_name, item.public_uid, item.display_title].some((field) => String(field || "").toLowerCase().includes(value))).slice(0, 100); }, [store.wallets, query]);

  async function mutate(key: string, task: (actions: RewardActions) => Promise<unknown>, success: string) {
    setPending(key); setMessage("");
    try {
      const client = createClient();
      const auth = await client.auth.getUser();
      if (!auth.data.user || auth.data.user.id !== actorId) throw new Error("authentication_required");
      await task(adminRewardMutations(client));
      setStore(await loadAdminRewardStore(client));
      setMessage(success);
      router.refresh();
      return true;
    } catch (error) { setMessage(friendlyError(error)); return false; } finally { setPending(""); }
  }

  return <section className="grid gap-4" aria-labelledby="user-rewards-title"><header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><span className="flex items-center gap-2 text-xs font-semibold text-primary"><UserCircle aria-hidden size={17} />用户权益</span><h2 id="user-rewards-title" className="mt-1 text-xl font-semibold">用户积分、铭牌与称号权益</h2><p className="mt-1 text-sm text-muted-foreground">积分调整属于用户管理；原因进入用户账本，铭牌保留有效期和佩戴状态。</p></div><Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索昵称、UID 或称号" aria-label="搜索用户积分钱包" className="sm:max-w-sm" /></header>{message ? <FieldMessage role="status">{message}</FieldMessage> : null}<div className="grid gap-3">{wallets.length ? wallets.map((wallet) => <WalletRow key={`${wallet.user_id}:${wallet.updated_at}`} wallet={wallet} products={products} pending={pending.startsWith(`wallet:${wallet.user_id}`)} onAdjust={(delta, note) => mutate(`wallet:${wallet.user_id}:points`, (actions) => actions.adjustPoints(wallet.user_id, delta, note), `已调整 ${wallet.display_name || "用户"} 的积分。`)} onGrant={(productId, days, equip) => mutate(`wallet:${wallet.user_id}:plate`, (actions) => actions.grantNameplate(wallet.user_id, productId, days, equip), `已向 ${wallet.display_name || "用户"} 发放铭牌。`)} />) : <p className="rounded-xl border border-dashed bg-surface p-6 text-sm text-muted-foreground">没有匹配的积分账户。</p>}</div></section>;
}
