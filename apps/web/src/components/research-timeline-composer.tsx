"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type DragEvent, type FormEvent } from "react";
import { ImageSquare, Trash, UploadSimple } from "@phosphor-icons/react";
import { TIMELINE_NODE_KINDS, validateImages, type TimelineNodeKind } from "@wavekb/domain";
import { Button, Field, FieldMessage, Input, Label, Textarea } from "@wavekb/ui";
import { appendPostTimelineNode } from "@/lib/community/client-repository";
import { createClient } from "@/lib/supabase/client";

type TimelineImageDraft = { key: string; file: File; url: string; caption: string };
const subscribe = () => () => undefined;
const clientSnapshot = () => true;
const serverSnapshot = () => false;
const ALLOWED_KINDS = TIMELINE_NODE_KINDS.filter((kind) => kind !== "published");
const LABELS: Record<TimelineNodeKind, string> = {
  published: "发布观点", update: "更新观点", confirmed: "判断验证", invalidated: "判断失效",
  trade_started: "交易开始", position_added: "加仓", position_reduced: "减仓", stop_updated: "调整止损",
  target_hit: "到达目标", stop_hit: "到达止损", trade_closed: "手动结束", review: "复盘总结",
};

export function ResearchTimelineComposer({ postId, userId }: { postId: string; userId: string }) {
  const hydrated = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const [kind, setKind] = useState<TimelineNodeKind>("update");
  const [body, setBody] = useState("");
  const [images, setImages] = useState<TimelineImageDraft[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const imagesRef = useRef(images);
  useEffect(() => { imagesRef.current = images; }, [images]);
  useEffect(() => () => imagesRef.current.forEach((image) => URL.revokeObjectURL(image.url)), []);

  function addImages(files: File[]) {
    const next = [...images.map((image) => image.file), ...files];
    const imageError = validateImages(next);
    if (imageError) { setError(imageError); return; }
    setError("");
    setImages((current) => [...current, ...files.map((file) => ({ key: crypto.randomUUID(), file, url: URL.createObjectURL(file), caption: "" }))]);
  }
  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    addImages(Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith("image/")));
  }
  function removeImage(key: string) {
    setImages((current) => {
      const target = current.find((image) => image.key === key);
      if (target) URL.revokeObjectURL(target.url);
      return current.filter((image) => image.key !== key);
    });
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = body.trim();
    if (!normalized || normalized.length > 5_000) { setError("更新时间需要 1–5000 个字符。"); return; }
    setPending(true);
    setError("");
    try {
      const client = createClient();
      const actor = await client.auth.getUser();
      if (actor.data.user?.id !== userId) throw new Error("登录状态已失效，请重新登录。");
      await appendPostTimelineNode(client, { postId, userId, kind, body: normalized, files: images.map((image) => image.file), captions: images.map((image) => image.caption) });
      images.forEach((image) => URL.revokeObjectURL(image.url));
      setImages([]);
      setBody("");
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "观点更新没有保存，请稍后重试。");
      setPending(false);
    }
  }
  return (
    <form className="grid gap-4 rounded-xl border bg-muted/25 p-4 md:p-5" onSubmit={submit}>
      <header><h3 className="font-semibold">追加观点更新</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">实质判断变化请新增节点。时间由服务器记录，历史图片不会被覆盖。</p></header>
      <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
        <Field><Label htmlFor="timeline-kind">节点类型</Label><select id="timeline-kind" className="h-11 rounded-lg border border-input bg-surface px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" value={kind} onChange={(event) => setKind(event.target.value as TimelineNodeKind)}>{ALLOWED_KINDS.map((value) => <option key={value} value={value}>{LABELS[value]}</option>)}</select></Field>
        <Field><Label htmlFor="timeline-body">更新内容</Label><Textarea id="timeline-body" rows={5} maxLength={5_000} value={body} onChange={(event) => setBody(event.target.value)} placeholder="记录发生了什么、判断为何改变，以及新的确认或失效条件。" /></Field>
      </div>
      <Field>
        <Label htmlFor="timeline-images">新的研究快照（可选）</Label>
        <div onDragOver={(event) => event.preventDefault()} onDrop={drop} className="mt-1 flex min-h-24 flex-wrap items-center justify-center gap-3 rounded-lg border border-dashed bg-surface p-4 text-sm text-muted-foreground">
          <ImageSquare aria-hidden size={24} /><span>拖入图片，或从设备选择</span>
          <Button asChild type="button" variant="secondary" size="small"><label htmlFor="timeline-images" className="cursor-pointer"><UploadSimple aria-hidden size={16} />选择图片</label></Button>
          <input id="timeline-images" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(event) => { if (event.target.files) addImages(Array.from(event.target.files)); event.target.value = ""; }} />
        </div>
        {images.length ? (
          <div className="grid gap-3 sm:grid-cols-3">
            {images.map((image, index) => (
              <figure key={image.key} className="relative overflow-hidden rounded-lg border bg-surface">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.url} alt={`时间轴待上传图片 ${index + 1}`} className="aspect-video w-full object-cover" />
                <Button type="button" variant="danger" size="icon" className="absolute right-2 top-2 size-9" aria-label={`移除时间轴图片 ${index + 1}`} onClick={() => removeImage(image.key)}><Trash aria-hidden size={16} /></Button>
                <Input aria-label={`时间轴图片 ${index + 1} 说明`} value={image.caption} maxLength={240} placeholder="图片说明（可选）" className="rounded-none border-x-0 border-b-0" onChange={(event) => setImages((current) => current.map((item) => item.key === image.key ? { ...item, caption: event.target.value } : item))} />
              </figure>
            ))}
          </div>
        ) : null}
      </Field>
      {error ? <FieldMessage role="alert">{error}</FieldMessage> : null}
      <div className="flex justify-end"><Button type="submit" disabled={!hydrated || pending}>{pending ? "正在保存" : "发布更新"}</Button></div>
    </form>
  );
}
