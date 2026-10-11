"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, Field, FieldMessage, Input, Label } from "@wavekb/ui";
import { createClient } from "@/lib/supabase/client";
import { analysisImageError, browserAnalysisImageServices, validateAnalysisImage, type AnalysisImagePreview, type AnalysisImageServices } from "@/lib/workbench/analysis-images";
import { normalizeVisionImageIds, VISION_MAX_IMAGES } from "../../../../ai-gateway/src/research/vision-input.ts";

/** Screenshot evidence is opt-in, private, and restricted to this exact step. */
export function WaveVisionInput({ actorId, analysisId, step, instrument, timeframe, value, ensureAnalysis, onChange, onBusyChange, onReadyChange, disabled = false, services }: {
  actorId: string; analysisId: string | null; step: number; instrument: string; timeframe: string; value?: unknown;
  ensureAnalysis: () => Promise<{ id: string }>;
  onChange: (ids: string[]) => void; onBusyChange?: (busy: boolean) => void; onReadyChange?: (ready: boolean) => void;
  disabled?: boolean; services?: AnalysisImageServices;
}) {
  const id = useId();
  const [previewState, setPreviewState] = useState<{ key: string; images: AnalysisImagePreview[] }>({ key: "", images: [] });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const mounted = useRef(false);
  const callbacks = useRef({ onChange, onBusyChange, onReadyChange });
  const contextKey = `${actorId}:${step}:${instrument}:${timeframe}`;
  const latestContext = useRef(contextKey);
  const latestAnalysisId = useRef(analysisId);
  useLayoutEffect(() => {
    callbacks.current = { onChange, onBusyChange, onReadyChange };
    latestContext.current = contextKey; latestAnalysisId.current = analysisId;
  }, [onChange, onBusyChange, onReadyChange, contextKey, analysisId]);
  const selection = useMemo(() => { try { return { ids: normalizeVisionImageIds(value), valid: true }; } catch { return { ids: [], valid: false }; } }, [value]);
  const idsKey = selection.ids.join(",");
  const previewAnalysisId = selection.ids.length ? analysisId : null;
  const previewKey = `${contextKey}:${previewAnalysisId}:${idsKey}`;
  const images = previewState.key === previewKey ? previewState.images : [];
  const supplied = value !== undefined && (!selection.valid || selection.ids.length > 0);
  const port = useMemo(() => {
    if (services) return services;
    try { return browserAnalysisImageServices(createClient()); } catch { return null; }
  }, [services]);

  useEffect(() => {
    mounted.current = true;
    const stop = port?.watchOwner?.(actorId, () => {
      generation.current += 1; setPreviewState({ key: "", images: [] }); setBusy(false); setLoading(false);
      setError(analysisImageError(new Error("image_owner_changed")));
      callbacks.current.onBusyChange?.(false); callbacks.current.onReadyChange?.(false);
    });
    return () => { mounted.current = false; generation.current += 1; stop?.(); callbacks.current.onBusyChange?.(false); };
  }, [actorId, port]);

  useEffect(() => {
    const token = ++generation.current;
    const ids = idsKey ? idsKey.split(",") : [];
    void (async () => {
      // Ownership/context changes mask previous previews during render. Start
      // asynchronous Storage synchronization only after the commit is current.
      await Promise.resolve();
      if (!mounted.current || generation.current !== token) return;
      setPreviewState({ key: "", images: [] }); setLoading(false); setError("");
      callbacks.current.onReadyChange?.(selection.valid && !ids.length);
      if (!selection.valid || !ids.length) return;
      if (!previewAnalysisId || !port) { setError(analysisImageError(new Error("image_unavailable"))); return; }
      setLoading(true);
      try {
        const result = await port.load({ ownerId: actorId, analysisId: previewAnalysisId, step, instrument, timeframe }, ids);
        if (!mounted.current || generation.current !== token) return;
        setPreviewState({ key: previewKey, images: result }); callbacks.current.onReadyChange?.(true);
      } catch (cause) {
        if (mounted.current && generation.current === token) setError(analysisImageError(cause));
      } finally { if (mounted.current && generation.current === token) setLoading(false); }
    })();
  }, [actorId, previewAnalysisId, previewKey, step, instrument, timeframe, idsKey, selection.valid, port, revision]);

  async function upload(files: File[]) {
    if (!files.length || disabled || busy || loading) return;
    setError(""); setStatus("");
    if (!selection.valid) { setError(analysisImageError(new Error("invalid_image_input"))); return; }
    if (selection.ids.length + files.length > VISION_MAX_IMAGES) { setError("本步骤最多选择 3 张截图，请先移除不需要的截图。"); return; }
    try { files.forEach(validateAnalysisImage); } catch (cause) { setError(analysisImageError(cause)); return; }
    if (!port) { setError("截图服务尚未配置，请稍后重试。"); return; }
    const key = latestContext.current;
    // Saving a new analysis may create its ID; this must not invalidate the
    // pending selection. Other owner/context changes always do.
    const beforeSave = generation.current;
    const stillContext = () => mounted.current && latestContext.current === key;
    setBusy(true); callbacks.current.onBusyChange?.(true);
    try {
      await port.verifyOwner(actorId);
      if (!stillContext() || generation.current !== beforeSave) return;
      setStatus("正在保存当前分析并私有上传截图。");
      const saved = await ensureAnalysis();
      if (!stillContext() || generation.current !== beforeSave || (latestAnalysisId.current !== null && latestAnalysisId.current !== saved.id)) return;
      const token = generation.current;
      const isCurrent = () => stillContext() && generation.current === token && (latestAnalysisId.current === null || latestAnalysisId.current === saved.id);
      const uploaded: AnalysisImagePreview[] = [];
      for (const file of files) {
        const image = await port.upload({ ownerId: actorId, analysisId: saved.id, step, instrument, timeframe }, file, isCurrent);
        if (!isCurrent()) return;
        uploaded.push(image);
      }
      await port.verifyOwner(actorId);
      if (!isCurrent()) return;
      const ids = [...selection.ids, ...uploaded.map((image) => image.id)];
      normalizeVisionImageIds(ids);
      callbacks.current.onChange(ids);
      setStatus(`已选择 ${ids.length} 张私有截图；点击 AI 分析时才会提交给本次模型。`);
    } catch (cause) {
      if (stillContext()) { setError(analysisImageError(cause)); setStatus(""); }
    } finally {
      if (mounted.current) { setBusy(false); callbacks.current.onBusyChange?.(false); }
    }
  }

  function remove(imageId?: string) {
    if (disabled || busy) return;
    generation.current += 1; setError(""); setStatus("已移除本步骤引用；云端资料保留，不影响已提交的任务。");
    callbacks.current.onChange(imageId ? selection.ids.filter((item) => item !== imageId) : []);
  }

  return <details className="min-w-0 rounded-lg border bg-background" open={supplied || undefined}>
    <summary className="min-h-11 cursor-pointer rounded-lg px-4 py-3 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">行情截图（可选）{selection.ids.length ? <span className="ml-2 font-normal text-muted-foreground">本步骤 {selection.ids.length} / 3 张</span> : null}</summary>
    <div className="grid min-w-0 gap-4 border-t p-4">
      <p id={`${id}-help`} className="text-sm leading-6 text-muted-foreground">图片私有保存，仅在你点击 AI 分析时发送当前步骤选中的截图给本次模型。不要上传密钥、账户或聊天记录。截图只用于候选结构判断，不能代替精确 OHLC 数据或自动生成真实行情。</p>
      <p className="text-sm leading-6 text-muted-foreground">当前分析：{instrument || "未填写品种"} · {timeframe || "未指定周期"}。模型视觉能力由服务器核实；不支持时会明确拒绝，不会悄悄忽略图片。</p>
      <Field><Label htmlFor={`${id}-file`}>上传行情截图</Label><Input id={`${id}-file`} type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={disabled || busy || loading || selection.ids.length >= VISION_MAX_IMAGES} aria-describedby={`${id}-help ${id}-format`} onChange={(event) => { const files = Array.from(event.target.files || []); event.currentTarget.value = ""; void upload(files); }} /><p id={`${id}-format`} className="text-xs leading-5 text-muted-foreground">JPEG、PNG、WebP，每张 ≤ 2 MiB，每个步骤最多选择 3 张。上传前会先保存当前分析；更换品种或当前周期后需重新上传。预览链接临时有效，分析只保存图片 ID。</p></Field>
      {loading || busy ? <p role="status" className="text-sm text-muted-foreground">{busy ? "正在保存并上传截图…" : "正在核实截图并加载临时预览…"}</p> : null}
      {images.length ? <ul className="grid gap-3 sm:grid-cols-3">{images.map((image, index) => <li key={image.id} className="grid min-w-0 content-start gap-2 rounded-lg border p-2">
        {/* Private signed Storage previews are not public Next image assets. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image.signedUrl} alt={`本步骤行情截图 ${index + 1}`} className="aspect-video w-full rounded-md bg-muted object-contain" referrerPolicy="no-referrer" onError={() => { setError("截图预览已过期或加载失败，请刷新预览。图片引用仍保留。"); callbacks.current.onReadyChange?.(false); }} />
        <p className="text-xs text-muted-foreground">截图 {index + 1} · {Math.ceil(image.byteSize / 1024)} KiB</p>
        <Button type="button" variant="secondary" className="min-h-11 w-full" disabled={disabled || busy} onClick={() => remove(image.id)} aria-label={`移除截图 ${index + 1}`}>移除引用</Button>
      </li>)}</ul> : null}
      {supplied ? <div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" className="min-h-11" disabled={disabled || busy || loading} onClick={() => setRevision((current) => current + 1)}>刷新截图预览</Button><Button type="button" variant="secondary" className="min-h-11" disabled={disabled || busy} onClick={() => remove()}>清除本步骤截图</Button></div> : null}
      {!selection.valid || error ? <FieldMessage role="alert">{!selection.valid ? analysisImageError(new Error("invalid_image_input")) : error}</FieldMessage> : null}
      {status && !busy ? <p role="status" className="text-sm text-muted-foreground">{status}</p> : null}
    </div>
  </details>;
}
