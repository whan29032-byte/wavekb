"use client";

import { BOARD_SLUGS, BOARDS, isBoardSlug, validatePost, type BoardSlug } from "@wavekb/domain/community";
import type { FillMarker, TradeChartProjection } from "@wavekb/domain/trading-review";
import { Button, Field, Input, Label, Textarea } from "@wavekb/ui";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { PublicStrategyChart } from "@/components/community/public-strategy-chart";
import {
  previewPublicStrategy,
  publishPublicStrategy,
  StrategyShareRepositoryError,
  type PublicStrategyPreview,
  type PublishPublicStrategyInput,
} from "@/lib/trading/workbench-repository";
import type { SavedStrategyLayout } from "./chart-tool-panel";

type ShareSelection = {
  quantity: boolean;
  pnl: boolean;
  notes: string[];
  drawings: string[];
  studies: string[];
};
type PreviewResult = { sequence: number; value: PublicStrategyPreview | null; error: string };
type PublishResult = { postId: string } | null;

const messages: Record<string, string> = {
  public_strategy_range_too_large: "分享范围过大。请缩小范围后再试。",
  public_strategy_coverage_unavailable: "该范围暂无可用行情，暂时无法分享。",
  public_strategy_indicator_data_unavailable: "有指标缺少所需行情。取消选择该指标后重新预览。",
  public_strategy_indicator_unavailable: "有指标无法计算。取消选择该指标后重新预览。",
  public_strategy_text_unsafe: "选中的备忘录或画线文字含链接或不支持的格式。请修改或取消选择。",
  public_strategy_payload_too_large: "快照内容过多。请减少选中的指标或画线。",
  public_strategy_publish_forbidden: "当前账号没有发帖权限。",
  public_strategy_publish_invalid: "请检查板块、标题和正文。",
  rate_limited: "操作太频繁，请稍等片刻再试。",
};

function describeFailure(cause: unknown) {
  if (cause instanceof StrategyShareRepositoryError) {
    if (cause.reason === "stale_preview") return "交易或图表已更新，请关闭后重新加载图表，再生成预览。";
    if (cause.reason === "expired_preview") return "预览已过期，请重新生成。";
    if (cause.reason === "consumed_preview") return "该预览已使用，原帖子当前无法访问。";
    if (messages[cause.code]) return messages[cause.code]!;
  }
  return "操作暂时未完成，请重试。";
}

function SelectionList({ title, items, checked, onChange }: {
  title: string;
  items: Array<{ id: string; label: string }>;
  checked: string[];
  onChange(value: string[]): void;
}) {
  if (items.length === 0) return null;
  return <fieldset className="grid gap-1">
    <legend className="mb-1 text-sm font-semibold">{title}</legend>
    <div className="grid max-h-36 gap-1 overflow-auto">
      {items.map(({ id, label }) => <label className="flex min-h-10 items-center gap-2 text-sm" key={id}>
        <input type="checkbox" checked={checked.includes(id)}
          onChange={(event) => onChange(event.target.checked ? [...checked, id] : checked.filter((item) => item !== id))} />
        <span className="min-w-0 break-words">{label}</span>
      </label>)}
    </div>
  </fieldset>;
}

export function ShareStrategyDialog({ projection, layout, fills, onClose, open = true }: {
  projection: TradeChartProjection;
  layout: SavedStrategyLayout;
  fills: FillMarker[];
  onClose(keepReceipt: boolean): void;
  open?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const pending = useRef(false);
  const id = useId();
  const [selection, setSelection] = useState<ShareSelection>(() => ({
    quantity: false, pnl: false, notes: [], drawings: [], studies: layout.indicators.map(({ instanceId }) => instanceId),
  }));
  const [sequence, setSequence] = useState(0);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [expiredSequence, setExpiredSequence] = useState(-1);
  const [confirmedDigest, setConfirmedDigest] = useState("");
  const [board, setBoard] = useState<BoardSlug>("case_submission");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [publishError, setPublishError] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [retry, setRetry] = useState<PublishPublicStrategyInput | null>(null);
  const [published, setPublished] = useState<PublishResult>(null);

  useEffect(() => {
    if (!open) return;
    const dialog = ref.current;
    dialog?.showModal();
    return () => { dialog?.close(); };
  }, [open]);

  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => {
      void previewPublicStrategy(projection.cycle_id, {
        cycle_revision: projection.cycle_revision, chart_state_version: layout.version,
        timeframe: projection.timeframe, ...projection.range,
        show_quantity: selection.quantity, show_absolute_pnl: selection.pnl, annotation_fill_ids: selection.notes,
        drawing_ids: selection.drawings, indicator_instance_ids: selection.studies,
      }).then((value) => {
        if (current) setResult({ sequence, value, error: "" });
      }).catch((cause: unknown) => {
        if (current) setResult({ sequence, value: null, error: describeFailure(cause) });
      });
    }, 220);
    return () => { current = false; window.clearTimeout(timer); };
  }, [layout.version, projection, selection, sequence]);

  const preview = result?.sequence === sequence ? result.value : null;
  useEffect(() => {
    if (!preview) return;
    const timer = window.setTimeout(() => setExpiredSequence(sequence),
      Math.max(0, Date.parse(preview.expires_at) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [preview, sequence]);

  function update(patch: Partial<ShareSelection>) {
    setSelection((value) => ({ ...value, ...patch }));
    refresh();
  }

  function refresh() {
    setConfirmedDigest("");
    setPublishError("");
    setSequence((value) => value + 1);
  }

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || published) return;
    let input = retry;
    if (!input) {
      if (!preview || confirmedDigest !== preview.projection_digest || expiredSequence === sequence) return;
      if (Date.parse(preview.expires_at) <= Date.now()) { setExpiredSequence(sequence); return; }
      const validation = validatePost({ board, title, body });
      if (!validation.ok) {
        setPublishError(validation.fields.title ?? validation.fields.body ?? "请检查帖子内容。");
        return;
      }
      input = {
        board, title: validation.value.title, body: validation.value.body,
        preview_token: preview.preview_token, idempotency_key: preview.idempotency_key, projection_digest: preview.projection_digest,
      };
    }
    pending.current = true;
    setPublishing(true);
    setPublishError("");
    try {
      const publication = await publishPublicStrategy(projection.cycle_id, input);
      setPublished({ postId: publication.post_id });
      setRetry(null);
    } catch (cause) {
      const uncertain = !(cause instanceof StrategyShareRepositoryError) || cause.reason === "gateway_unavailable";
      setRetry(uncertain ? input : null);
      setPublishError(uncertain ? "发布结果暂未确认。重试会查询这次提交。" : describeFailure(cause));
      if (cause instanceof StrategyShareRepositoryError && cause.reason === "expired_preview") setExpiredSequence(sequence);
      if (cause instanceof StrategyShareRepositoryError && cause.reason === "stale_preview") setConfirmedDigest("");
    } finally {
      pending.current = false;
      setPublishing(false);
    }
  }

  const isExpired = expiredSequence === sequence;
  const previewError = result?.sequence === sequence ? result.error : "";
  const locked = publishing || retry !== null;
  const notes = fills.flatMap(({ fill_id, annotation }) => annotation !== null
    ? [{ id: fill_id, label: annotation.body.trim() || annotation.tags.join("、") || "成交备忘录" }] : []);
  const drawings = layout.drawings.map((drawing, index) => ({
    id: drawing.id, label: drawing.text?.value || `${index + 1}. ${drawing.tool}`,
  }));
  const studies = layout.indicators.map(({ instanceId, indicatorId }) => ({ id: instanceId, label: indicatorId.toUpperCase() }));
  return <dialog ref={ref} aria-labelledby={`${id}-title`}
    onCancel={(event) => { event.preventDefault(); if (!publishing) onClose(retry !== null); }}
    className="fixed inset-0 m-auto max-h-[92dvh] w-[calc(100%-1rem)] max-w-5xl overflow-auto rounded-card border bg-surface p-4 text-foreground shadow-xl backdrop:bg-black/50 sm:p-6">
    <header className="mb-5 flex items-center justify-between gap-3 border-b pb-3">
      <h2 id={`${id}-title`} className="text-xl font-semibold">分享策略图</h2>
      <Button type="button" variant="ghost" onClick={() => onClose(retry !== null)} disabled={publishing}>关闭</Button>
    </header>
    {published ? <div className="grid gap-3">
      <p role="status">策略图已发布。</p>
      <Link className="w-fit font-semibold text-primary underline" href={`/community/post/${published.postId}`}>查看社区帖子</Link>
    </div> : <form className="grid min-w-0 gap-5" onSubmit={(event) => void publish(event)}>
      <fieldset className="grid gap-4" disabled={locked}>
        <legend className="mb-2 font-semibold">公开选项</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <label className="flex min-h-10 items-center gap-2"><input type="checkbox" checked={selection.quantity}
            onChange={(event) => update({ quantity: event.target.checked })} />显示仓位数量</label>
          <label className="flex min-h-10 items-center gap-2"><input type="checkbox" checked={selection.pnl}
            onChange={(event) => update({ pnl: event.target.checked })} />显示绝对盈亏金额</label>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectionList title="成交备忘录" items={notes} checked={selection.notes} onChange={(value) => update({ notes: value })} />
          <SelectionList title="画线" items={drawings} checked={selection.drawings} onChange={(value) => update({ drawings: value })} />
          <SelectionList title="指标" items={studies} checked={selection.studies} onChange={(value) => update({ studies: value })} />
        </div>
      </fieldset>

      {result?.sequence !== sequence && <p role="status" className="text-sm text-muted-foreground">正在生成预览…</p>}
      {previewError && <p role="alert" className="text-sm text-destructive">{previewError}</p>}
      {isExpired && <p role="alert" className="text-sm text-warning">预览已过期。</p>}
      {(previewError || isExpired) && !locked && <Button type="button" variant="outline" className="justify-self-start"
        onClick={refresh}>重新生成预览</Button>}
      {preview && <section className="grid gap-3 border-t pt-4" aria-label="公开页面预览">
        <h3 className="font-semibold">公开页面预览</h3>
        <p className="text-sm text-muted-foreground">仓位数量{preview.projection.show_quantity ? "公开" : "未公开"} · 绝对盈亏{preview.projection.show_absolute_pnl ? "公开" : "未公开"}</p>
        {preview.projection.warnings.includes("hidden_value_may_be_inferred") && <p className="text-sm text-warning">
          只公开一项时，读者可能结合成交价格推算另一项。
        </p>}
        <PublicStrategyChart key={preview.projection_digest} projection={preview.projection} />
      </section>}

      <fieldset className="grid gap-3 border-t pt-4" disabled={locked}>
        <legend className="font-semibold">社区帖子</legend>
        <Field><Label htmlFor={`${id}-board`}>板块</Label>
          <select id={`${id}-board`} className="h-11 rounded-control border bg-surface px-3" value={board}
            onChange={(event) => { const value = event.target.value; if (isBoardSlug(value)) setBoard(value); }}>
            {BOARD_SLUGS.map((slug) => <option key={slug} value={slug}>{BOARDS[slug].title}</option>)}
          </select>
        </Field>
        <Field><Label htmlFor={`${id}-post-title`}>标题</Label><Input id={`${id}-post-title`}
          value={title} maxLength={240} onChange={(event) => setTitle(event.target.value)} /></Field>
        <Field><Label htmlFor={`${id}-body`}>正文</Label><Textarea id={`${id}-body`}
          value={body} maxLength={40_000} rows={4} onChange={(event) => setBody(event.target.value)} /></Field>
        {preview && !isExpired && <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={confirmedDigest === preview.projection_digest}
            onChange={(event) => setConfirmedDigest(event.target.checked ? preview.projection_digest : "")} />
          我确认将这份图表和帖子公开发布
        </label>}
      </fieldset>
      {publishError && <p role="alert" className="text-sm text-destructive">{publishError}</p>}
      <Button type="submit" className="justify-self-start" disabled={publishing || (!retry
        && (!preview || isExpired || confirmedDigest !== preview.projection_digest))}>
        {publishing ? "正在发布…" : retry ? "重试确认发布" : "发布到社区"}
      </Button>
    </form>}
  </dialog>;
}
