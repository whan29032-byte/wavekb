"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button, Field, FieldMessage, Input, Label, Textarea } from "@wavekb/ui";
import { normalizeChartInput, type ChartInput } from "../../../../ai-gateway/src/research/wave-chart";

const MAX_INPUT_BYTES = 64 * 1024;
const INVALID_INPUT = "行情数据格式无效。请检查版本、时间顺序及每根 K 线的开高低收；最多支持 128 根，不会自动删减。";
const TOO_LARGE = "行情数据超过 64 KiB，未导入。请在数据源中明确选择需要分析的区间后重新导入。";

function inputBytes(value: string) {
  if (value.length > MAX_INPUT_BYTES) return MAX_INPUT_BYTES + 1;
  return new TextEncoder().encode(value).byteLength;
}

function parseInput(value: string): ChartInput {
  if (inputBytes(value) > MAX_INPUT_BYTES) throw new Error(TOO_LARGE);
  const parsed: unknown = JSON.parse(value);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && !Object.hasOwn(parsed, "schema_version")) {
    const source = parsed as Record<string, unknown>;
    if (Object.keys(source).length !== 3 || !["symbol", "interval", "bars"].every((key) => Object.hasOwn(source, key))
      || typeof source.symbol !== "string" || source.symbol.length > 64 || !/^(?:[A-Za-z][A-Za-z0-9_-]{0,15}:)?[A-Za-z0-9][A-Za-z0-9_.!-]*(?:\/[A-Za-z0-9][A-Za-z0-9_.-]*)?$/.test(source.symbol)
      || /(?:\.\.|\.(?:pdf|md|json|jsonl|csv|txt|env|log|png|jpe?g|webp|html?|js|ts|py|yaml|yml)$|^(?:file|https?|javascript|data):|^(?:Users|home|var|tmp|private|opt|srv|mnt|etc)\/)/i.test(source.symbol)
      || typeof source.interval !== "string" || !/^(?:[1-9]\d{0,4}[smhdwDWM]?|[DWM])$/.test(source.interval)
      || !Array.isArray(source.bars) || source.bars.length < 1 || source.bars.length > 128) throw new Error(INVALID_INPUT);
    return normalizeChartInput({ schema_version: "wavekb-chart-input-v1", bars: source.bars.map((bar: unknown) => {
      if (!Array.isArray(bar) || bar.length !== 5) throw new Error(INVALID_INPUT);
      const [time, open, high, low, close] = bar;
      return { time, open, high, low, close };
    }) });
  }
  return normalizeChartInput(parsed);
}

/** Optional, user-supplied market data; never auto-populate synthetic prices. */
export function WaveChartInput({ value, onChange, disabled = false, instrument, timeframe, inactive = false }: {
  value?: unknown;
  onChange: (value: ChartInput | null) => void;
  disabled?: boolean;
  instrument?: string;
  timeframe?: string;
  inactive?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [readToken, setReadToken] = useState<number | null>(null);
  const requestVersion = useRef(0);
  const mounted = useRef(false);
  const supplied = value !== null && value !== undefined;
  const currentInput = useMemo(() => {
    if (!supplied) return null;
    try { return normalizeChartInput(value); } catch { return null; }
  }, [supplied, value]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; requestVersion.current += 1; };
  }, []);

  // A new draft/step, cleared value, or disabled editor invalidates an older
  // file read. The owner/step key in Workbench also isolates local input state.
  useEffect(() => { requestVersion.current += 1; }, [value, disabled, instrument, timeframe]);

  function applyText() {
    if (disabled) return;
    requestVersion.current += 1;
    setReadToken(null); setStatus(""); setError("");
    try {
      onChange(parseInput(text));
      setText(""); setStatus("行情已应用到本步骤，将随分析草稿保存。数据由你提供，尚未联网核验。");
    } catch (cause) {
      setError(cause instanceof Error && cause.message === TOO_LARGE ? TOO_LARGE : INVALID_INPUT);
    }
  }

  async function importFile(file?: File) {
    if (!file || disabled) return;
    const token = ++requestVersion.current;
    setError(""); setStatus(""); setReadToken(null);
    if (file.size > MAX_INPUT_BYTES) { setError(TOO_LARGE); return; }
    if (!file.name.toLowerCase().endsWith(".json")) { setError("请使用 JSON 行情文件；不接受图片、表格或其他文件格式。"); return; }
    setReadToken(token);
    try {
      const input = parseInput(await file.text());
      if (!mounted.current || requestVersion.current !== token) return;
      onChange(input);
      setText(""); setStatus("行情文件已导入本步骤，将随分析草稿保存。数据由你提供，尚未联网核验。");
    } catch (cause) {
      if (mounted.current && requestVersion.current === token) {
        setError(cause instanceof Error && cause.message === TOO_LARGE ? TOO_LARGE : INVALID_INPUT);
      }
    } finally {
      if (mounted.current) setReadToken((current) => current === token ? null : current);
    }
  }

  function clearInput() {
    if (disabled) return;
    requestVersion.current += 1;
    setReadToken(null); setText(""); setError("");
    onChange(null); setStatus("本步骤的绘图行情已清除；分析记录和其他步骤未更改。");
  }

  return <details className="min-w-0 rounded-lg border bg-background">
    <summary className="cursor-pointer rounded-lg px-4 py-3 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">
      绘图行情（可选）{currentInput ? <span className="ml-2 font-normal text-muted-foreground">{inactive ? "已停用" : "已提供"} {currentInput.bars.length} 根</span> : null}
    </summary>
    <div className="grid min-w-0 gap-4 border-t p-4">
      <p id={`${id}-help`} className="text-sm leading-6 text-muted-foreground">提供本步骤需要的 K 线，AI 才能在输入坐标上标注候选浪型。数据由你提供，未联网核验；未提供时不会补造行情。请勿上传密钥、账户或交易记录。</p>
      <p className="text-sm leading-6 text-muted-foreground">当前分析：{instrument || "未填写品种"} · {timeframe || "未指定周期"}。请核对数据源的品种、周期和分析区间一致；导入文件不会自动证明它们匹配。</p>
      {currentInput ? <p className="rounded-lg bg-muted p-3 text-sm" role="status">{inactive ? `此行情属于其他或未确认标的／周期，已停用。保留 ${currentInput.bars.length} 根草稿数据；请重新导入并核对。` : `当前绘图输入：${currentInput.bars.length} 根 K 线，已通过格式检查；这不代表行情来源或浪型已验证。`}</p> : supplied ? <FieldMessage role="alert">已有绘图输入格式无效，不会用于分析。请重新导入或清除。</FieldMessage> : null}
      <Field>
        <Label htmlFor={`${id}-file`}>导入 JSON 行情文件</Label>
        <Input id={`${id}-file`} type="file" accept=".json,application/json" disabled={disabled} aria-describedby={`${id}-help ${id}-format`} onChange={(event) => {
          const file = event.target.files?.[0]; event.currentTarget.value = ""; void importFile(file);
        }} />
      </Field>
      <details className="min-w-0">
        <summary className="cursor-pointer py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">或粘贴 JSON</summary>
        <div className="grid gap-3 pt-2">
          <Field>
            <Label htmlFor={`${id}-text`}>行情 JSON</Label>
            <Textarea id={`${id}-text`} rows={6} value={text} disabled={disabled} aria-describedby={`${id}-help ${id}-format`} onChange={(event) => {
              requestVersion.current += 1; setReadToken(null); setStatus("");
              if (inputBytes(event.target.value) > MAX_INPUT_BYTES) { setError(TOO_LARGE); return; }
              setText(event.target.value); setError("");
            }} placeholder="粘贴数据源导出的 JSON；不会自动填入示例价格" />
          </Field>
          <Button type="button" variant="secondary" className="w-fit" disabled={disabled || !text.trim()} onClick={applyText}>检查并应用行情</Button>
        </div>
      </details>
      <p id={`${id}-format`} className="break-words text-xs leading-5 text-muted-foreground">标准格式：schema_version 为 wavekb-chart-input-v1；bars 为 1–128 条记录，每条只含 time、open、high、low、close。也支持原 Hermes TV 导出的 symbol、interval、bars 三字段格式（每根为 [时间, 开, 高, 低, 收]）；只保存转换后的 K 线，不保存文件名或额外来源字段。time 使用严格递增的 Unix 秒数，价格为正数，high／low 覆盖开收价。文件与粘贴内容均限 64 KiB；超限将整体拒绝，不会截断。</p>
      {readToken !== null ? <p role="status" className="text-sm text-muted-foreground">正在读取行情文件…</p> : null}
      {error ? <FieldMessage role="alert">{error}</FieldMessage> : null}
      {status && !inactive ? <p role="status" className="text-sm leading-6 text-muted-foreground">{status}</p> : null}
      {supplied || text || readToken !== null ? <Button type="button" variant="secondary" className="w-fit" disabled={disabled} onClick={clearInput}>清除本步骤绘图输入</Button> : null}
    </div>
  </details>;
}
