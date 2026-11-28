import type { FillMarker, FillMarkerAnnotationV1 } from "@wavekb/domain/trading-review";
import { Button, Field, FieldHelp, FieldMessage, Input, Label, Textarea } from "@wavekb/ui";
import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import {
  createFillAnnotationWrite,
  downloadFillAnnotationImage,
  FillAnnotationError,
  fillAnnotationBodyLimit,
  fillAnnotationFileTypes,
  loadFillAnnotation,
  validateFillAnnotationDraft,
  validateFillAnnotationFiles,
  type FillAnnotationContext,
  type FillAnnotationImage,
  type FillAnnotationSnapshot,
  type FillAnnotationWrite,
} from "@/lib/trading/fill-annotation-repository";

type FillAnnotationEditorProps = {
  cycleId: string;
  cycleRevision: number;
  fill: FillMarker;
  onSaved?: (fillId: string, annotation: FillMarkerAnnotationV1 | null) => void;
  draftScope?: FillAnnotationDraftScope;
};
type Draft = { body: string; tagsText: string };
type Issue = FillAnnotationError["code"] | "upload_rolled_back";
type SavePhase = "loading" | "idle" | "queued" | "saving" | "saved";
type State = {
  draft: Draft;
  snapshot: FillAnnotationSnapshot | null;
  phase: SavePhase;
  issue: Issue | null;
};
type EditorSession = {
  key: string;
  drafts: FillAnnotationDraftScope;
  context: FillAnnotationContext;
  state: State;
  notify: ((state: State) => void) | null;
  onSaved: ((value: FillMarkerAnnotationV1 | null) => void) | null;
  timer: ReturnType<typeof setTimeout> | null;
  due: boolean;
  edit: number;
  savedEdit: number;
  operation: { perform: FillAnnotationWrite; edit: number } | null;
  images: { files?: File[]; removeId?: string };
  running: Promise<void> | null;
};

export type FillAnnotationDraftScope = Map<string, EditorSession>;

// A chart owns its detached drafts. Reopening an editor verifies the current
// owner before restoring one, and leaving the chart drops the whole scope.
export function createFillAnnotationDraftScope(): FillAnnotationDraftScope {
  return new Map();
}

export function hasDraftForStrategyShare(drafts: FillAnnotationDraftScope, cycleId: string): boolean {
  return [...drafts.values()].some((session) => session.context.cycleId === cycleId && hasPendingDraft(session));
}

const emptyDraft: Draft = { body: "", tagsText: "" };
const messages: Record<Issue, string> = {
  body_length: "备忘录最多 5000 个字符。",
  body_format: "请使用纯文字，去掉 HTML 或可执行内容。",
  tag_count: "最多可加 10 个标签。",
  tag_length: "每个标签最多 40 个字符。",
  image_count: "每笔成交最多添加 5 张图片。",
  image_format: "仅支持非空的 JPEG、PNG、WebP 图片，每张不超过 2 MiB。",
  read: "备忘录暂时无法读取，请重试。",
  write: "备忘录保存失败，请检查内容后重试。",
  uncertain: "暂时无法确认是否已保存，重试时会先核对服务器记录。",
  stale: "交易或备忘录数据已更新。请复制当前内容后刷新页面。",
  upload_rolled_back: "图片上传失败，已撤回本次图片，备忘录和原有图片已保留。",
};
const phaseLabels: Record<SavePhase, string> = {
  loading: "正在读取备忘录…",
  idle: "",
  queued: "等待保存…",
  saving: "保存中…",
  saved: "已保存",
};

function parseDraft(draft: Draft) {
  const tags = [...new Set(draft.tagsText.split(/[,，、\n]/).map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
  return { body: draft.body, tags };
}

function publish(session: EditorSession, update: Partial<State>) {
  session.state = { ...session.state, ...update };
  session.notify?.(session.state);
}

function isReadOnly(context: FillAnnotationContext, snapshot: FillAnnotationSnapshot | null) {
  if (snapshot?.deleted || !snapshot?.annotation) return false;
  return snapshot.revision !== context.cycleRevision || snapshot.annotation.remap_status === "needs_confirmation";
}

function clearDebounce(session: EditorSession) {
  if (session.timer !== null) clearTimeout(session.timer);
  session.timer = null;
}

function hasPendingDraft(session: EditorSession) {
  return session.running !== null || session.operation !== null || session.edit !== session.savedEdit;
}

function flush(session: EditorSession) {
  if (session.running || !session.due || !session.state.snapshot
    || session.state.issue === "stale" || isReadOnly(session.context, session.state.snapshot)) return;
  if (!session.operation && session.edit === session.savedEdit) return;
  const task = Promise.resolve().then(async () => {
    const before = session.state.snapshot!;
    try {
      if (!session.operation) {
        const draft = parseDraft(session.state.draft);
        const validation = validateFillAnnotationDraft(draft);
        if (validation) {
          publish(session, { phase: "idle", issue: validation });
          return;
        }
        const previous = before.deleted ? null : before.annotation;
        if (!session.images.files?.length && session.images.removeId === undefined
          && (previous ? previous.body === draft.body : draft.body.trim() === "")
          && JSON.stringify(previous?.tags ?? []) === JSON.stringify(draft.tags)) {
          session.due = false;
          session.savedEdit = session.edit;
          publish(session, { phase: previous ? "saved" : "idle", issue: null });
          return;
        }
        session.operation = {
          perform: createFillAnnotationWrite(session.context, before, draft, session.images),
          edit: session.edit,
        };
        session.images = {};
      }
      session.due = false;
      publish(session, { phase: "saving", issue: null });
      const operation = session.operation;
      const result = await operation.perform();
      session.operation = null;
      session.savedEdit = operation.edit;
      const hasEdits = session.savedEdit !== session.edit;
      const validation = hasEdits ? validateFillAnnotationDraft(parseDraft(session.state.draft)) : null;
      if (hasEdits && !validation && session.timer === null) session.due = true;
      publish(session, {
        snapshot: result.snapshot,
        phase: validation ? "idle" : hasEdits ? "queued" : "saved",
        issue: validation ?? (result.uploadRolledBack ? "upload_rolled_back" : null),
      });
      session.onSaved?.(result.snapshot.deleted ? null : result.snapshot.annotation);
    } catch (error) {
      const issue = error instanceof FillAnnotationError ? error.code : "write";
      if (issue !== "uncertain") session.operation = null;
      publish(session, { phase: "idle", issue });
    } finally {
      session.running = null;
      if (session.due && (session.state.issue === null || session.state.issue === "upload_rolled_back")) flush(session);
      if (!hasPendingDraft(session) && session.drafts.get(session.key) === session) session.drafts.delete(session.key);
    }
  });
  session.running = task;
}

function queueDraft(session: EditorSession, draft: Draft) {
  clearDebounce(session);
  session.edit += 1;
  session.drafts.set(session.key, session);
  session.due = false;
  const issue = session.state.issue;
  const validation = validateFillAnnotationDraft(parseDraft(draft));
  publish(session, {
    draft,
    phase: session.running ? "saving" : validation ? "idle" : "queued",
    issue: issue === "stale" || issue === "uncertain" ? issue : validation,
  });
  if (validation || issue === "stale" || issue === "uncertain") return;
  session.timer = setTimeout(() => {
    session.timer = null;
    session.due = true;
    flush(session);
  }, 600);
}

function PrivateImagePreview({ image, snapshot }: { image: FillAnnotationImage; snapshot: FillAnnotationSnapshot }) {
  const [result, setResult] = useState<{ url: string } | "error" | null>(null);
  useEffect(() => {
    let active = true;
    let url: string | undefined;
    void downloadFillAnnotationImage(snapshot, image).then((blob) => {
      if (!active) return;
      url = URL.createObjectURL(blob);
      setResult({ url });
    }).catch(() => { if (active) setResult("error"); });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [image, snapshot]);

  if (result === null) return <p className="text-sm text-muted-foreground">正在读取图片…</p>;
  if (result === "error") return <p className="text-sm text-destructive">图片暂时无法查看。</p>;
  return <Image src={result.url} alt="成交备忘录附件" height={480} width={640} unoptimized className="h-auto w-full rounded-control" />;
}

export function FillAnnotationEditor({ cycleId, cycleRevision, fill, onSaved, draftScope }: FillAnnotationEditorProps) {
  const fillId = fill.fill_id;
  const id = useId();
  const sessionRef = useRef<EditorSession | null>(null);
  const onSavedRef = useRef(onSaved);
  const initialAnnotation = fill.annotation;
  const annotationRef = useRef(initialAnnotation);
  const [view, setView] = useState<State>(() => ({
    draft: initialAnnotation ? { body: initialAnnotation.body, tagsText: initialAnnotation.tags.join("、") } : emptyDraft,
    phase: "loading",
    issue: null,
    snapshot: null,
  }));
  const [reload, setReload] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);
  const [localDrafts] = useState(createFillAnnotationDraftScope);
  const drafts = draftScope ?? localDrafts;

  useEffect(() => { onSavedRef.current = onSaved; }, [onSaved]);
  useEffect(() => { annotationRef.current = initialAnnotation; }, [initialAnnotation]);
  useEffect(() => {
    const key = `${cycleId}:${fillId}`;
    const session: EditorSession = {
      key, drafts, context: { cycleId, cycleRevision, fillId },
      state: { draft: emptyDraft, phase: "loading", issue: null, snapshot: null },
      notify: setView, onSaved: (annotation) => onSavedRef.current?.(fillId, annotation),
      timer: null, due: false, edit: 0, savedEdit: 0, operation: null, images: {}, running: null,
    };
    sessionRef.current = session;
    async function load() {
      let detached = drafts.get(key);
      while (detached?.running) {
        await detached.running;
        detached = drafts.get(key);
      }
      if (!session.notify) return;
      try {
        const snapshot = await loadFillAnnotation(session.context);
        if (!session.notify) return;
        const annotation = snapshot.deleted ? null : snapshot.annotation;
        if (detached && drafts.get(key) === detached) drafts.delete(key);
        const prior = detached?.state.snapshot;
        if (detached && prior?.ownerId === snapshot.ownerId) {
          const uncertain = detached.state.issue === "uncertain";
          const baselineChanged = prior.annotation?.id !== snapshot.annotation?.id
            || prior.annotation?.version !== snapshot.annotation?.version || prior.revision !== snapshot.revision
            || prior.deleted !== snapshot.deleted;
          const stale = detached.context.cycleRevision !== cycleRevision || detached.state.issue === "stale"
            || isReadOnly(session.context, snapshot) || (!uncertain && baselineChanged);
          session.edit = detached.edit;
          session.savedEdit = detached.savedEdit;
          if (!stale) {
            session.operation = detached.operation;
            session.images = detached.images;
          }
          publish(session, {
            snapshot: !stale && uncertain ? prior : snapshot,
            phase: "idle",
            draft: detached.state.draft,
            issue: stale ? "stale" : detached.state.issue ?? "write",
          });
        } else {
          publish(session, {
            snapshot, phase: "idle",
            draft: annotation ? { body: annotation.body, tagsText: annotation.tags.join("、") } : emptyDraft,
          });
        }
        const projected = annotationRef.current;
        if (annotation?.id !== projected?.id || annotation?.version !== projected?.version) session.onSaved?.(annotation);
      } catch {
        publish(session, { phase: "idle", issue: "read" });
      }
    }
    void load();
    return () => {
      sessionRef.current = null;
      session.notify = null;
      session.onSaved = null;
      clearDebounce(session);
      if (session.state.snapshot && hasPendingDraft(session)) drafts.set(key, session);
      if (!session.state.issue) {
        session.due = true;
        flush(session);
      }
    };
  }, [cycleId, cycleRevision, drafts, fillId, reload]);

  function patchDraft(patch: Partial<Draft>) {
    const session = sessionRef.current;
    if (session?.state.snapshot && !isReadOnly(session.context, session.state.snapshot)) {
      queueDraft(session, { ...session.state.draft, ...patch });
    }
  }

  function editImages(changes: EditorSession["images"]) {
    const session = sessionRef.current;
    if (!session?.state.snapshot || session.running || session.operation || isReadOnly(session.context, session.state.snapshot)) return;
    const invalid = validateFillAnnotationDraft(parseDraft(session.state.draft))
      ?? validateFillAnnotationFiles(changes.files ?? [], session.state.snapshot.images.length);
    if (invalid) {
      publish(session, { issue: invalid });
      return;
    }
    clearDebounce(session);
    session.edit += 1;
    session.drafts.set(session.key, session);
    session.images = changes;
    session.due = true;
    if (changes.removeId === preview) setPreview(null);
    flush(session);
  }

  function retry() {
    const session = sessionRef.current;
    if (view.issue === "read") {
      setView((previous) => ({ ...previous, phase: "loading", issue: null }));
      setReload((previous) => previous + 1);
    } else if (session) {
      session.due = true;
      flush(session);
    }
  }

  const readOnly = view.snapshot === null || view.issue === "stale" || isReadOnly({ cycleId, cycleRevision, fillId }, view.snapshot);
  const remapNeeded = initialAnnotation?.remap_status === "needs_confirmation" && view.snapshot === null
    || (view.snapshot !== null && isReadOnly({ cycleId, cycleRevision, fillId }, view.snapshot));
  const attachmentsDisabled = readOnly || view.issue === "stale" || view.issue === "uncertain" || view.phase === "saving";
  const mayRetry = view.issue === "read" || view.issue === "uncertain" || view.issue === "write";
  return (
    <section className="grid min-w-0 gap-3 rounded-card border bg-surface p-4" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="text-sm font-semibold">成交备忘录</h3>
      <p className="text-xs text-muted-foreground">仅自己可见</p>
      {remapNeeded ? (
        <p role="note" className="text-sm text-warning">需要确认成交归属。同步后无法可靠匹配这条备忘录，已暂时设为只读。</p>
      ) : null}
      <Field>
        <Label htmlFor={`${id}-memo`}>备忘录</Label>
        <Textarea id={`${id}-memo`} maxLength={fillAnnotationBodyLimit} readOnly={readOnly}
          rows={3} value={view.draft.body} onChange={(event) => patchDraft({ body: event.target.value })}
          aria-invalid={view.issue === "body_length" || view.issue === "body_format"} />
      </Field>
      <Field>
        <Label htmlFor={`${id}-tags`}>标签</Label>
        <Input id={`${id}-tags`} aria-describedby={`${id}-tags-help`} maxLength={600} readOnly={readOnly}
          value={view.draft.tagsText} onChange={(event) => patchDraft({ tagsText: event.target.value })}
          aria-invalid={view.issue === "tag_count" || view.issue === "tag_length"} />
        <FieldHelp id={`${id}-tags-help`}>用逗号分隔，最多 10 个</FieldHelp>
      </Field>
      <Field>
        <Label htmlFor={`${id}-images`}>截图</Label>
        <Input id={`${id}-images`} type="file" multiple accept={fillAnnotationFileTypes} disabled={attachmentsDisabled}
          className="min-w-0 py-2 text-sm" aria-describedby={`${id}-images-help`} onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (files.length) editImages({ files });
          }} />
        <FieldHelp id={`${id}-images-help`}>JPEG、PNG、WebP，每张最多 2 MiB，共 5 张</FieldHelp>
      </Field>
      {view.snapshot?.images.length ? (
        <ul className="grid min-w-0 gap-2">
          {view.snapshot.images.map((image, index) => (
            <li key={image.id} className="grid gap-2">
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" aria-expanded={preview === image.id}
                  onClick={() => setPreview((current) => current === image.id ? null : image.id)}>
                  {preview === image.id ? "收起图片" : `查看图片 ${index + 1}`}
                </Button>
                <Button type="button" variant="ghost" disabled={attachmentsDisabled}
                  onClick={() => editImages({ removeId: image.id })}>移除图片 {index + 1}</Button>
              </div>
              {preview === image.id ? <PrivateImagePreview key={`${image.id}:${view.snapshot?.annotation?.version}`}
                snapshot={view.snapshot!} image={image} /> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {view.issue ? <FieldMessage role="alert">{messages[view.issue]}</FieldMessage> : null}
      {mayRetry ? <Button type="button" variant="secondary" className="justify-self-start" onClick={retry}>
        {view.issue === "read" ? "重试读取" : "重试保存"}
      </Button> : null}
      <p role="status" className="text-sm text-muted-foreground">{phaseLabels[view.phase]}</p>
    </section>
  );
}
