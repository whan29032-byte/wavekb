"use client";

import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent } from "react";
import { ImageSquare, LinkSimple, Plus, Trash, UploadSimple } from "@phosphor-icons/react";
import { MAX_EXTERNAL_REFERENCES, MAX_IMAGES, parseExternalReference, validateImages, validatePost, type BoardSlug, type CommunityPost, type PrivateEntry } from "@wavekb/domain";
import { Button, Field, FieldMessage, Input, Label, Textarea } from "@wavekb/ui";
import { createPost, updatePost } from "@/lib/community/client-repository";
import { compileStructuredPost, DIRECTIONS, MARKET_GROUPS, parseStructuredPost, RESEARCH_TIMEFRAMES, WAVE_PATTERNS, WAVE_POSITIONS, type StructuredPost } from "@/lib/community/research-catalog";
import { createClient } from "@/lib/supabase/client";
import { publicPostImageUrl } from "@/lib/env";
import { buildTradingViewPackage, tradingViewEmbedUrl, type TradingViewPackage } from "@/lib/workbench/tradingview";

type SelectedImage = { key: string; file: File; previewUrl: string; caption: string };
type MediaDraft = { key: string; url: string };
type ComposerErrors = Partial<Record<"title" | "body" | "externalUrl" | "images" | "form", string>>;
type EditorMode = "simple" | "professional";

const blankStructured: StructuredPost = { market: "crypto", instrument: "", timeframe: "4小时", pattern: "unknown", position: "unknown", direction: "unknown", thesis: "", evidence: "", invalidation: "", question: "", primaryCount: "", alternateCount: "", confirmation: "", application: "", notes: "" };
const selectClass = "h-11 w-full rounded-lg border border-input bg-surface px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

function imageFiles(files: FileList | File[]): File[] {
  return Array.from(files).filter((file) => file.type.startsWith("image/"));
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/row-level security|permission denied|not authorized|jwt/i.test(message)) return "登录状态已失效，刷新页面并重新登录后再试。";
  if (/storage|upload|network|fetch/i.test(message)) return "图片上传没有完成。草稿仍在本机，请检查网络后重试。";
  return "发布没有完成。草稿仍在本机，请稍后重试。";
}

function safeErrorDiagnostic(error: unknown) {
  const candidate = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown; status?: unknown };
  return {
    code: String(candidate?.code ?? ""),
    message: String(candidate?.message ?? error ?? "").slice(0, 500),
    details: String(candidate?.details ?? "").slice(0, 500),
    hint: String(candidate?.hint ?? "").slice(0, 500),
    status: String(candidate?.status ?? ""),
  };
}

export function PostComposer({ board, userId, post, source }: { board: BoardSlug; userId: string; post?: CommunityPost; source?: PrivateEntry }) {
  const draftKey = `wavekb:next:composer:${userId}:${board}:${post?.id || "new"}`;
  const restoredPost = post ? parseStructuredPost(post.body) : null;
  const [title, setTitle] = useState(post?.title || source?.title || "");
  const [body, setBody] = useState(restoredPost?.notes || post?.body || source?.body || "");
  const [references, setReferences] = useState<MediaDraft[]>(() => {
    const existing = post?.external_references?.length
      ? post.external_references.map((reference) => reference.url)
      : post?.external_url ? [post.external_url] : [""];
    return existing.map((url) => ({ key: crypto.randomUUID(), url }));
  });
  const [mode, setMode] = useState<EditorMode>(post?.chart_package || restoredPost ? "professional" : "simple");
  const [structured, setStructured] = useState<StructuredPost>(restoredPost || blankStructured);
  const initialChart = post?.chart_package as TradingViewPackage | null;
  const [chartSource, setChartSource] = useState(initialChart?.chart_url || initialChart?.symbol || "");
  const [chartSymbol, setChartSymbol] = useState(initialChart?.symbol || "");
  const [chartInterval, setChartInterval] = useState(initialChart?.interval || "D");
  const [chartTheme, setChartTheme] = useState(initialChart?.theme || "auto");
  const [chartPreview, setChartPreview] = useState<TradingViewPackage | null>(initialChart);
  const [existingImages, setExistingImages] = useState(() => [...(post?.post_images || [])].sort((a, b) => a.sort_order - b.sort_order));
  const [images, setImages] = useState<SelectedImage[]>([]);
  const [errors, setErrors] = useState<ComposerErrors>({});
  const [hydrated, setHydrated] = useState(false);
  const [pending, setPending] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const imagesRef = useRef(images);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (post) return;
    const restoreDraft = window.setTimeout(() => {
      try {
        const stored = JSON.parse(localStorage.getItem(draftKey) || "null") as { title?: string; body?: string; externalUrl?: string; externalUrls?: string[]; mode?: EditorMode; structured?: StructuredPost; chartSource?: string; chartSymbol?: string; chartInterval?: string; chartTheme?: "auto" | "light" | "dark" } | null;
        if (stored) {
          setTitle(stored.title || "");
          setBody(stored.body || "");
          const storedReferences = stored.externalUrls?.length ? stored.externalUrls : stored.externalUrl ? [stored.externalUrl] : [""];
          setReferences(storedReferences.slice(0, MAX_EXTERNAL_REFERENCES).map((url) => ({ key: crypto.randomUUID(), url })));
          setMode(stored.mode === "professional" ? "professional" : "simple");
          if (stored.structured) setStructured({ ...blankStructured, ...stored.structured });
          setChartSource(stored.chartSource || "");
          setChartSymbol(stored.chartSymbol || "");
          setChartInterval(stored.chartInterval || "D");
          setChartTheme(stored.chartTheme || "auto");
        }
      } catch {
        localStorage.removeItem(draftKey);
      }
      setDraftLoaded(true);
    }, 0);
    return () => window.clearTimeout(restoreDraft);
  }, [draftKey, post]);

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(() => {
    if (!draftLoaded || post) return;
    const timer = window.setTimeout(() => {
      const externalUrls = references.map((reference) => reference.url);
      const draft = { title, body, externalUrls, mode, structured, chartSource, chartSymbol, chartInterval, chartTheme, savedAt: new Date().toISOString() };
      if (title.trim() || body.trim() || externalUrls.some((url) => url.trim()) || mode === "professional" && Object.values(structured).some((value) => value.trim()) || chartSource.trim() || chartSymbol.trim()) localStorage.setItem(draftKey, JSON.stringify(draft));
      else localStorage.removeItem(draftKey);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [body, chartInterval, chartSource, chartSymbol, chartTheme, draftKey, draftLoaded, mode, post, references, structured, title]);

  useEffect(() => () => {
    imagesRef.current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
  }, []);

  function addImages(files: File[]) {
    const combined = [...images.map((image) => image.file), ...files];
    const imageError = combined.length + existingImages.length > MAX_IMAGES ? "每篇帖子最多上传 9 张图片。" : validateImages(combined);
    if (imageError) {
      setErrors((current) => ({ ...current, images: imageError }));
      return;
    }
    setErrors((current) => ({ ...current, images: undefined }));
    setImages((current) => [
      ...current,
      ...files.map((file) => ({ key: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file), caption: "" })),
    ]);
  }

  function removeImage(key: string) {
    setImages((current) => {
      const target = current.find((image) => image.key === key);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((image) => image.key !== key);
    });
  }

  function handlePaste(event: ClipboardEvent<HTMLFormElement>) {
    const files = imageFiles(Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file)));
    if (files.length) {
      event.preventDefault();
      addImages(files);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    addImages(imageFiles(event.dataTransfer.files));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const finalBody = mode === "professional" ? compileStructuredPost({ ...structured, notes: body }, board) : body;
    let chartPackage: TradingViewPackage | null = null;
    try {
      if (mode === "professional") chartPackage = buildTradingViewPackage({ source: chartSource, symbol: chartSymbol, interval: chartInterval, theme: chartTheme });
    } catch (cause) {
      setErrors({ form: cause instanceof Error ? cause.message : "TradingView 图表配置无效。" });
      return;
    }
    const validation = validatePost({ board, title, body: finalBody, externalUrls: references.map((reference) => reference.url), imageCount: images.length + existingImages.length, mode });
    const imageError = validateImages(images.map((image) => image.file));
    if (!validation.ok || imageError) {
      setErrors({ ...validation.fields, images: imageError || undefined });
      return;
    }
    if (!validation.value.board) return;

    setPending(true);
    setErrors({});
    try {
      const client = createClient();
      const result = await client.auth.getUser();
      if (!result.data.user || result.data.user.id !== userId) throw new Error("登录状态已失效");
      const postId = post?.id || await createPost(client, {
          userId,
          board: validation.value.board,
          title: validation.value.title,
          body: validation.value.body,
          externalReferences: validation.value.externalReferences,
          files: images.map((image) => image.file),
          imageCaptions: images.map((image) => image.caption),
          privateEntryId: source?.id,
          chartPackage,
        });
      if (post) {
        await updatePost(client, post, {
          userId,
          title: validation.value.title,
          body: validation.value.body,
          externalReferences: validation.value.externalReferences,
          keptImageIds: existingImages.map((image) => image.id),
          imageCaptionsById: Object.fromEntries(existingImages.map((image) => [image.id, image.caption ?? ""])),
          files: images.map((image) => image.file),
          newImageCaptions: images.map((image) => image.caption),
          chartPackage,
        });
      }
      localStorage.removeItem(draftKey);
      window.location.assign(new URL(`/community/post/${postId}`, window.location.origin));
    } catch (error) {
      console.error("wavekb:post-save-failed", JSON.stringify(safeErrorDiagnostic(error)));
      setErrors({ form: friendlyError(error) });
      setPending(false);
    }
  }

  function patchStructured(key: keyof StructuredPost, value: string) {
    setStructured((current) => ({ ...current, [key]: value }));
  }

  function changeMode(value: EditorMode) {
    if (value === mode) return;
    if (value === "professional") {
      const parsed = parseStructuredPost(body);
      if (parsed) {
        setStructured(parsed);
        setBody(parsed.notes);
      } else if (!structured.thesis.trim()) {
        setStructured((current) => ({ ...current, thesis: body.trim() }));
        setBody("");
      }
    } else {
      const nextStructured = { ...structured, notes: body };
      setStructured(nextStructured);
      setBody(compileStructuredPost(nextStructured, board));
    }
    setMode(value);
  }

  function refreshChart() {
    try {
      const value = buildTradingViewPackage({ source: chartSource, symbol: chartSymbol, interval: chartInterval, theme: chartTheme });
      setChartPreview(value);
      if (value) { setChartSymbol(value.symbol); setChartInterval(value.interval); }
      setErrors((current) => ({ ...current, form: undefined }));
    } catch (cause) {
      setErrors((current) => ({ ...current, form: cause instanceof Error ? cause.message : "TradingView 图表配置无效。" }));
    }
  }

  return (
    <form className="grid gap-7 rounded-xl border bg-surface p-5 md:p-8" onSubmit={submit} onPaste={handlePaste}>
      {source ? <div className="rounded-lg border border-primary/25 bg-primary/8 p-3 text-sm leading-6"><strong>正在整理私人记录的公开副本。</strong><span className="text-muted-foreground"> 只有标题、正文和本页新增的公开图片会进入帖子，复盘核验字段与私密图片不会公开。</span></div> : null}
      <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-1" role="tablist" aria-label="发布模式">
        {([ ["simple", "简易发布"], ["professional", "专业分析"] ] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={mode === value} className={`min-h-10 rounded-lg px-3 text-sm font-semibold ${mode === value ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground"}`} onClick={() => changeMode(value)}>{label}</button>)}
      </div>
      <Field>
        <Label htmlFor="post-title">标题</Label>
        <Input id="post-title" value={title} onChange={(event) => setTitle(event.target.value)} minLength={5} maxLength={120} required aria-invalid={Boolean(errors.title)} aria-describedby={errors.title ? "post-title-error" : "post-title-help"} />
        {errors.title ? <FieldMessage id="post-title-error">{errors.title}</FieldMessage> : <p id="post-title-help" className="text-xs text-muted-foreground">5-120 个字符，直接说明研究对象和判断。</p>}
      </Field>

      {mode === "professional" ? <>
        <section className="grid gap-5 rounded-xl border bg-muted/35 p-4 md:p-6" aria-labelledby="research-context-title">
          <header><h2 id="research-context-title" className="text-xl font-semibold">分析坐标</h2><p className="mt-1 text-sm text-muted-foreground">先固定市场、品种、周期与浪型上下文。</p></header>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <Field><Label htmlFor="research-market">市场分类</Label><select id="research-market" className={selectClass} value={structured.market} onChange={(event) => patchStructured("market", event.target.value)}>{MARKET_GROUPS.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
            <Field><Label htmlFor="research-instrument">品种</Label><Input id="research-instrument" value={structured.instrument} onChange={(event) => patchStructured("instrument", event.target.value)} placeholder="BTC、黄金、标普500" /></Field>
            <Field><Label htmlFor="research-timeframe">周期</Label><select id="research-timeframe" className={selectClass} value={structured.timeframe} onChange={(event) => patchStructured("timeframe", event.target.value)}>{RESEARCH_TIMEFRAMES.map((value) => <option key={value}>{value}</option>)}</select></Field>
            <Field><Label htmlFor="research-pattern">浪型</Label><select id="research-pattern" className={selectClass} value={structured.pattern} onChange={(event) => patchStructured("pattern", event.target.value)}>{WAVE_PATTERNS.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
            <Field><Label htmlFor="research-position">当前子浪</Label><select id="research-position" className={selectClass} value={structured.position} onChange={(event) => patchStructured("position", event.target.value)}>{WAVE_POSITIONS.map((value) => <option key={value} value={value}>{value === "unknown" ? "待确认" : value}</option>)}</select></Field>
            <Field><Label htmlFor="research-direction">方向</Label><select id="research-direction" className={selectClass} value={structured.direction} onChange={(event) => patchStructured("direction", event.target.value)}>{DIRECTIONS.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
          </div>
        </section>
        <section className="grid gap-5" aria-labelledby="research-analysis-title">
          <h2 id="research-analysis-title" className="text-xl font-semibold">结构化分析</h2>
          <Field><Label htmlFor="research-thesis">{board === "question_answers" ? "问题与当前判断" : board === "review_answers" ? "复盘对象与原始判断" : board === "case_submission" ? "分析背景与核心判断" : "核心观点"}</Label><Textarea id="research-thesis" rows={4} value={structured.thesis} onChange={(event) => patchStructured("thesis", event.target.value)} /></Field>
          {board === "case_submission" ? <><Field><Label htmlFor="research-primary">首选计数</Label><Textarea id="research-primary" rows={4} value={structured.primaryCount} onChange={(event) => patchStructured("primaryCount", event.target.value)} /></Field><Field><Label htmlFor="research-alternate">备选计数</Label><Textarea id="research-alternate" rows={4} value={structured.alternateCount} onChange={(event) => patchStructured("alternateCount", event.target.value)} /></Field><Field><Label htmlFor="research-confirmation">成立与确认条件</Label><Textarea id="research-confirmation" rows={3} value={structured.confirmation} onChange={(event) => patchStructured("confirmation", event.target.value)} /></Field></> : null}
          <Field><Label htmlFor="research-evidence">规则与指南依据</Label><Textarea id="research-evidence" rows={4} value={structured.evidence} onChange={(event) => patchStructured("evidence", event.target.value)} /></Field>
          <Field><Label htmlFor="research-invalidation">{board === "review_answers" ? "最终走势与偏差" : board === "case_submission" ? "失效条件" : "适用边界与反例"}</Label><Textarea id="research-invalidation" rows={3} value={structured.invalidation} onChange={(event) => patchStructured("invalidation", event.target.value)} /></Field>
          {!(["case_submission", "question_answers", "review_answers"] as string[]).includes(board) ? <Field><Label htmlFor="research-application">实际应用</Label><Textarea id="research-application" rows={3} value={structured.application} onChange={(event) => patchStructured("application", event.target.value)} /></Field> : null}
          <Field><Label htmlFor="research-question">{board === "question_answers" || board === "review_answers" ? "希望得到的回答" : "希望讨论的问题"}</Label><Textarea id="research-question" rows={3} value={structured.question} onChange={(event) => patchStructured("question", event.target.value)} /></Field>
        </section>
        <section className="grid gap-5 rounded-xl border bg-muted/35 p-4 md:p-6" aria-labelledby="public-chart-title">
          <header><h2 id="public-chart-title" className="text-xl font-semibold">TradingView 图表</h2><p className="mt-1 text-sm text-muted-foreground">图表只在读者打开详情页时加载；本站不会读取 TradingView 密码。</p></header>
          <div className="grid gap-5 sm:grid-cols-2"><Field className="sm:col-span-2"><Label htmlFor="public-chart-source">公开图表链接或品种代码</Label><Input id="public-chart-source" value={chartSource} onChange={(event) => setChartSource(event.target.value)} placeholder="https://www.tradingview.com/chart/... 或 BINANCE:BTCUSDT" /></Field><Field><Label htmlFor="public-chart-symbol">品种代码</Label><Input id="public-chart-symbol" value={chartSymbol} onChange={(event) => setChartSymbol(event.target.value)} /></Field><Field><Label htmlFor="public-chart-interval">周期</Label><Input id="public-chart-interval" value={chartInterval} onChange={(event) => setChartInterval(event.target.value)} placeholder="4小时、D、60" /></Field><Field><Label htmlFor="public-chart-theme">主题</Label><select id="public-chart-theme" className={selectClass} value={chartTheme} onChange={(event) => setChartTheme(event.target.value as "auto" | "light" | "dark")}><option value="auto">跟随网站</option><option value="dark">深色</option><option value="light">浅色</option></select></Field></div>
          <div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" onClick={refreshChart}>识别并预览</Button><Button asChild type="button" variant="ghost"><a href="https://www.tradingview.com/accounts/signin/" target="_blank" rel="noreferrer">打开 TradingView 官方登录</a></Button></div>
          {chartPreview ? <iframe title={`${chartPreview.symbol} TradingView 图表预览`} src={tradingViewEmbedUrl(chartPreview)} className="h-[420px] w-full rounded-xl border bg-background" loading="lazy" referrerPolicy="no-referrer" /> : null}
        </section>
      </> : null}

      <Field>
        <Label htmlFor="post-body">正文</Label>
        <Textarea id="post-body" value={body} onChange={(event) => setBody(event.target.value)} rows={14} maxLength={20_000} aria-invalid={Boolean(errors.body)} aria-describedby={errors.body ? "post-body-error" : "post-body-help"} />
        {errors.body ? <FieldMessage id="post-body-error">{errors.body}</FieldMessage> : <p id="post-body-help" className="text-xs text-muted-foreground">{mode === "professional" ? "补充未包含在结构化字段中的说明；最终正文会自动编排。" : "没有图片时至少 20 个字符。可直接粘贴截图。"}</p>}
      </Field>

      <Field>
        <div className="flex items-end justify-between gap-3">
          <div>
            <Label htmlFor="post-images">图片</Label>
            <p className="mt-1 text-xs text-muted-foreground">JPG、PNG、WebP，单张不超过 10 MiB，最多 9 张。</p>
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">{images.length + existingImages.length}/{MAX_IMAGES}</span>
        </div>
        <div onDragOver={(event) => event.preventDefault()} onDrop={handleDrop} className="grid min-h-28 place-items-center gap-3 rounded-xl border border-dashed bg-muted/45 p-5 text-center">
          <ImageSquare aria-hidden size={28} weight="duotone" className="text-primary" />
          <div className="text-sm"><span className="font-medium">拖入或粘贴图片</span><span className="text-muted-foreground">，也可以从设备选择</span></div>
          <Button asChild type="button" variant="secondary" size="small">
            <label htmlFor="post-images" className="cursor-pointer"><UploadSimple aria-hidden size={16} />选择图片</label>
          </Button>
          <input id="post-images" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(event) => {
            if (event.target.files) addImages(imageFiles(event.target.files));
            event.target.value = "";
          }} />
        </div>
        {errors.images ? <FieldMessage>{errors.images}</FieldMessage> : null}
        {existingImages.length || images.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="待发布图片">
            {existingImages.map((image, index) => (
              <figure key={image.id} className="relative overflow-hidden rounded-xl border bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={publicPostImageUrl(image.storage_path)} alt={`现有图片 ${index + 1}`} className="aspect-square h-auto w-full object-cover" />
                <Button type="button" variant="danger" size="icon" aria-label={`移除现有图片 ${index + 1}`} className="absolute right-2 top-2 size-9" onClick={() => setExistingImages((current) => current.filter((item) => item.id !== image.id))}>
                  <Trash aria-hidden size={17} />
                </Button>
                <Input aria-label={`现有图片 ${index + 1} 说明`} value={image.caption ?? ""} maxLength={240} placeholder={`图 ${index + 1} 说明（可选）`} className="rounded-none border-x-0 border-b-0 bg-surface" onChange={(event) => setExistingImages((current) => current.map((item) => item.id === image.id ? { ...item, caption: event.target.value } : item))} />
              </figure>
            ))}
            {images.map((image, index) => (
              <figure key={image.key} className="relative overflow-hidden rounded-xl border bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.previewUrl} alt={`待发布图片 ${index + 1}`} className="aspect-square h-auto w-full object-cover" />
                <Button type="button" variant="danger" size="icon" aria-label={`移除图片 ${index + 1}`} className="absolute right-2 top-2 size-9" onClick={() => removeImage(image.key)}>
                  <Trash aria-hidden size={17} />
                </Button>
                <Input aria-label={`待发布图片 ${index + 1} 说明`} value={image.caption} maxLength={240} placeholder={`图 ${existingImages.length + index + 1} 说明（可选）`} className="rounded-none border-x-0 border-b-0 bg-surface" onChange={(event) => setImages((current) => current.map((item) => item.key === image.key ? { ...item, caption: event.target.value } : item))} />
              </figure>
            ))}
          </div>
        ) : null}
      </Field>

      <section className="grid gap-4 border-t pt-6" aria-labelledby="post-media-title">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="post-media-title" className="flex items-center gap-2 text-lg font-semibold"><LinkSimple aria-hidden size={19} />媒体与外部引用</h2>
            <p className="mt-1 text-xs text-muted-foreground">支持 YouTube 视频和 X 帖子，最多 {MAX_EXTERNAL_REFERENCES} 条；详情页会安全地延迟加载。</p>
          </div>
          <Button type="button" variant="secondary" size="small" disabled={references.length >= MAX_EXTERNAL_REFERENCES} onClick={() => setReferences((current) => [...current, { key: crypto.randomUUID(), url: "" }])}>
            <Plus aria-hidden size={16} />添加引用
          </Button>
        </header>
        <div className="grid gap-3">
          {references.map((reference, index) => {
            const parsed = parseExternalReference(reference.url);
            const recognized = reference.url.trim() && parsed.ok && parsed.kind;
            return (
              <Field key={reference.key} className="rounded-xl border bg-muted/35 p-3">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor={`external-url-${reference.key}`}>媒体引用 {index + 1}</Label>
                  <Button type="button" variant="ghost" size="icon" className="size-9" aria-label={`删除媒体引用 ${index + 1}`} onClick={() => setReferences((current) => current.length === 1 ? [{ key: crypto.randomUUID(), url: "" }] : current.filter((item) => item.key !== reference.key))}><Trash aria-hidden size={16} /></Button>
                </div>
                <Input id={`external-url-${reference.key}`} type="url" inputMode="url" value={reference.url} onChange={(event) => setReferences((current) => current.map((item) => item.key === reference.key ? { ...item, url: event.target.value } : item))} placeholder="https://www.youtube.com/watch?v=... 或 https://x.com/.../status/..." aria-invalid={Boolean(reference.url.trim() && !parsed.ok)} />
                {recognized ? <p className="text-xs font-medium text-primary">已识别为 {parsed.kind === "youtube" ? "YouTube 视频" : "X 帖子"}</p> : reference.url.trim() ? <p className="text-xs text-destructive">{parsed.error}</p> : null}
              </Field>
            );
          })}
        </div>
        {errors.externalUrl ? <FieldMessage id="external-url-error">{errors.externalUrl}</FieldMessage> : null}
      </section>

      {errors.form ? <FieldMessage role="alert" className="rounded-lg border border-destructive/35 bg-destructive/10 p-3">{errors.form}</FieldMessage> : null}
      <div className="flex flex-col-reverse gap-3 border-t pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">{post ? "保存成功后，移除的旧图片会从存储中清理。" : "文字草稿自动保存在这台设备。图片需要发布时才上传。"}</p>
        <Button type="submit" size="large" disabled={!hydrated || pending}>{pending ? "正在保存" : post ? "保存修改" : "发布内容"}</Button>
      </div>
    </form>
  );
}
