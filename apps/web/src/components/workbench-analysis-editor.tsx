"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { WorkbenchAnalysis } from "@wavekb/domain";
import { Button, Field, FieldMessage, Input, Label, Textarea } from "@wavekb/ui";
import { createClient } from "@/lib/supabase/client";
import { createReviewFromAnalysis, saveWorkbenchAnalysis, type WorkbenchAnalysisDraft } from "@/lib/workbench/analysis-client";
import { calculateMaxDrawdown, calculateRisk, evaluateImpulse } from "@/lib/workbench/analysis-calculators";

const steps = ["市场环境过滤", "确认分析级别", "确认当前浪级", "回撤确认", "调整结构识别", "驱动结构检查", "规则检查", "方案选择", "风险收益评估", "执行计划", "复盘系统"];
const stepHints = [
  "宏观环境只决定是否适合交易，不改变波浪结构是否有效。",
  "同时固定上一级、当前级和下一级，不允许跳级分析。",
  "记录驱动或调整、完成度，以及主计数和备选计数。",
  "最大回撤刷新不能单独宣布趋势结束，必须结合同级别与内部结构完成度。",
  "在锯齿、平台、三角和联合形之间检查还缺哪一段。",
  "普通推动、引导楔形和终结楔形必须分别应用规则。",
  "硬规则负责淘汰，比例、时间、通道、成交量和个性只负责排序。",
  "每个方案都要写成立、确认、失效和目标区，不填写未经校准的概率。",
  "仓位、最大亏损和盈亏比由程序计算，结构失效位与交易止损分开。",
  "入场条件未触发时只能等待，不因临盘情绪提前执行。",
  "保留初始分析快照，对比实际走势，复盘数浪、执行和纪律。",
];
const timeframes = ["年线", "季线", "月线", "周线", "日线", "4小时", "1小时", "15分钟", "5分钟", "1分钟"];
const selectClass = "h-11 w-full rounded-lg border border-input bg-surface px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

function initialDraft(actorId: string, value?: WorkbenchAnalysis): WorkbenchAnalysisDraft {
  return value ? {
    owner_id: value.owner_id, schema_version: value.schema_version, input_source: value.input_source, instrument: value.instrument, market: value.market,
    primary_timeframe: value.primary_timeframe, parent_timeframe: value.parent_timeframe, child_timeframe: value.child_timeframe,
    holding_style: value.holding_style, step_data: value.step_data || {}, rule_result: value.rule_result || {}, score_result: value.score_result || {},
    risk_result: value.risk_result || {}, drawdown_result: value.drawdown_result || {}, execution_status: value.execution_status,
  } : {
    owner_id: actorId, schema_version: "workbench-v1", input_source: "manual", instrument: "", market: "crypto", primary_timeframe: "4小时",
    parent_timeframe: "日线", child_timeframe: "1小时", holding_style: "波段", step_data: {}, rule_result: {}, score_result: {}, risk_result: {}, drawdown_result: {}, execution_status: "draft",
  };
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function WorkbenchAnalysisEditor({ actorId, initialAnalysis, initialStep }: { actorId: string; initialAnalysis?: WorkbenchAnalysis; initialStep: number }) {
  const router = useRouter();
  const [analysisId, setAnalysisId] = useState(initialAnalysis?.id || null);
  const [draft, setDraft] = useState(() => initialDraft(actorId, initialAnalysis));
  const [step, setStep] = useState(initialStep);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [aiJob, setAiJob] = useState<{ id: string; status: string; output_payload?: unknown; error_message?: string } | null>(null);
  const currentData = useMemo(() => objectValue(draft.step_data[String(step)]), [draft.step_data, step]);

  useEffect(() => {
    if (initialAnalysis) return;
    const restore = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem(`wavekb:next:analysis:${actorId}`);
        if (saved) setDraft(JSON.parse(saved) as WorkbenchAnalysisDraft);
      } catch { localStorage.removeItem(`wavekb:next:analysis:${actorId}`); }
    }, 0);
    return () => window.clearTimeout(restore);
  }, [actorId, initialAnalysis]);

  useEffect(() => {
    if (!analysisId) localStorage.setItem(`wavekb:next:analysis:${actorId}`, JSON.stringify(draft));
  }, [actorId, analysisId, draft]);

  function patchDraft(value: Partial<WorkbenchAnalysisDraft>) {
    setDraft((current) => ({ ...current, ...value }));
  }

  function patchStep(value: Record<string, unknown>) {
    setDraft((current) => ({ ...current, step_data: { ...current.step_data, [String(step)]: { ...objectValue(current.step_data[String(step)]), ...value } } }));
  }

  async function persist() {
    if (!draft.instrument.trim()) throw new Error("请先在第1步填写分析品种。 ");
    const order = [draft.parent_timeframe, draft.primary_timeframe, draft.child_timeframe].map((value) => timeframes.indexOf(value));
    if (order.some((value) => value < 0) || !(order[0] < order[1] && order[1] < order[2])) throw new Error("上一级、当前级和下一级周期顺序无效。 ");
    const saved = await saveWorkbenchAnalysis(createClient(), analysisId, draft);
    setAnalysisId(saved.id);
    setDraft(initialDraft(actorId, saved));
    localStorage.removeItem(`wavekb:next:analysis:${actorId}`);
    if (!analysisId) router.replace(`/workbench/analysis/${saved.id}?step=${step}`);
    return saved;
  }

  async function save() {
    setPending(true); setError(""); setStatus("正在保存分析。");
    try { await persist(); setStatus("分析已保存。"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "分析保存失败。"); setStatus(""); }
    finally { setPending(false); }
  }

  function go(next: number) {
    const bounded = Math.max(0, Math.min(10, next));
    setStep(bounded);
    const path = analysisId ? `/workbench/analysis/${analysisId}?step=${bounded}` : `/workbench/analysis/new?step=${bounded}`;
    window.history.replaceState(null, "", path);
  }

  function runDrawdown() {
    const result = calculateMaxDrawdown(String(currentData.equity_curve || ""), Boolean(currentData.same_degree_refresh), Boolean(currentData.segment_complete));
    patchDraft({ drawdown_result: result });
  }

  function runRisk() {
    const keys = ["equity", "risk_percent", "entry", "stop", "target", "contract_multiplier", "lot_size", "fees"];
    const values = Object.fromEntries(keys.map((key) => [key, Number(currentData[key] ?? (key === "equity" ? 100000 : key === "risk_percent" || key === "contract_multiplier" || key === "lot_size" ? 1 : 0))]));
    patchDraft({ risk_result: calculateRisk(values) });
  }

  function runRules() {
    const keys = ["w1_start", "w1_end", "w2_end", "w3_end", "w4_end", "w5_end"];
    const values = Object.fromEntries(keys.map((key) => [key, Number(currentData[key])]));
    const result = evaluateImpulse(values, currentData.direction === "down" ? "down" : "up");
    patchDraft({ rule_result: result, score_result: { structural_score: result.status === "valid" ? 66 : null, trading_suitability: result.status === "valid" ? 71 : null, band: result.status === "valid" ? "中等置信" : "已淘汰", disclaimer: "置信评分用于比较当前证据，不是历史胜率或客观概率。" } });
  }

  async function startAi() {
    setPending(true); setError(""); setStatus("正在保存并提交 AI 候选分析。");
    try {
      const saved = await persist();
      const response = await fetch(`/api/ai/analyses/${saved.id}/ai-run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task_type: "wave_analysis", step, schema_version: "workbench-v1" }) });
      const payload = await response.json().catch(() => ({})) as { error?: string; job?: { id: string; status: string } };
      if (!response.ok || !payload.job) throw new Error(payload.error === "ai_connection_required" ? "请先在 AI 控制中心添加并选择一个模型。" : payload.error || "AI 任务提交失败。");
      setAiJob(payload.job); setStatus("AI 任务已进入服务器队列，将经过知识检索和规则闸门。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "AI 任务提交失败。"); setStatus(""); }
    finally { setPending(false); }
  }

  async function refreshAi() {
    if (!aiJob) return;
    setPending(true); setError("");
    try {
      const response = await fetch(`/api/ai/jobs/${aiJob.id}`, { cache: "no-store" });
      const payload = await response.json() as { error?: string; job?: typeof aiJob };
      if (!response.ok || !payload.job) throw new Error(payload.error || "AI 状态读取失败。");
      setAiJob(payload.job);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "AI 状态读取失败。"); }
    finally { setPending(false); }
  }

  async function createReview() {
    setPending(true); setError("");
    try { const saved = await persist(); const entryId = await createReviewFromAnalysis(createClient(), saved); router.push(`/workbench/entries/${entryId}`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "复盘记录创建失败。"); setPending(false); }
  }

  const notes = String(currentData.notes || "");
  return (
    <div className="grid gap-6">
      <nav className="flex gap-2 overflow-x-auto pb-2" aria-label="分析步骤">{steps.map((label, index) => <button key={label} type="button" onClick={() => go(index)} aria-current={step === index ? "step" : undefined} className={`grid min-w-20 gap-1 rounded-lg border px-3 py-2 text-left ${step === index ? "border-primary bg-primary text-primary-foreground" : "bg-surface text-muted-foreground"}`}><span className="text-xs">第 {index} 步</span><span className="text-sm font-semibold">{label.slice(0, 4)}</span></button>)}</nav>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="grid gap-6 rounded-xl border bg-surface p-5 md:p-7">
          <header><p className="text-sm font-semibold text-primary">第 {step} 步</p><h1 className="mt-1 text-3xl font-semibold tracking-[-0.035em]">{steps[step]}</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">{stepHints[step]}</p></header>
          {step === 1 ? <div className="grid gap-5 sm:grid-cols-2"><Field><Label htmlFor="analysis-market">市场分类</Label><Input id="analysis-market" value={draft.market} onChange={(event) => patchDraft({ market: event.target.value })} maxLength={80} /></Field><Field><Label htmlFor="analysis-instrument">分析品种</Label><Input id="analysis-instrument" value={draft.instrument} onChange={(event) => patchDraft({ instrument: event.target.value })} required maxLength={80} placeholder="BINANCE:BTCUSDT" /></Field><Field><Label htmlFor="analysis-parent">上一级周期</Label><select id="analysis-parent" className={selectClass} value={draft.parent_timeframe} onChange={(event) => patchDraft({ parent_timeframe: event.target.value })}>{timeframes.map((item) => <option key={item}>{item}</option>)}</select></Field><Field><Label htmlFor="analysis-primary">当前分析周期</Label><select id="analysis-primary" className={selectClass} value={draft.primary_timeframe} onChange={(event) => patchDraft({ primary_timeframe: event.target.value })}>{timeframes.map((item) => <option key={item}>{item}</option>)}</select></Field><Field><Label htmlFor="analysis-child">下一级周期</Label><select id="analysis-child" className={selectClass} value={draft.child_timeframe} onChange={(event) => patchDraft({ child_timeframe: event.target.value })}>{timeframes.map((item) => <option key={item}>{item}</option>)}</select></Field><Field><Label htmlFor="analysis-style">持有风格</Label><select id="analysis-style" className={selectClass} value={draft.holding_style} onChange={(event) => patchDraft({ holding_style: event.target.value })}>{["长线", "波段", "中线", "日内", "超短"].map((item) => <option key={item}>{item}</option>)}</select></Field></div> : null}
          {step === 2 ? <div className="grid gap-5 sm:grid-cols-2"><Field><Label htmlFor="analysis-mode">当前模式</Label><select id="analysis-mode" className={selectClass} value={String(currentData.mode || "unknown")} onChange={(event) => patchStep({ mode: event.target.value })}><option value="unknown">待确认</option><option value="motive">驱动</option><option value="corrective">调整</option></select></Field><Field><Label htmlFor="analysis-degree">当前浪级判断</Label><Input id="analysis-degree" value={String(currentData.degree || "")} onChange={(event) => patchStep({ degree: event.target.value })} placeholder="例如：分钟级浪3" /></Field></div> : null}
          {step === 3 ? <div className="grid gap-5"><Field><Label htmlFor="analysis-curve">价格或权益序列</Label><Textarea id="analysis-curve" value={String(currentData.equity_curve || "")} onChange={(event) => patchStep({ equity_curve: event.target.value })} placeholder="100, 112, 108, 125, 117" /></Field><label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={Boolean(currentData.same_degree_refresh)} onChange={(event) => patchStep({ same_degree_refresh: event.target.checked })} />同级别波段刷新</label><label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={Boolean(currentData.segment_complete)} onChange={(event) => patchStep({ segment_complete: event.target.checked })} />内部浪型已完成</label><Button type="button" className="w-fit" onClick={runDrawdown}>测量最大回撤</Button></div> : null}
          {step === 4 ? <Field><Label htmlFor="analysis-correction">调整结构候选</Label><select id="analysis-correction" className={selectClass} value={String(currentData.pattern || "unknown")} onChange={(event) => patchStep({ pattern: event.target.value })}><option value="unknown">待确认</option><option value="zigzag">锯齿</option><option value="flat">平台</option><option value="triangle">三角</option><option value="combination">联合形</option></select></Field> : null}
          {step === 5 ? <Field><Label htmlFor="analysis-motive">驱动结构候选</Label><select id="analysis-motive" className={selectClass} value={String(currentData.pattern || "unknown")} onChange={(event) => patchStep({ pattern: event.target.value })}><option value="unknown">待确认</option><option value="impulse">普通推动浪</option><option value="leading_diagonal">引导楔形</option><option value="ending_diagonal">终结楔形</option></select></Field> : null}
          {step === 6 ? <div className="grid gap-5 sm:grid-cols-2"><Field><Label htmlFor="rule-direction">方向</Label><select id="rule-direction" className={selectClass} value={String(currentData.direction || "up")} onChange={(event) => patchStep({ direction: event.target.value })}><option value="up">上涨</option><option value="down">下跌</option></select></Field>{[["w1_start","浪1起点",100],["w1_end","浪1终点",120],["w2_end","浪2终点",110],["w3_end","浪3终点",160],["w4_end","浪4终点",140],["w5_end","浪5终点",175]].map(([key,label,fallback]) => <Field key={String(key)}><Label htmlFor={`rule-${key}`}>{label}</Label><Input id={`rule-${key}`} type="number" step="any" value={String(currentData[String(key)] ?? fallback)} onChange={(event) => patchStep({ [String(key)]: event.target.value })} /></Field>)}<Button type="button" className="w-fit" onClick={runRules}>执行硬规则检查</Button></div> : null}
          {step === 7 ? <div className="grid gap-5">{[["primary","首选方案"],["alternative_a","备选方案 A"],["alternative_b","备选方案 B"]].map(([key,label]) => <Field key={key}><Label htmlFor={`scenario-${key}`}>{label}</Label><Textarea id={`scenario-${key}`} value={String(currentData[key] || "")} onChange={(event) => patchStep({ [key]: event.target.value })} placeholder="写明成立、确认、失效和目标区" /></Field>)}</div> : null}
          {step === 8 ? <div className="grid gap-5 sm:grid-cols-2">{[["equity","账户权益",100000],["risk_percent","单笔风险百分比",1],["entry","计划入场价",""],["stop","交易止损价",""],["target","目标价",""],["contract_multiplier","合约乘数",1],["lot_size","最小交易单位",1],["fees","单单位费用",0]].map(([key,label,fallback]) => <Field key={String(key)}><Label htmlFor={`risk-${key}`}>{label}</Label><Input id={`risk-${key}`} type="number" step="any" value={String(currentData[String(key)] ?? fallback)} onChange={(event) => patchStep({ [String(key)]: event.target.value })} /></Field>)}<Button type="button" className="w-fit" onClick={runRisk}>计算风险收益</Button></div> : null}
          {step === 9 ? <div className="grid gap-5"><Field><Label htmlFor="execution-status">执行状态</Label><select id="execution-status" className={selectClass} value={draft.execution_status} onChange={(event) => patchDraft({ execution_status: event.target.value as WorkbenchAnalysisDraft["execution_status"] })}><option value="draft">草稿</option><option value="waiting">等待条件</option><option value="ready">可以执行</option><option value="executed">已执行</option><option value="closed">已结束</option></select></Field><Field><Label htmlFor="entry-condition">入场条件</Label><Textarea id="entry-condition" value={String(currentData.entry_condition || "")} onChange={(event) => patchStep({ entry_condition: event.target.value })} /></Field><Field><Label htmlFor="invalidation">结构失效条件</Label><Textarea id="invalidation" value={String(currentData.invalidation || "")} onChange={(event) => patchStep({ invalidation: event.target.value })} /></Field></div> : null}
          {step === 10 ? <div className="grid gap-5"><Field><Label htmlFor="actual-result">实际走势与执行结果</Label><Textarea id="actual-result" value={String(currentData.actual_result || "")} onChange={(event) => patchStep({ actual_result: event.target.value })} /></Field><Field><Label htmlFor="lessons">经验与改进</Label><Textarea id="lessons" value={String(currentData.lessons || "")} onChange={(event) => patchStep({ lessons: event.target.value })} /></Field><Button type="button" variant="secondary" className="w-fit" disabled={pending} onClick={() => void createReview()}>生成完整私人复盘记录</Button></div> : null}
          <Field><Label htmlFor="analysis-notes">分析记录</Label><Textarea id="analysis-notes" rows={8} value={notes} onChange={(event) => patchStep({ notes: event.target.value })} placeholder="记录判断、证据、未知项和下一步确认条件" /></Field>
          {step >= 2 && step <= 7 ? <div className="grid gap-3 rounded-xl bg-muted p-4"><Button type="button" className="w-fit" disabled={pending} onClick={() => void startAi()}>启动 AI 候选分析</Button><p className="text-xs leading-5 text-muted-foreground">使用 AI 控制中心中选定的模型，知识检索和硬规则闸门仍由服务器处理。</p>{aiJob ? <div className="grid gap-2 text-sm"><p>任务状态：<strong>{aiJob.status}</strong></p><Button type="button" variant="secondary" size="small" className="w-fit" disabled={pending} onClick={() => void refreshAi()}>刷新 AI 状态</Button>{aiJob.output_payload ? <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-background p-3 text-xs">{JSON.stringify(aiJob.output_payload, null, 2)}</pre> : null}{aiJob.error_message ? <FieldMessage>{aiJob.error_message}</FieldMessage> : null}</div> : null}</div> : null}
          {error ? <FieldMessage role="alert">{error}</FieldMessage> : null}
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t pt-5"><Button type="button" variant="secondary" disabled={step === 0} onClick={() => go(step - 1)}>上一步</Button><div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" disabled={pending} onClick={() => void save()}>{pending ? "正在处理" : "保存分析"}</Button>{step < 10 ? <Button type="button" onClick={() => go(step + 1)}>下一步</Button> : null}</div></footer>
        </section>
        <aside className="grid h-fit gap-4 rounded-xl border bg-surface p-5 lg:sticky lg:top-20"><h2 className="font-semibold">实时结果</h2>{[["硬规则", draft.rule_result.status || "尚未检查"],["结构置信评分", draft.score_result.structural_score ?? "尚未评分"],["交易适宜度", draft.score_result.trading_suitability ?? "尚未评分"],["最大回撤", draft.drawdown_result.max_drawdown ?? "尚未测量"],["最大亏损", draft.risk_result.max_loss ?? "尚未计算"],["仓位上限", draft.risk_result.max_position ?? "尚未计算"],["盈亏比", draft.risk_result.reward_risk ?? "尚未计算"]].map(([label,value]) => <div key={String(label)} className="flex items-center justify-between gap-3 border-t pt-3 text-sm"><span className="text-muted-foreground">{String(label)}</span><strong>{String(value)}</strong></div>)}{status ? <p className="rounded-lg bg-muted p-3 text-xs leading-5 text-muted-foreground" role="status">{status}</p> : null}<Link className="text-sm font-semibold text-primary hover:underline" href="/knowledge/unit-ewp-method-alternative-count-scorecard">打开第10版方法页</Link></aside>
      </div>
    </div>
  );
}
