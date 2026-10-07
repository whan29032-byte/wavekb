"use client";

import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent } from "react";
import { ChartLine, LinkSimple, Plus, Trash, UploadSimple } from "@phosphor-icons/react";
import { MAX_EXTERNAL_REFERENCES, MAX_IMAGES, parseExternalReference, validateImages, validatePost, type BoardSlug, type CommunityPost, type PrivateEntry } from "@wavekb/domain";
import { Button, Field, FieldMessage, Input, Label, Textarea } from "@wavekb/ui";
import { createPost, updatePost, type PostPublishingProgress } from "@/lib/community/client-repository";
import { compileStructuredPost, DIRECTIONS, MARKET_GROUPS, parseEditableStructuredPost, RESEARCH_TIMEFRAMES, WAVE_PATTERNS, WAVE_POSITIONS, type StructuredPost } from "@/lib/community/research-catalog";
import { useComposerDraft } from "@/hooks/use-composer-draft";
import { createClient } from "@/lib/supabase/client";
import { publicPostImageUrl } from "@/lib/env";
import { buildTradingViewPackage, tradingViewEmbedUrl, type TradingViewPackage } from "@/lib/workbench/tradingview";

type SelectedImage = { key: string; file: File; previewUrl: string; caption: string };
type MediaDraft = { key: string; url: string };
type ComposerErrors = Partial<Record<"title" | "body" | "externalUrl" | "images" | "chart" | "form", string>>;
type EditorMode = "simple" | "professional";
type ComposerProps = { board: BoardSlug; userId: string; post?: CommunityPost; source?: PrivateEntry };

const blankStructured: StructuredPost = { market: "crypto", instrument: "", timeframe: "4小时", pattern: "unknown", position: "unknown", direction: "unknown", thesis: "", evidence: "", invalidation: "", question: "", primaryCount: "", alternateCount: "", confirmation: "", application: "", notes: "" };
const selectClass = "h-11 w-full rounded-lg border border-input bg-surface px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

function imageFiles(files: FileList | File[]): File[] {
  return Array.from(files).filter((file) => file.type.startsWith("image/"));
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String((error as { message?: unknown } | null)?.message ?? "");
  if (/row-level security|permission denied|not authorized|jwt|登录状态已失效/i.test(message)) return "登录状态已失效，请重新登录后再试。当前输入仍保留在本页。";
  if (/storage|upload|network|fetch/i.test(message)) return "网络或图片上传没有完成。当前输入和已选图片仍保留在本页，请检查网络后重试。";
  return "保存没有完成。当前输入仍保留在本页，请稍后重试。";
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

export function PostComposer(props: ComposerProps) {
  // App Router can reuse this page when the private source or edited post changes.
  return <PostComposerForm key={`${props.userId}:${props.board}:${props.post?.id || props.source?.id || "new"}:${props.post?.updated_at || props.source?.updated_at || "new"}`} {...props} />;
}

function PostComposerForm({ board, userId, post, source }: ComposerProps) {
  const draftKey = `wavekb:next:composer:${userId}:${board}:${post?.id || (source ? `source:${source.id}` : "new")}`;
  const restoredPost = useMemo(() => post ? parseEditableStructuredPost(post.body, board) : null, [post, board]);
  const [title, setTitle] = useState(post?.title || source?.title || "");
  const [body, setBody] = useState(restoredPost ? restoredPost.notes : post?.body || source?.body || "");
  const [references, setReferences] = useState<MediaDraft[]>(() => {
    const existing = post?.external_references?.length
      ? post.external_references.map((reference) => reference.url)
      : post?.external_url ? [post.external_url] : [""];
    return existing.map((url) => ({ key: crypto.randomUUID(), url }));
  });
  const [mode, setMode] = useState<EditorMode>(restoredPost ? "professional" : "simple");
  const [structured, setStructured] = useState<StructuredPost>(restoredPost || blankStructured);
  const initialChart = post?.chart_package as TradingViewPackage | null;
  const [chartSource, setChartSource] = useState(initialChart?.chart_url || initialChart?.symbol || "");
  const [chartSymbol, setChartSymbol] = useState(initialChart?.symbol || "");
  const [chartInterval, setChartInterval] = useState(initialChart?.interval || "D");
  const [chartTheme, setChartTheme] = useState(initialChart?.theme || "auto");
  const [chartPreview, setChartPreview] = useState<TradingViewPackage | null>(null);
  const [showReferences, setShowReferences] = useState(Boolean(post?.external_references?.some((reference) => reference.url.trim()) || post?.external_url?.trim()));
  const [showChart, setShowChart] = useState(Boolean(initialChart));
  const [existingImages, setExistingImages] = useState(() => [...(post?.post_images || [])].sort((a, b) => a.sort_order - b.sort_order));
  const [images, setImages] = useState<SelectedImage[]>([]);
  const [errors, setErrors] = useState<ComposerErrors>({});
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState<PostPublishingProgress | null>(null);
  const [savedPostId, setSavedPostId] = useState<string | null>(null);
  const [restoreImageNotice, setRestoreImageNotice] = useState(false);
  const imagesRef = useRef(images);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const submittingRef = useRef(false);
  const publishedRef = useRef(false);
  const validationFocusRef = useRef<string | null>(null);
  const referenceCount = references.filter((reference) => reference.url.trim()).length;

  const draftValue = useMemo(() => ({
    title, body, externalUrls: references.map((reference) => reference.url), mode, structured,
    chartSource, chartSymbol, chartInterval, chartTheme,
    keptImageIds: existingImages.map((image) => image.id),
    imageCaptionsById: Object.fromEntries(existingImages.map((image) => [image.id, image.caption ?? ""])),
    newImageCount: images.length, baseUpdatedAt: post?.updated_at ?? source?.updated_at ?? null,
  }), [title, body, references, mode, structured, chartSource, chartSymbol, chartInterval, chartTheme, existingImages, images.length, post?.updated_at, source?.updated_at]);

  function restoreDraft(value: unknown): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const stored = value as Record<string, unknown>;
    if (typeof stored.title !== "string" || typeof stored.body !== "string") return false;
    setTitle(stored.title.slice(0, 120));
    setBody(stored.body.slice(0, 20_000));
    const urls = Array.isArray(stored.externalUrls) ? stored.externalUrls : typeof stored.externalUrl === "string" ? [stored.externalUrl] : [""];
    const restoredUrls = urls.filter((url): url is string => typeof url === "string").slice(0, MAX_EXTERNAL_REFERENCES);
    setReferences((restoredUrls.length ? restoredUrls : [""]).map((url) => ({ key: crypto.randomUUID(), url })));
    setShowReferences(urls.some((url) => typeof url === "string" && url.trim()));
    setShowChart(Boolean(initialChart || (typeof stored.chartSource === "string" && stored.chartSource.trim()) || (typeof stored.chartSymbol === "string" && stored.chartSymbol.trim())));
    setMode(stored.mode === "professional" ? "professional" : "simple");
    if (stored.structured && typeof stored.structured === "object") {
      const fields = stored.structured as Record<string, unknown>;
      setStructured(Object.fromEntries(Object.entries(blankStructured).map(([key, fallback]) => [key, typeof fields[key] === "string" ? fields[key].slice(0, 20_000) : fallback])) as StructuredPost);
    }
    for (const [key, setter] of [["chartSource", setChartSource], ["chartSymbol", setChartSymbol], ["chartInterval", setChartInterval]] as const) {
      if (typeof stored[key] === "string") setter(stored[key]);
    }
    if (stored.chartTheme === "auto" || stored.chartTheme === "dark" || stored.chartTheme === "light") setChartTheme(stored.chartTheme);
    if (post && Array.isArray(stored.keptImageIds)) {
      const captions = stored.imageCaptionsById as Record<string, unknown> | undefined;
      setExistingImages(post.post_images.filter((image) => (stored.keptImageIds as unknown[]).includes(image.id)).sort((a, b) => a.sort_order - b.sort_order).map((image) => ({ ...image, caption: typeof captions?.[image.id] === "string" ? String(captions[image.id]).slice(0, 240) : image.caption })));
    }
    setRestoreImageNotice(Number(stored.newImageCount ?? 0) > 0);
    return true;
  }
  const draft = useComposerDraft(draftKey, draftValue, restoreDraft);

  useEffect(() => {
    if (!validationFocusRef.current) return;
    formRef.current?.querySelector<HTMLElement>(validationFocusRef.current)?.focus();
    validationFocusRef.current = null;
  }, [errors]);

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(() => () => {
    imagesRef.current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
  }, []);

  useEffect(() => {
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      if (!publishedRef.current && (imagesRef.current.length || submittingRef.current)) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, []);

  function addImages(files: File[]) {
    if (submittingRef.current || publishedRef.current || !draft.loaded || draft.conflict) return;
    const combined = [...imagesRef.current.map((image) => image.file), ...files];
    const imageError = combined.length + existingImages.length > MAX_IMAGES ? "每篇帖子最多上传 9 张图片。" : validateImages(combined);
    if (imageError) {
      setErrors((current) => ({ ...current, images: imageError }));
      return;
    }
    setErrors((current) => ({ ...current, images: undefined }));
    const next = [
      ...imagesRef.current,
      ...files.map((file) => ({ key: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file), caption: "" })),
    ];
    imagesRef.current = next;
    setImages(next);
  }

  function removeImage(key: string) {
    if (submittingRef.current || publishedRef.current) return;
    const target = imagesRef.current.find((image) => image.key === key);
    if (target) URL.revokeObjectURL(target.previewUrl);
    const next = imagesRef.current.filter((image) => image.key !== key);
    imagesRef.current = next;
    setImages(next);
  }

  function handlePaste(event: ClipboardEvent<HTMLFormElement>) {
    const files = imageFiles(Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file)));
    if (files.length) {
      if (!event.clipboardData.getData("text/plain")) event.preventDefault();
      addImages(files);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const files = imageFiles(event.dataTransfer.files);
    if (event.dataTransfer.files.length && !files.length) {
      setErrors((current) => ({ ...current, images: "图片只支持 JPG、PNG 或 WebP。" }));
      return;
    }
    if (files.length) addImages(files);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current || publishedRef.current || !draft.loaded || draft.conflict) return;
    const finalBody = mode === "professional" ? compileStructuredPost({ ...structured, notes: body }, board) : body;
    let chartPackage: TradingViewPackage | null = null;
    try {
      chartPackage = buildTradingViewPackage({ source: chartSource, symbol: chartSymbol, interval: chartInterval, theme: chartTheme, layout: initialChart?.layout });
    } catch (cause) {
      setShowChart(true);
      validationFocusRef.current = "#public-chart-source";
      setErrors({ chart: cause instanceof Error ? cause.message : "TradingView 图表配置无效。" });
      return;
    }
    const validation = validatePost({ board, title, body: finalBody, externalUrls: references.map((reference) => reference.url), imageCount: images.length + existingImages.length, mode });
    const imageError = validateImages(images.map((image) => image.file));
    if (!validation.ok || imageError) {
      if (validation.fields.externalUrl) setShowReferences(true);
      validationFocusRef.current = validation.fields.title ? "#post-title" : validation.fields.body ? "#post-body" : validation.fields.externalUrl ? 'input[type="url"][aria-invalid="true"]' : '[data-image-picker]';
      setErrors({ ...validation.fields, images: imageError || undefined });
      return;
    }
    if (!validation.value.board) return;

    submittingRef.current = true;
    draft.flush();
    setPending(true);
    setProgress({ phase: "preparing", completed: 0, total: images.length });
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
          onProgress: setProgress,
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
          onProgress: setProgress,
        });
      }
      publishedRef.current = true;
      draft.complete();
      setSavedPostId(postId);
      // Server writes have succeeded. Navigation/local storage are not part of
      // that transaction and must never turn success into a retryable failure.
      try { window.location.assign(new URL(`/community/post/${postId}`, window.location.origin)); }
      catch { /* Keep the explicit success link below if navigation is blocked. */ }
    } catch (error) {
      console.error("wavekb:post-save-failed", JSON.stringify(safeErrorDiagnostic(error)));
      setErrors({ form: friendlyError(error) });
      setPending(false);
      submittingRef.current = false;
      setProgress(null);
    }
  }

  function patchStructured(key: keyof StructuredPost, value: string) {
    setStructured((current) => ({ ...current, [key]: value }));
  }

  function changeMode(value: EditorMode) {
    if (value === mode) return;
    if (value === "professional") {
      const parsed = parseEditableStructuredPost(body, board);
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
      setErrors((current) => ({ ...current, chart: undefined }));
    } catch (cause) {
      validationFocusRef.current = "#public-chart-source";
      setErrors((current) => ({ ...current, chart: cause instanceof Error ? cause.message : "TradingView 图表配置无效。" }));
    }
  }

  return (
    <form ref={formRef} className="grid gap-5 rounded-xl border bg-surface p-5 md:p-8 [&_select]:text-base sm:[&_select]:text-sm" onSubmit={submit} onPaste={handlePaste} onBlur={draft.flush} aria-busy={pending} noValidate>
      {draft.conflict ? <div className="grid gap-3 rounded-lg border border-primary/25 bg-primary/8 p-4 text-sm"><p>旧草稿不会自动覆盖最新内容。选择保留服务器内容，或明确恢复本机草稿后继续编辑。</p><div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" className="min-h-11" onClick={() => draft.resolveConflict(false)}>保留服务器内容</Button><Button type="button" variant="secondary" className="min-h-11" onClick={() => draft.resolveConflict(true)}>恢复本机草稿</Button></div></div> : null}
      {restoreImageNotice ? <p className="rounded-lg border bg-muted p-3 text-sm">文字已恢复，之前选择的本机图片需要重新添加；图片文件不会保存在草稿中。</p> : null}
      <fieldset disabled={!draft.loaded || draft.conflict || pending || Boolean(savedPostId)} className="grid min-w-0 gap-5">
      {source ? <div className="rounded-lg border border-primary/25 bg-primary/8 p-3 text-sm leading-6"><strong>正在整理私人记录的公开副本。</strong><span className="text-muted-foreground"> 只有标题、正文和本页新增的公开图片会进入帖子，复盘核验字段与私密图片不会公开。</span></div> : null}
      <div id="post-editor-panel" className="grid min-w-0 gap-5">
      <Field>
        <div className="flex items-center justify-between gap-3"><Label htmlFor="post-title">标题</Label><Button type="button" variant="ghost" className="min-h-11 text-muted-foreground" aria-label="专业分析" aria-pressed={mode === "professional"} aria-controls="post-editor-panel" onClick={() => changeMode(mode === "professional" ? "simple" : "professional")}>{mode === "professional" ? "返回简易发布" : "专业分析"}</Button></div>
        <Input id="post-title" value={title} onChange={(event) => { setTitle(event.target.value); setErrors((current) => ({ ...current, title: undefined })); }} placeholder="这次想分享什么？" minLength={5} maxLength={120} required aria-invalid={Boolean(errors.title)} aria-describedby={errors.title ? "post-title-error" : "post-title-help"} />
        {errors.title ? <FieldMessage id="post-title-error" role="alert">{errors.title}</FieldMessage> : <p id="post-title-help" className="flex justify-between gap-3 text-xs text-muted-foreground"><span>5–120 个字符</span><span className="tabular-nums">{Array.from(title).length}/120</span></p>}
      </Field>

      {mode === "professional" ? <div id="post-research-fields" className="grid gap-5">
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
      </div> : null}

      <Field>
        <Label htmlFor="post-body">正文</Label>
        <Textarea id="post-body" value={body} onChange={(event) => { setBody(event.target.value); setErrors((current) => ({ ...current, body: undefined })); }} placeholder={mode === "professional" ? "补充说明（可选）" : "写下观点、问题或复盘，也可以直接粘贴截图。"} rows={6} maxLength={20_000} aria-invalid={Boolean(errors.body)} aria-describedby={errors.body ? "post-body-error" : "post-body-help"} />
        {errors.body ? <FieldMessage id="post-body-error" role="alert">{errors.body}</FieldMessage> : <p id="post-body-help" className="flex justify-between gap-3 text-xs text-muted-foreground"><span>{mode === "professional" ? "补充说明可留空" : "至少 20 个字符"}</span><span className="tabular-nums">{Array.from(body).length}/20000</span></p>}
      </Field>

      <Field>
        <div onDragOver={(event) => event.preventDefault()} onDrop={handleDrop} className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" className="min-h-11" data-image-picker aria-label="选择图片" aria-describedby="post-images-help" onClick={() => fileInputRef.current?.click()}>
            <UploadSimple aria-hidden size={16} />图片
          </Button>
          <Button type="button" variant="ghost" className="min-h-11" aria-label={`添加链接${referenceCount ? ` · ${referenceCount}` : ""}`} aria-expanded={showReferences} aria-controls="post-media-fields" onClick={() => setShowReferences((current) => !current)}><LinkSimple aria-hidden size={16} />链接{referenceCount ? ` · ${referenceCount}` : ""}</Button>
          <Button type="button" variant="ghost" className="min-h-11" aria-label={`添加图表${chartSource.trim() || chartSymbol.trim() ? " · 1" : ""}`} aria-expanded={showChart} aria-controls="post-chart-fields" onClick={() => setShowChart((current) => !current)}><ChartLine aria-hidden size={16} />图表{chartSource.trim() || chartSymbol.trim() ? " · 1" : ""}</Button>
          </div>
          <p id="post-images-help" className="text-xs leading-5 text-muted-foreground">支持拖入或粘贴图片 · JPG / PNG / WebP · 单张 10 MiB · {images.length + existingImages.length}/{MAX_IMAGES}</p>
          <input ref={fileInputRef} id="post-images" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(event) => {
            if (event.target.files) addImages(imageFiles(event.target.files));
            event.target.value = "";
          }} />
        </div>
        {errors.images ? <FieldMessage id="post-images-error" role="alert">{errors.images}</FieldMessage> : null}
        {existingImages.length || images.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="待发布图片">
            {existingImages.map((image, index) => (
              <figure key={image.id} className="relative overflow-hidden rounded-xl border bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={publicPostImageUrl(image.storage_path)} alt={`现有图片 ${index + 1}`} className="aspect-square h-auto w-full object-cover" />
                <Button type="button" variant="danger" size="icon" aria-label={`移除现有图片 ${index + 1}`} className="absolute right-2 top-2 size-11" onClick={() => setExistingImages((current) => current.filter((item) => item.id !== image.id))}>
                  <Trash aria-hidden size={17} />
                </Button>
                <Input aria-label={`现有图片 ${index + 1} 说明`} value={image.caption ?? ""} maxLength={240} placeholder={`图 ${index + 1} 说明（可选）`} className="rounded-none border-x-0 border-b-0 bg-surface" onChange={(event) => setExistingImages((current) => current.map((item) => item.id === image.id ? { ...item, caption: event.target.value } : item))} />
              </figure>
            ))}
            {images.map((image, index) => (
              <figure key={image.key} className="relative overflow-hidden rounded-xl border bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.previewUrl} alt={`待发布图片 ${index + 1}`} className="aspect-square h-auto w-full object-cover" />
                <Button type="button" variant="danger" size="icon" aria-label={`移除图片 ${index + 1}`} className="absolute right-2 top-2 size-11" onClick={() => removeImage(image.key)}>
                  <Trash aria-hidden size={17} />
                </Button>
                <Input aria-label={`待发布图片 ${index + 1} 说明`} value={image.caption} maxLength={240} placeholder={`图 ${existingImages.length + index + 1} 说明（可选）`} className="rounded-none border-x-0 border-b-0 bg-surface" onChange={(event) => setImages((current) => current.map((item) => item.key === image.key ? { ...item, caption: event.target.value } : item))} />
              </figure>
            ))}
          </div>
        ) : null}
      </Field>

      <div id="post-chart-fields" hidden={!showChart}>
        <section className="grid gap-4 rounded-xl border bg-muted/35 p-4" aria-labelledby="public-chart-title">
          <header><h2 id="public-chart-title" className="text-base font-semibold">TradingView 图表</h2><p className="mt-1 text-xs text-muted-foreground">点击预览才加载图表，不读取 TradingView 密码。</p></header>
          <div className="grid gap-4 sm:grid-cols-2"><Field className="sm:col-span-2"><Label htmlFor="public-chart-source">公开图表链接或品种代码</Label><Input id="public-chart-source" value={chartSource} aria-invalid={Boolean(errors.chart)} aria-describedby={errors.chart ? "post-chart-error" : undefined} onChange={(event) => { setChartSource(event.target.value); setErrors((current) => ({ ...current, chart: undefined })); }} placeholder="https://www.tradingview.com/chart/... 或 BINANCE:BTCUSDT" /></Field><Field><Label htmlFor="public-chart-symbol">品种代码</Label><Input id="public-chart-symbol" value={chartSymbol} onChange={(event) => setChartSymbol(event.target.value)} /></Field><Field><Label htmlFor="public-chart-interval">周期</Label><Input id="public-chart-interval" value={chartInterval} onChange={(event) => setChartInterval(event.target.value)} placeholder="4小时、D、60" /></Field><Field><Label htmlFor="public-chart-theme">主题</Label><select id="public-chart-theme" className={selectClass} value={chartTheme} onChange={(event) => setChartTheme(event.target.value as "auto" | "light" | "dark")}><option value="auto">跟随网站</option><option value="dark">深色</option><option value="light">浅色</option></select></Field></div>
          {errors.chart ? <FieldMessage id="post-chart-error" role="alert">{errors.chart}</FieldMessage> : null}
          <div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" className="min-h-11" onClick={refreshChart}>识别并预览</Button><Button asChild type="button" variant="ghost" className="min-h-11"><a href="https://www.tradingview.com/accounts/signin/" target="_blank" rel="noreferrer">TradingView 官方登录</a></Button></div>
          {showChart && chartPreview ? <iframe title={`${chartPreview.symbol} TradingView 图表预览`} src={tradingViewEmbedUrl(chartPreview)} className="h-[420px] w-full rounded-xl border bg-background" loading="lazy" referrerPolicy="no-referrer" /> : null}
        </section>
      </div>
      <div id="post-media-fields" hidden={!showReferences}>
      <section className="grid gap-3 rounded-xl border bg-muted/35 p-4" aria-labelledby="post-media-title">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="post-media-title" className="text-base font-semibold">外部链接</h2>
            <p className="mt-1 text-xs text-muted-foreground">YouTube 视频或 X 帖子，最多 {MAX_EXTERNAL_REFERENCES} 条。</p>
          </div>
          <Button type="button" variant="secondary" className="min-h-11" disabled={references.length >= MAX_EXTERNAL_REFERENCES} onClick={() => setReferences((current) => [...current, { key: crypto.randomUUID(), url: "" }])}>
            <Plus aria-hidden size={16} />添加引用
          </Button>
        </header>
        <div className="grid gap-3">
          {references.map((reference, index) => {
            const parsed = parseExternalReference(reference.url);
            const recognized = reference.url.trim() && parsed.ok && parsed.kind;
            return (
              <Field key={reference.key}>
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor={`external-url-${reference.key}`}>媒体引用 {index + 1}</Label>
                  <Button type="button" variant="ghost" size="icon" className="size-11" aria-label={`删除媒体引用 ${index + 1}`} onClick={() => setReferences((current) => current.length === 1 ? [{ key: crypto.randomUUID(), url: "" }] : current.filter((item) => item.key !== reference.key))}><Trash aria-hidden size={16} /></Button>
                </div>
                <Input id={`external-url-${reference.key}`} type="url" inputMode="url" value={reference.url} onChange={(event) => setReferences((current) => current.map((item) => item.key === reference.key ? { ...item, url: event.target.value } : item))} placeholder="https://www.youtube.com/watch?v=... 或 https://x.com/.../status/..." aria-invalid={Boolean(reference.url.trim() && !parsed.ok)} aria-describedby={reference.url.trim() && !parsed.ok ? `media-error-${reference.key}` : undefined} />
                {recognized ? <p className="text-xs font-medium text-primary">已识别为 {parsed.kind === "youtube" ? "YouTube 视频" : "X 帖子"}</p> : reference.url.trim() ? <p id={`media-error-${reference.key}`} className="text-xs text-destructive">{parsed.error}</p> : null}
              </Field>
            );
          })}
        </div>
        {errors.externalUrl ? <FieldMessage id="external-url-error" role="alert">{errors.externalUrl}</FieldMessage> : null}
      </section>
      </div>
      </div>

      {errors.form ? <FieldMessage role="alert" className="rounded-lg border border-destructive/35 bg-destructive/10 p-3">{errors.form}</FieldMessage> : null}
      <div className="flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid max-w-[65ch] gap-1 text-xs leading-5 text-muted-foreground">
          <p role="status" aria-live="polite" aria-atomic="true" className={draft.status === "unavailable" ? "text-destructive" : undefined}>
            {savedPostId ? <>内容已保存。<a className="ml-2 font-semibold text-primary underline underline-offset-4" href={`/community/post/${savedPostId}`}>查看帖子</a></> : pending ? progress?.phase === "uploading" ? `正在上传图片 ${progress.completed}/${progress.total}，请保持本页打开。` : progress?.phase === "publishing" ? progress.total ? "图片已上传，正在保存内容…" : "正在保存内容…" : "正在检查登录并准备保存…" : draft.status === "unavailable" ? "本地存储不可用，草稿无法保存。请保持本页打开，并及时发布或复制正文。" : draft.status === "saved" ? "本机草稿已保存" : draft.status === "restored" ? "已恢复本机草稿" : draft.status === "checking" ? "正在检查本机草稿…" : draft.status === "stale" ? "请先处理旧草稿与服务器版本冲突。" : "草稿自动保存在本机"}
          </p>
          {images.length ? <p>已选图片仅保留在本页，刷新后需要重新选择。</p> : null}
        </div>
        <Button type="submit" size="large">{pending ? "正在保存" : post ? "保存修改" : "发布内容"}</Button>
      </div>
      </fieldset>
    </form>
  );
}
