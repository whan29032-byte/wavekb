"use client";

import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ImageSquare, Trash, UploadSimple } from "@phosphor-icons/react";
import { MAX_IMAGES, validateImages, validatePost, type BoardSlug, type CommunityPost } from "@wavekb/domain";
import { Button, Field, FieldMessage, Input, Label, Textarea } from "@wavekb/ui";
import { createPost, updatePost } from "@/lib/community/client-repository";
import { createClient } from "@/lib/supabase/client";
import { publicPostImageUrl } from "@/lib/env";

type SelectedImage = { key: string; file: File; previewUrl: string };
type ComposerErrors = Partial<Record<"title" | "body" | "externalUrl" | "images" | "form", string>>;

function imageFiles(files: FileList | File[]): File[] {
  return Array.from(files).filter((file) => file.type.startsWith("image/"));
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/row-level security|permission denied|not authorized|jwt/i.test(message)) return "登录状态已失效，刷新页面并重新登录后再试。";
  if (/storage|upload|network|fetch/i.test(message)) return "图片上传没有完成。草稿仍在本机，请检查网络后重试。";
  return "发布没有完成。草稿仍在本机，请稍后重试。";
}

export function PostComposer({ board, userId, post }: { board: BoardSlug; userId: string; post?: CommunityPost }) {
  const router = useRouter();
  const draftKey = `wavekb:next:composer:${userId}:${board}:${post?.id || "new"}`;
  const [title, setTitle] = useState(post?.title || "");
  const [body, setBody] = useState(post?.body || "");
  const [externalUrl, setExternalUrl] = useState(post?.external_url || "");
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
        const stored = JSON.parse(localStorage.getItem(draftKey) || "null") as { title?: string; body?: string; externalUrl?: string } | null;
        if (stored) {
          setTitle(stored.title || "");
          setBody(stored.body || "");
          setExternalUrl(stored.externalUrl || "");
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
    const draft = { title, body, externalUrl, savedAt: new Date().toISOString() };
    if (title.trim() || body.trim() || externalUrl.trim()) localStorage.setItem(draftKey, JSON.stringify(draft));
    else localStorage.removeItem(draftKey);
  }, [body, draftKey, draftLoaded, externalUrl, post, title]);

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
    const validation = validatePost({ board, title, body, externalUrl, imageCount: images.length + existingImages.length, mode: "simple" });
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

  return (
    <form className="grid gap-7 rounded-xl border bg-surface p-5 md:p-8" onSubmit={submit} onPaste={handlePaste}>
      <Field>
        <Label htmlFor="post-title">标题</Label>
        <Input id="post-title" value={title} onChange={(event) => setTitle(event.target.value)} minLength={5} maxLength={120} required aria-invalid={Boolean(errors.title)} aria-describedby={errors.title ? "post-title-error" : "post-title-help"} />
        {errors.title ? <FieldMessage id="post-title-error">{errors.title}</FieldMessage> : <p id="post-title-help" className="text-xs text-muted-foreground">5-120 个字符，直接说明研究对象和判断。</p>}
      </Field>

      <Field>
        <Label htmlFor="post-body">正文</Label>
        <Textarea id="post-body" value={body} onChange={(event) => setBody(event.target.value)} rows={14} maxLength={20_000} aria-invalid={Boolean(errors.body)} aria-describedby={errors.body ? "post-body-error" : "post-body-help"} />
        {errors.body ? <FieldMessage id="post-body-error">{errors.body}</FieldMessage> : <p id="post-body-help" className="text-xs text-muted-foreground">没有图片时至少 20 个字符。可直接粘贴截图。</p>}
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
