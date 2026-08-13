"use client";

import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ImageSquare, Trash, UploadSimple } from "@phosphor-icons/react";
import { MAX_IMAGES, validateImages, validatePost, type BoardSlug, type CommunityPost, type PrivateEntry } from "@wavekb/domain";
import { Button, Field, FieldMessage, Input, Label, Textarea } from "@wavekb/ui";
import { createPost, updatePost } from "@/lib/community/client-repository";
import { compileStructuredPost, DIRECTIONS, MARKET_GROUPS, RESEARCH_TIMEFRAMES, WAVE_PATTERNS, WAVE_POSITIONS, type StructuredPost } from "@/lib/community/research-catalog";
import { createClient } from "@/lib/supabase/client";
import { publicPostImageUrl } from "@/lib/env";
import { buildTradingViewPackage, tradingViewEmbedUrl, type TradingViewPackage } from "@/lib/workbench/tradingview";

type SelectedImage = { key: string; file: File; previewUrl: string };
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

export function PostComposer({ board, userId, post, source }: { board: BoardSlug; userId: string; post?: CommunityPost; source?: PrivateEntry }) {
  const router = useRouter();
  const draftKey = `wavekb:next:composer:${userId}:${board}:${post?.id || "new"}`;
  const [title, setTitle] = useState(post?.title || source?.title || "");
  const [body, setBody] = useState(post?.body || source?.body || "");
  const [externalUrl, setExternalUrl] = useState(post?.external_url || "");
  const [mode, setMode] = useState<EditorMode>(post?.chart_package ? "professional" : "simple");
  const [structured, setStructured] = useState<StructuredPost>(blankStructured);
  const initialChart = post?.chart_package as TradingViewPackage | null;
  const [chartSource, setChartSource] = useState(initialChart?.chart_url || initialChart?.symbol || "");
  const [chartSymbol, setChartSymbol] = useState(initialChart?.symbol || "");
  const [chartInterval, setChartInterval] = useState(initialChart?.interval || "D");
  const [chartTheme, setChartTheme] = useState(initialChart?.theme || "auto");
  const [chartPreview, setChartPreview] = useState<TradingViewPackage | null>(initialChart);
  const [existingImages, setExistingImages] = useState(() => [...(post?.post_images || [])].sort((a, b) => a.sort_order - b.sort_order));
  const [images, setImages] = useState<SelectedImage[]>([]);
  const [errors, setErrors] = useState<ComposerErrors>({});
  const [pending, setPending] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const imagesRef = useRef(images);

  useEffect(() => {
    if (post) return;
    const restoreDraft = window.setTimeout(() => {
      try {
        const stored = JSON.parse(localStorage.getItem(draftKey) || "null") as { title?: string; body?: string; externalUrl?: string; mode?: EditorMode; structured?: StructuredPost; chartSource?: string; chartSymbol?: string; chartInterval?: string; chartTheme?: "auto" | "light" | "dark" } | null;
        if (stored) {
          setTitle(stored.title || "");
          setBody(stored.body || "");
          setExternalUrl(stored.externalUrl || "");
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
    const draft = { title, body, externalUrl, mode, structured, chartSource, chartSymbol, chartInterval, chartTheme, savedAt: new Date().toISOString() };
    if (title.trim() || body.trim() || externalUrl.trim() || mode === "professional" && Object.values(structured).some((value) => value.trim()) || chartSource.trim() || chartSymbol.trim()) localStorage.setItem(draftKey, JSON.stringify(draft));
    else localStorage.removeItem(draftKey);
  }, [body, chartInterval, chartSource, chartSymbol, chartTheme, draftKey, draftLoaded, externalUrl, mode, post, structured, title]);

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
      ...files.map((file) => ({ key: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file) })),
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
    const validation = validatePost({ board, title, body: finalBody, externalUrl, imageCount: images.length + existingImages.length, mode });
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
          externalUrl: validation.value.externalUrl,
          externalKind: validation.value.externalKind,
          files: images.map((image) => image.file),
          privateEntryId: source?.id,
          chartPackage,
        });
      if (post) {
        await updatePost(client, post, {
          userId,
          title: validation.value.title,
          body: validation.value.body,
          externalUrl: validation.value.externalUrl,
          externalKind: validation.value.externalKind,
          keptImageIds: existingImages.map((image) => image.id),
          files: images.map((image) => image.file),
          chartPackage,
        });
      }
      localStorage.removeItem(draftKey);
      router.push(`/community/post/${postId}`);
      router.refresh();
    } catch (error) {
      setErrors({ form: friendlyError(error) });
      setPending(false);
    }
  }

  function patchStructured(key: keyof StructuredPost, value: string) {
    setStructured((current) => ({ ...current, [key]: value }));
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
        {([ ["simple", "简易发布"], ["professional", "专业分析"] ] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={mode === value} className={`min-h-10 rounded-lg px-3 text-sm font-semibold ${mode === value ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground"}`} onClick={() => setMode(value)}>{label}</button>)}
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
                <img src={publicPostImageUrl(image.storage_path)} alt={`现有图片 ${index + 1}`} className="aspect-square h-full w-full object-cover" />
                <Button type="button" variant="danger" size="icon" aria-label={`移除现有图片 ${index + 1}`} className="absolute right-2 top-2 size-9" onClick={() => setExistingImages((current) => current.filter((item) => item.id !== image.id))}>
                  <Trash aria-hidden size={17} />
                </Button>
              </figure>
            ))}
            {images.map((image, index) => (
              <figure key={image.key} className="relative overflow-hidden rounded-xl border bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.previewUrl} alt={`待发布图片 ${index + 1}`} className="aspect-square h-full w-full object-cover" />
                <Button type="button" variant="danger" size="icon" aria-label={`移除图片 ${index + 1}`} className="absolute right-2 top-2 size-9" onClick={() => removeImage(image.key)}>
                  <Trash aria-hidden size={17} />
                </Button>
              </figure>
            ))}
          </div>
        ) : null}
      </Field>

      <Field>
        <Label htmlFor="external-url">外部引用（可选）</Label>
        <Input id="external-url" type="url" inputMode="url" value={externalUrl} onChange={(event) => setExternalUrl(event.target.value)} placeholder="https://www.youtube.com/... 或 https://x.com/..." aria-invalid={Boolean(errors.externalUrl)} aria-describedby={errors.externalUrl ? "external-url-error" : "external-url-help"} />
        {errors.externalUrl ? <FieldMessage id="external-url-error">{errors.externalUrl}</FieldMessage> : <p id="external-url-help" className="text-xs text-muted-foreground">只支持完整的 YouTube 或 X HTTPS 链接。</p>}
      </Field>

      {errors.form ? <FieldMessage role="alert" className="rounded-lg border border-destructive/35 bg-destructive/10 p-3">{errors.form}</FieldMessage> : null}
      <div className="flex flex-col-reverse gap-3 border-t pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">{post ? "保存成功后，移除的旧图片会从存储中清理。" : "文字草稿自动保存在这台设备。图片需要发布时才上传。"}</p>
        <Button type="submit" size="large" disabled={pending}>{pending ? "正在保存" : post ? "保存修改" : "发布内容"}</Button>
      </div>
    </form>
  );
}
