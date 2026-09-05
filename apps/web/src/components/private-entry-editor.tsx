"use client";

/* eslint-disable @next/next/no-img-element -- Private signed URLs and local Blob previews must bypass the image optimizer. */

import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ImageSquare, LockKey, Trash, UploadSimple } from "@phosphor-icons/react";
import { MAX_IMAGES, splitEntryTags, validateImages, validatePrivateEntry, type PrivateEntry, type PrivateEntryKind, type PrivateEntryReviewData } from "@wavekb/domain";
import { Button, Field, FieldMessage, Input, Label, Textarea } from "@wavekb/ui";
import { createClient } from "@/lib/supabase/client";
import { savePrivateEntry, softDeletePrivateEntry } from "@/lib/workbench/client-repository";
import { buildTradingViewPackage, parseTradingViewPackage, type TradingViewPackage } from "@/lib/workbench/tradingview";
import { PrivateEntryChart } from "./private-entry-chart";

type SelectedImage = { key: string; file: File; previewUrl: string };
type EntryErrors = Partial<Record<"kind" | "title" | "body" | "instrument" | "market" | "timeframe" | "tags" | "knowledgeIds" | "images" | "form", string>>;
type LocalEntryDraft = {
  kind: PrivateEntryKind; mode: "simple" | "professional"; title: string; body: string; instrument: string; market: string; timeframe: string;
  tags: string; knowledgeIds: string; pattern: string; position: string; direction: string;
  outcome: NonNullable<PrivateEntryReviewData["outcome"]>; countResult: NonNullable<PrivateEntryReviewData["count_result"]>;
  ruleCompliance: NonNullable<PrivateEntryReviewData["rule_compliance"]>; executionScore: string; lesson: string;
  tradingViewSource: string; tradingViewSymbol: string; tradingViewInterval: string; tradingViewTheme: TradingViewPackage["theme"];
  tradingViewLayout: TradingViewPackage["layout"]; tradingViewPreview: TradingViewPackage | null; keptImageIds: string[];
  baseUpdatedAt: string | null; savedAt?: string;
};

const kinds: Array<{ value: PrivateEntryKind; label: string }> = [
  { value: "review", label: "复盘" },
  { value: "journal", label: "交易日记" },
  { value: "draft", label: "研究草稿" },
];

const wavePatterns = [
  ["unknown", "待确认"], ["impulse", "普通推动浪"], ["leading_diagonal", "引导楔形"], ["ending_diagonal", "终结楔形"],
  ["zigzag", "单锯齿"], ["double_zigzag", "双锯齿"], ["triple_zigzag", "三锯齿"], ["flat", "平台型"], ["expanded_flat", "扩散平台"],
  ["running_flat", "奔走平台"], ["contracting_triangle", "收敛三角形"], ["barrier_triangle", "屏障三角形"],
  ["expanding_triangle", "扩散三角形"], ["combination", "联合型"], ["double_combination", "双重联合型"], ["triple_combination", "三重联合型"],
] as const;
const wavePositions = ["待确认", "浪1", "浪2", "浪3", "浪4", "浪5", "浪A", "浪B", "浪C", "浪D", "浪E", "浪W", "浪X", "浪Y", "浪Z"] as const;

const selectClassName = "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50";

function imageFiles(files: FileList | File[]): File[] {
  return Array.from(files).filter((file) => file.type.startsWith("image/"));
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/row-level security|permission|jwt|auth/i.test(message)) return "登录状态已失效，请重新登录后再保存。";
  if (/storage|upload|network|fetch/i.test(message)) return "私密图片没有上传完成，请检查网络后重试。";
  return message || "记录没有保存，请稍后重试。";
}

export function PrivateEntryEditor({ actorId, entry, initialKind = "review" }: { actorId: string; entry?: PrivateEntry; initialKind?: PrivateEntryKind }) {
  if (entry && entry.owner_id !== actorId) return <p role="alert">无法读取其他账号的私人记录。</p>;
  return <PrivateEntryEditorForm key={`${actorId}:${entry?.id || initialKind}:${entry?.updated_at || "new"}`} actorId={actorId} entry={entry} initialKind={initialKind} />;
}

function PrivateEntryEditorForm({ actorId, entry, initialKind }: { actorId: string; entry?: PrivateEntry; initialKind: PrivateEntryKind }) {
  const router = useRouter();
  const draftKey = `wavekb:next:private-entry:${actorId}:${entry?.id || initialKind}`;
  const initialReview = entry?.review_data ?? {};
  const [kind, setKind] = useState<PrivateEntryKind>(entry?.kind || initialKind);
  const [title, setTitle] = useState(entry?.title || "");
  const [body, setBody] = useState(entry?.body || "");
  const [mode, setMode] = useState<"simple" | "professional">(initialReview.editor_mode === "professional" ? "professional" : "simple");
  const [instrument, setInstrument] = useState(entry?.instrument || "");
  const [market, setMarket] = useState(entry?.market || "");
  const [timeframe, setTimeframe] = useState(entry?.timeframe || "");
  const [pattern, setPattern] = useState(String(initialReview.pattern || "unknown"));
  const [position, setPosition] = useState(String(initialReview.position || "unknown"));
  const [direction, setDirection] = useState(String(initialReview.direction || "unknown"));
  const [tags, setTags] = useState(entry?.tags.join("、") || "");
  const [knowledgeIds, setKnowledgeIds] = useState(entry?.knowledge_ids.join("、") || "");
  const [outcome, setOutcome] = useState<NonNullable<PrivateEntryReviewData["outcome"]>>(initialReview.outcome || "");
  const [countResult, setCountResult] = useState<NonNullable<PrivateEntryReviewData["count_result"]>>(initialReview.count_result || "");
  const [ruleCompliance, setRuleCompliance] = useState<NonNullable<PrivateEntryReviewData["rule_compliance"]>>(initialReview.rule_compliance || "");
  const [executionScore, setExecutionScore] = useState(initialReview.execution_score ? String(initialReview.execution_score) : "");
  const [lesson, setLesson] = useState(String(initialReview.lesson ?? initialReview.lessons ?? ""));
  const initialTradingView = initialReview.tradingview as TradingViewPackage | null | undefined;
  const [tradingViewSource, setTradingViewSource] = useState(initialTradingView?.chart_url || initialTradingView?.symbol || "");
  const [tradingViewSymbol, setTradingViewSymbol] = useState(initialTradingView?.symbol || "");
  const [tradingViewInterval, setTradingViewInterval] = useState(initialTradingView?.interval || "D");
  const [tradingViewTheme, setTradingViewTheme] = useState(initialTradingView?.theme || "auto");
  const [tradingViewLayout, setTradingViewLayout] = useState(initialTradingView?.layout || null);
  const [tradingViewPreview, setTradingViewPreview] = useState<TradingViewPackage | null>(initialTradingView || null);
  const [existingImages, setExistingImages] = useState(entry?.private_entry_images || []);
  const [images, setImages] = useState<SelectedImage[]>([]);
  const [errors, setErrors] = useState<EntryErrors>({});
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [draftStatus, setDraftStatus] = useState("正在检查本地草稿。");
  const [conflictingDraft, setConflictingDraft] = useState<Partial<LocalEntryDraft> | null>(null);
  const draftCleared = useRef(false);
  const imagesRef = useRef(images);

  function restoreDraft(stored: Partial<LocalEntryDraft>) {
    if (["review", "journal", "draft"].includes(stored.kind || "")) setKind(stored.kind!);
    if (stored.mode === "professional" || stored.mode === "simple") setMode(stored.mode);
    const fields = [["title", setTitle], ["body", setBody], ["instrument", setInstrument], ["market", setMarket], ["timeframe", setTimeframe],
      ["tags", setTags], ["knowledgeIds", setKnowledgeIds], ["pattern", setPattern], ["position", setPosition], ["direction", setDirection],
      ["executionScore", setExecutionScore], ["lesson", setLesson], ["tradingViewSource", setTradingViewSource],
      ["tradingViewSymbol", setTradingViewSymbol], ["tradingViewInterval", setTradingViewInterval]] as const;
    for (const [field, setter] of fields) if (typeof stored[field] === "string") setter(stored[field]);
    if (["", "win", "loss", "breakeven", "cancelled"].includes(stored.outcome ?? "missing")) setOutcome(stored.outcome!);
    if (["", "correct", "alternate", "invalid"].includes(stored.countResult ?? "missing")) setCountResult(stored.countResult!);
    if (["", "yes", "no", "unclear"].includes(stored.ruleCompliance ?? "missing")) setRuleCompliance(stored.ruleCompliance!);
    if (["auto", "light", "dark"].includes(stored.tradingViewTheme || "")) setTradingViewTheme(stored.tradingViewTheme!);
    if (stored.tradingViewLayout === null || typeof stored.tradingViewLayout === "object") setTradingViewLayout(stored.tradingViewLayout);
    if (stored.tradingViewPreview === null || typeof stored.tradingViewPreview === "object") setTradingViewPreview(stored.tradingViewPreview);
    if (Array.isArray(stored.keptImageIds)) setExistingImages((entry?.private_entry_images || []).filter((image) => stored.keptImageIds!.includes(image.id)));
    setDraftStatus("已恢复当前账号的本地草稿，尚未保存到私人空间。");
  }

  const restoreDraftRef = useRef(restoreDraft);
  useEffect(() => {
    const restore = window.setTimeout(() => {
      try {
        const stored = JSON.parse(localStorage.getItem(draftKey) || "null") as Partial<LocalEntryDraft> | null;
        if (stored && typeof stored === "object" && !Array.isArray(stored)) {
          if (entry && stored.baseUpdatedAt !== entry.updated_at) {
            setConflictingDraft(stored);
            setDraftStatus("服务器记录已更新，或本地草稿版本无法确认。请先选择保留服务器内容或恢复本地草稿。");
          } else restoreDraftRef.current(stored);
        } else setDraftStatus("文字和配置会自动保存在当前设备。");
      } catch {
        setDraftStatus("本地草稿无法读取；请及时保存到私人空间。");
      }
      setDraftLoaded(true);
    }, 0);
    return () => window.clearTimeout(restore);
  }, [draftKey, entry]);

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(() => () => {
    imagesRef.current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
  }, []);

  const draft: LocalEntryDraft = { kind, mode, title, body, instrument, market, timeframe, tags, knowledgeIds, pattern, position, direction,
    outcome, countResult, ruleCompliance, executionScore, lesson, tradingViewSource, tradingViewSymbol, tradingViewInterval, tradingViewTheme,
    tradingViewLayout, tradingViewPreview, keptImageIds: existingImages.map((image) => image.id), baseUpdatedAt: entry?.updated_at || null };
  const serializedDraft = JSON.stringify(draft);
  const initialDraft = useRef(serializedDraft);
  const localDraftWritten = useRef(false);
  useEffect(() => {
    if (!draftLoaded || conflictingDraft || draftCleared.current) return;
    try {
      if (serializedDraft === initialDraft.current) {
        if (localDraftWritten.current) {
          localStorage.removeItem(draftKey);
          localDraftWritten.current = false;
          setDraftStatus("当前内容未作修改。");
        }
        return;
      }
      localStorage.setItem(draftKey, JSON.stringify({ ...JSON.parse(serializedDraft), savedAt: new Date().toISOString() }));
      localDraftWritten.current = true;
      setDraftStatus((current) => current.startsWith("已恢复") ? current : "本地草稿已保存，尚未保存到私人空间。");
    } catch {
      setDraftStatus("本地草稿未能保存，请及时保存到私人空间，勿关闭页面。");
    }
  }, [serializedDraft, draftKey, draftLoaded, conflictingDraft]);

  function addImages(files: File[]) {
    const total = existingImages.length + images.length + files.length;
    const error = total > MAX_IMAGES ? "每条记录最多保存 9 张图片。" : validateImages([...images.map((image) => image.file), ...files]);
    if (error) {
      setErrors((current) => ({ ...current, images: error }));
      return;
    }
    setErrors((current) => ({ ...current, images: undefined }));
    setImages((current) => [...current, ...files.map((file) => ({ key: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file) }))]);
  }

  function removeSelectedImage(key: string) {
    setImages((current) => {
      const target = current.find((image) => image.key === key);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((image) => image.key !== key);
    });
  }

  function handlePaste(event: ClipboardEvent<HTMLFormElement>) {
    const files = imageFiles(Array.from(event.clipboardData.items).filter((item) => item.kind === "file").map((item) => item.getAsFile()).filter((file): file is File => Boolean(file)));
    if (files.length) {
      event.preventDefault();
      addImages(files);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    addImages(imageFiles(event.dataTransfer.files));
  }

  function refreshTradingView() {
    try {
      const value = buildTradingViewPackage({ source: tradingViewSource, symbol: tradingViewSymbol, interval: tradingViewInterval, theme: tradingViewTheme, layout: tradingViewLayout });
      setTradingViewPreview(value);
      if (value) {
        setTradingViewSymbol(value.symbol);
        setTradingViewInterval(value.interval);
        setErrors((current) => ({ ...current, form: undefined }));
      }
    } catch (error) {
      setErrors((current) => ({ ...current, form: error instanceof Error ? error.message : "图表链接无效。" }));
    }
  }

  async function importTradingView(file: File) {
    try {
      const value = parseTradingViewPackage(await file.text());
      setTradingViewSource(value.chart_url || value.symbol);
      setTradingViewSymbol(value.symbol);
      setTradingViewInterval(value.interval);
      setTradingViewTheme(value.theme);
      setTradingViewLayout(value.layout);
      setTradingViewPreview(value);
      setErrors((current) => ({ ...current, form: undefined }));
    } catch (error) {
      setErrors((current) => ({ ...current, form: error instanceof Error ? error.message : "图表配置导入失败。" }));
    }
  }

  function exportTradingView() {
    if (!tradingViewPreview) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(tradingViewPreview, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `wavekb-tv-${tradingViewPreview.symbol || "chart"}-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draftLoaded || conflictingDraft) return;
    let tradingViewValue: TradingViewPackage | null;
    try {
      tradingViewValue = buildTradingViewPackage({ source: tradingViewSource, symbol: tradingViewSymbol, interval: tradingViewInterval, theme: tradingViewTheme, layout: tradingViewLayout });
    } catch (error) {
      setErrors({ form: error instanceof Error ? error.message : "图表配置无效。" });
      return;
    }
    const validation = validatePrivateEntry({
      kind,
      title,
      body,
      instrument,
      market,
      timeframe,
      tags: splitEntryTags(tags),
      knowledgeIds: splitEntryTags(knowledgeIds),
      reviewData: {
        ...initialReview,
        editor_mode: mode,
        outcome,
        count_result: countResult,
        rule_compliance: ruleCompliance,
        execution_score: executionScore ? Number(executionScore) : null,
        lesson: lesson.trim(),
        pattern,
        position,
        direction,
        tradingview: tradingViewValue,
      },
    });
    const imageError = validateImages(images.map((image) => image.file));
    if (!validation.ok || imageError || !validation.value.kind) {
      setErrors({ ...validation.fields, images: imageError || undefined });
      return;
    }
    setPending(true);
    setStatus("正在写入私人空间。");
    setErrors({});
    try {
      const client = createClient();
      const auth = await client.auth.getUser();
      if (!auth.data.user || auth.data.user.id !== actorId) throw new Error("登录状态已失效");
      const saved = await savePrivateEntry(client, {
        id: entry?.id,
        ownerId: actorId,
        kind: validation.value.kind,
        title: validation.value.title,
        body: validation.value.body,
        instrument: validation.value.instrument,
        market: validation.value.market,
        timeframe: validation.value.timeframe,
        tags: validation.value.tags,
        knowledgeIds: validation.value.knowledgeIds,
        reviewData: validation.value.reviewData,
        keptImageIds: existingImages.map((image) => image.id),
        files: images.map((image) => image.file),
      }, entry);
      draftCleared.current = true;
      try { localStorage.removeItem(draftKey); } catch { /* Remote save succeeded even if local storage is unavailable. */ }
      if (saved.cleanupPending) setStatus("记录已保存，旧图片清理将在后续重试。");
      router.push(`/workbench/entries/${saved.id}`);
      router.refresh();
    } catch (error) {
      setErrors({ form: friendlyError(error) });
      setStatus("");
      setPending(false);
    }
  }

  async function removeEntry() {
    if (!entry || !window.confirm("确认移除这条私人记录？记录将软删除，不会公开。")) return;
    setPending(true);
    setErrors({});
    try {
      await softDeletePrivateEntry(createClient(), entry, actorId);
      draftCleared.current = true;
      try { localStorage.removeItem(draftKey); } catch { /* Do not turn a successful deletion into an error. */ }
      router.push("/workbench");
      router.refresh();
    } catch (error) {
      setErrors({ form: friendlyError(error) });
      setPending(false);
    }
  }

  return (
    <form className="grid gap-7" onSubmit={submit} onPaste={handlePaste}>
      {conflictingDraft ? <section role="alert" className="grid gap-3 rounded-xl border p-4"><p>{draftStatus}</p><div className="flex flex-wrap gap-2"><Button type="button" onClick={() => { restoreDraft(conflictingDraft); setConflictingDraft(null); }}>恢复本地草稿</Button><Button type="button" variant="secondary" onClick={() => { try { localStorage.removeItem(draftKey); } catch { setDraftStatus("本地草稿无法清除，请检查浏览器存储。"); return; } setConflictingDraft(null); setDraftStatus("已保留服务器内容。"); }}>保留服务器内容</Button></div></section> : null}
      {initialReview.analysis_snapshot && typeof initialReview.analysis_snapshot === "object" ? <section aria-label="原始分析快照" className="grid gap-3 rounded-xl border bg-surface p-5"><h2 className="text-xl font-semibold">原始分析快照</h2><p className="text-sm text-muted-foreground">生成复盘时保存的分析，只读保留，不随后续分析修改。</p><details><summary className="cursor-pointer text-sm font-medium">查看分析数据</summary><pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-4 text-xs">{JSON.stringify(initialReview.analysis_snapshot, null, 2)}</pre></details></section> : null}
      <fieldset disabled={!draftLoaded || Boolean(conflictingDraft) || pending} className="contents">
      <section className="grid gap-6 rounded-xl border bg-surface p-5 md:p-7">
        <header className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><LockKey aria-hidden size={21} weight="duotone" /></span><div><h2 className="text-xl font-semibold">私人记录</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">只有当前账号可以读取。需要公开时会另外生成社区帖子。</p></div></header>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field><Label htmlFor="entry-kind">记录类型</Label><select id="entry-kind" className={selectClassName} value={kind} onChange={(event) => setKind(event.target.value as PrivateEntryKind)}>{kinds.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>{errors.kind ? <FieldMessage>{errors.kind}</FieldMessage> : null}</Field>
          <Field><Label>记录模式</Label><div className="grid grid-cols-2 gap-2" role="tablist" aria-label="记录模式"><Button type="button" variant={mode === "simple" ? "primary" : "secondary"} onClick={() => setMode("simple")} role="tab" aria-selected={mode === "simple"}>简易记录</Button><Button type="button" variant={mode === "professional" ? "primary" : "secondary"} onClick={() => setMode("professional")} role="tab" aria-selected={mode === "professional"}>专业复盘</Button></div></Field>
        </div>

        <Field><Label htmlFor="entry-title">标题</Label><Input id="entry-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} required aria-invalid={Boolean(errors.title)} />{errors.title ? <FieldMessage>{errors.title}</FieldMessage> : <p className="text-xs text-muted-foreground">1-120 个字符。</p>}</Field>

        {mode === "professional" ? <section className="grid gap-5 rounded-xl bg-muted p-4 md:p-5" aria-labelledby="entry-context-title"><div><h3 id="entry-context-title" className="font-semibold">分析坐标</h3><p className="mt-1 text-xs text-muted-foreground">先固定市场、品种、周期与浪型，避免复盘时更换口径。</p></div><div className="grid gap-5 sm:grid-cols-3"><Field><Label htmlFor="entry-market">市场分类</Label><Input id="entry-market" value={market} onChange={(event) => setMarket(event.target.value)} maxLength={80} placeholder="加密、贵金属" />{errors.market ? <FieldMessage>{errors.market}</FieldMessage> : null}</Field><Field><Label htmlFor="entry-instrument">品种</Label><Input id="entry-instrument" value={instrument} onChange={(event) => setInstrument(event.target.value)} maxLength={80} placeholder="BTCUSDT" />{errors.instrument ? <FieldMessage>{errors.instrument}</FieldMessage> : null}</Field><Field><Label htmlFor="entry-timeframe">周期</Label><Input id="entry-timeframe" value={timeframe} onChange={(event) => setTimeframe(event.target.value)} maxLength={40} placeholder="4小时" />{errors.timeframe ? <FieldMessage>{errors.timeframe}</FieldMessage> : null}</Field><Field><Label htmlFor="entry-pattern">当前浪型</Label><select id="entry-pattern" className={selectClassName} value={pattern} onChange={(event) => setPattern(event.target.value)}>{wavePatterns.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field><Label htmlFor="entry-position">当前子浪</Label><select id="entry-position" className={selectClassName} value={position} onChange={(event) => setPosition(event.target.value)}>{wavePositions.map((label) => <option key={label} value={label === "待确认" ? "unknown" : label}>{label}</option>)}</select></Field><Field><Label htmlFor="entry-direction">方向</Label><select id="entry-direction" className={selectClassName} value={direction} onChange={(event) => setDirection(event.target.value)}><option value="unknown">待确认</option><option value="up">上涨</option><option value="down">下跌</option><option value="sideways">横向整理</option></select></Field></div></section> : null}

        <Field><div className="flex items-end justify-between gap-3"><Label htmlFor="entry-body">正文</Label><span className="text-xs tabular-nums text-muted-foreground">{body.length}/50000</span></div><Textarea id="entry-body" value={body} onChange={(event) => setBody(event.target.value)} rows={mode === "professional" ? 12 : 16} maxLength={50_000} placeholder="记录当时的判断、证据、失效条件和执行过程" aria-invalid={Boolean(errors.body)} />{errors.body ? <FieldMessage>{errors.body}</FieldMessage> : null}</Field>

        <Field><div className="flex items-end justify-between gap-3"><div><Label htmlFor="entry-images">私密图片</Label><p className="mt-1 text-xs text-muted-foreground">可拖入或粘贴，单张不超过 10 MiB，最多 9 张。</p></div><span className="text-xs tabular-nums text-muted-foreground">{existingImages.length + images.length}/{MAX_IMAGES}</span></div><div onDragOver={(event) => event.preventDefault()} onDrop={handleDrop} className="grid min-h-28 place-items-center gap-3 rounded-xl border border-dashed bg-muted/45 p-5 text-center"><ImageSquare aria-hidden size={28} weight="duotone" className="text-primary" /><span className="text-sm"><strong>拖入或粘贴图片</strong><span className="text-muted-foreground">，也可以从设备选择</span></span><Button asChild type="button" variant="secondary" size="small"><label htmlFor="entry-images" className="cursor-pointer"><UploadSimple aria-hidden size={16} />选择图片</label></Button><input id="entry-images" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(event) => { if (event.target.files) addImages(imageFiles(event.target.files)); event.target.value = ""; }} /></div>{errors.images ? <FieldMessage>{errors.images}</FieldMessage> : null}
          {existingImages.length || images.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="私人记录图片">{existingImages.map((image, index) => <figure key={image.id} className="relative overflow-hidden rounded-xl border bg-muted"><img src={image.signed_url} alt={`已保存图片 ${index + 1}`} className="aspect-square h-full w-full object-cover" /><Button type="button" variant="danger" size="icon" aria-label={`移除已保存图片 ${index + 1}`} className="absolute right-2 top-2 size-9" onClick={() => setExistingImages((current) => current.filter((item) => item.id !== image.id))}><Trash aria-hidden size={17} /></Button></figure>)}{images.map((image, index) => <figure key={image.key} className="relative overflow-hidden rounded-xl border bg-muted"><img src={image.previewUrl} alt={`待保存图片 ${index + 1}`} className="aspect-square h-full w-full object-cover" /><Button type="button" variant="danger" size="icon" aria-label={`移除待保存图片 ${index + 1}`} className="absolute right-2 top-2 size-9" onClick={() => removeSelectedImage(image.key)}><Trash aria-hidden size={17} /></Button></figure>)}</div> : null}
        </Field>

        {mode === "professional" ? <div className="grid gap-5 sm:grid-cols-2"><Field><Label htmlFor="entry-tags">标签</Label><Input id="entry-tags" value={tags} onChange={(event) => setTags(event.target.value)} placeholder="主升、纪律、止损" />{errors.tags ? <FieldMessage>{errors.tags}</FieldMessage> : <p className="text-xs text-muted-foreground">顿号或逗号分隔，最多 20 个。</p>}</Field><Field><Label htmlFor="entry-knowledge">关联知识 ID</Label><Input id="entry-knowledge" value={knowledgeIds} onChange={(event) => setKnowledgeIds(event.target.value)} placeholder="unit-rule-impulse" />{errors.knowledgeIds ? <FieldMessage>{errors.knowledgeIds}</FieldMessage> : <p className="text-xs text-muted-foreground">只保存知识条目标识，不复制知识正文。</p>}</Field></div> : null}
      </section>

      {mode === "professional" && kind === "review" ? <section className="grid gap-5 rounded-xl border bg-surface p-5 md:p-7" aria-labelledby="review-check-title"><header><h2 id="review-check-title" className="text-xl font-semibold">复盘核验</h2><p className="mt-1 text-sm text-muted-foreground">把结构判断与交易执行分开记录，避免用盈亏替代规则核验。</p></header><div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4"><Field><Label htmlFor="entry-outcome">最终结果</Label><select id="entry-outcome" className={selectClassName} value={outcome} onChange={(event) => setOutcome(event.target.value as NonNullable<PrivateEntryReviewData["outcome"]>)}><option value="">尚未结束</option><option value="win">盈利</option><option value="loss">亏损</option><option value="breakeven">保本</option><option value="cancelled">未执行</option></select></Field><Field><Label htmlFor="entry-count-result">数浪结果</Label><select id="entry-count-result" className={selectClassName} value={countResult} onChange={(event) => setCountResult(event.target.value as NonNullable<PrivateEntryReviewData["count_result"]>)}><option value="">待核验</option><option value="correct">主计数成立</option><option value="alternate">备选计数成立</option><option value="invalid">计数失效</option></select></Field><Field><Label htmlFor="entry-rule-compliance">规则遵守</Label><select id="entry-rule-compliance" className={selectClassName} value={ruleCompliance} onChange={(event) => setRuleCompliance(event.target.value as NonNullable<PrivateEntryReviewData["rule_compliance"]>)}><option value="">待核验</option><option value="yes">遵守全部硬规则</option><option value="no">存在规则违规</option><option value="unclear">证据不足</option></select></Field><Field><Label htmlFor="entry-score">执行纪律</Label><Input id="entry-score" type="number" min={1} max={5} value={executionScore} onChange={(event) => setExecutionScore(event.target.value)} placeholder="1-5" /></Field></div><Field><Label htmlFor="entry-lesson">本次经验与下次改进</Label><Textarea id="entry-lesson" value={lesson} onChange={(event) => setLesson(event.target.value)} rows={4} maxLength={2000} /></Field></section> : null}

      {mode === "professional" && kind === "review" ? <section className="grid gap-5 rounded-xl border bg-surface p-5 md:p-7" aria-labelledby="tradingview-title"><header><h2 id="tradingview-title" className="text-xl font-semibold">TradingView 图表</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">粘贴公开图表链接或输入品种代码。JSON 可保存和导入图表配置；嵌入预览不支持恢复私人布局或绘图对象。</p></header><div className="grid gap-5 sm:grid-cols-2"><Field className="sm:col-span-2"><Label htmlFor="tradingview-source">图表链接或品种代码</Label><Input id="tradingview-source" value={tradingViewSource} onChange={(event) => setTradingViewSource(event.target.value)} maxLength={2000} placeholder="https://www.tradingview.com/chart/... 或 BINANCE:BTCUSDT" /></Field><Field><Label htmlFor="tradingview-symbol">品种代码</Label><Input id="tradingview-symbol" value={tradingViewSymbol} onChange={(event) => setTradingViewSymbol(event.target.value)} maxLength={80} placeholder="BINANCE:BTCUSDT" /></Field><Field><Label htmlFor="tradingview-interval">图表周期</Label><select id="tradingview-interval" className={selectClassName} value={tradingViewInterval} onChange={(event) => setTradingViewInterval(event.target.value)}><option value="15">15分钟</option><option value="60">1小时</option><option value="240">4小时</option><option value="D">日线</option><option value="W">周线</option><option value="M">月线</option></select></Field><Field><Label htmlFor="tradingview-theme">图表主题</Label><select id="tradingview-theme" className={selectClassName} value={tradingViewTheme} onChange={(event) => setTradingViewTheme(event.target.value as "auto" | "light" | "dark")}><option value="auto">跟随网站</option><option value="dark">深色</option><option value="light">浅色</option></select></Field><Field><Label htmlFor="tradingview-import">导入图表配置</Label><Input id="tradingview-import" type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importTradingView(file); }} /></Field></div><div className="flex flex-wrap gap-2"><Button type="button" onClick={refreshTradingView}>刷新图表</Button><Button type="button" variant="secondary" disabled={!tradingViewPreview} onClick={exportTradingView}>导出图表配置</Button><Button asChild type="button" variant="ghost"><a href="https://www.tradingview.com/chart/" target="_blank" rel="noreferrer">打开 TradingView</a></Button></div>{tradingViewPreview ? <PrivateEntryChart value={tradingViewPreview} /> : <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">填写链接或品种代码后刷新，即可预览并把图表配置绑定到本次复盘。</p>}</section> : null}

      {errors.form ? <FieldMessage role="alert" className="rounded-lg border border-destructive/35 bg-destructive/10 p-3">{errors.form}</FieldMessage> : null}
      <footer className="flex flex-col gap-4 rounded-xl border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between"><div className="grid gap-1">{status ? <p role="status" className="text-sm text-muted-foreground">{status}</p> : <p role="status" className="text-xs text-muted-foreground">{conflictingDraft ? "请先处理上方的草稿冲突。" : draftStatus}</p>}<p className="text-xs text-muted-foreground">本地草稿保留文字、配置和已保存图片的选择；新选择的图片不会保留，刷新后需重新添加。</p>{entry ? <Link href={`/community/public_viewpoint/new?source=${entry.id}`} className="text-sm font-medium text-primary hover:underline">整理为公开社区副本</Link> : null}</div><div className="flex flex-wrap gap-2">{entry ? <Button type="button" variant="danger" disabled={pending} onClick={removeEntry}><Trash aria-hidden size={17} />移除记录</Button> : null}<Button asChild type="button" variant="secondary"><Link href="/workbench">取消</Link></Button><Button type="submit" disabled={pending || !draftLoaded || Boolean(conflictingDraft)}>{pending ? "正在保存" : "保存私人记录"}</Button></div></footer>
      </fieldset>
    </form>
  );
}
