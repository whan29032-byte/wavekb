"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Button, FieldMessage } from "@wavekb/ui";
import { createClient } from "@/lib/supabase/client";

export type AiExecutionMode = "byok" | "managed";
const authUnavailableMessage = "当前环境未配置 Hermes 会员身份验证，Hermes 暂不可用；自带 Key 模式不受影响。";
type Status = { user_id: string; usage_day: string; timezone: "Asia/Shanghai"; has_vip: boolean; daily_limit: number; used: number; remaining: number; enabled: boolean; configured: boolean; available: boolean };
function parseStatus(value: unknown, actorId: string): Status {
  const state = value as Status | null;
  if (!state || state.user_id !== actorId || state.timezone !== "Asia/Shanghai" || !/^\d{4}-\d{2}-\d{2}$/.test(state.usage_day)
    || [state.daily_limit, state.used, state.remaining].some((count) => !Number.isSafeInteger(count) || count < 0)
    || state.remaining !== Math.max(0, state.daily_limit - state.used)
    || [state.has_vip, state.enabled, state.configured, state.available].some((flag) => typeof flag !== "boolean")
    || state.available !== (state.enabled && state.configured && state.has_vip && state.remaining > 0)) throw new Error("Hermes 会员额度回执不完整，暂不可使用。");
  return state;
}

export function ManagedAiModeSelector({ actorId, value, onChange, disabled = false }: { actorId: string; value: AiExecutionMode; onChange: (value: AiExecutionMode) => void; disabled?: boolean }) {
  const groupId = useId();
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [identityBlocked, setIdentityBlocked] = useState(false);
  const activeRequest = useRef(false);
  const requestRevision = useRef(0);
  const changeMode = useRef(onChange);
  useEffect(() => { changeMode.current = onChange; }, [onChange]);
  useEffect(() => {
    try {
      const { data } = createClient().auth.onAuthStateChange((_event, session) => {
        const blocked = session?.user.id !== actorId;
        setIdentityBlocked(blocked);
        if (!blocked) return;
        requestRevision.current += 1;
        activeRequest.current = false;
        setStatus(null); setError(""); setLoading(false);
        changeMode.current("byok");
      });
      return () => {
        requestRevision.current += 1;
        activeRequest.current = false;
        data.subscription.unsubscribe();
      };
    } catch {
      const revision = ++requestRevision.current;
      activeRequest.current = false;
      queueMicrotask(() => {
        if (revision !== requestRevision.current) return;
        setStatus(null); setError(authUnavailableMessage); setLoading(false);
        changeMode.current("byok");
      });
      return () => { requestRevision.current += 1; activeRequest.current = false; };
    }
  }, [actorId]);
  async function refresh() {
    if (activeRequest.current || disabled) return;
    const revision = ++requestRevision.current;
    activeRequest.current = true; setLoading(true); setStatus(null); setError("");
    onChange("byok");
    try {
      let client: ReturnType<typeof createClient>;
      try { client = createClient(); } catch { throw new Error(authUnavailableMessage); }
      const verifyActor = async () => {
        if (revision !== requestRevision.current) return false;
        const { data, error: authError } = await client.auth.getUser();
        if (revision !== requestRevision.current) return false;
        if (!authError && data.user?.id === actorId) return true;
        requestRevision.current += 1; activeRequest.current = false;
        setIdentityBlocked(true); setStatus(null); setError(""); setLoading(false);
        changeMode.current("byok");
        return false;
      };
      if (!await verifyActor()) return;
      const response = await fetch("/api/ai/user/membership-ai", { cache: "no-store" });
      const result: unknown = await response.json();
      if (!await verifyActor()) return;
      if (!response.ok) throw new Error("暂时无法核实 Hermes 会员额度；自带 Key 模式不受影响。");
      setIdentityBlocked(false);
      setStatus(parseStatus(result, actorId));
    } catch (cause) { if (revision === requestRevision.current) setError(cause instanceof Error ? cause.message : "Hermes 会员额度核实失败。"); }
    finally { if (revision === requestRevision.current) { activeRequest.current = false; setLoading(false); } }
  }
  const available = !identityBlocked && status?.user_id === actorId && status.available && !loading;
  return <fieldset className="grid gap-3 rounded-lg border p-3" disabled={disabled}>
    <legend className="px-1 text-sm font-semibold">AI 分析服务</legend>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className={`flex min-h-11 items-start gap-3 rounded-lg border p-3 text-sm ${value === "byok" ? "border-primary bg-primary/5" : "bg-surface"}`}>
        <input type="radio" name={groupId} value="byok" aria-label="自带 Key（个人模型接口）" aria-describedby={`${groupId}-byok-description`} checked={value === "byok"} onChange={() => onChange("byok")} className="mt-1 shrink-0 accent-primary" />
        <span className="grid gap-1"><span className="font-semibold">自带 Key</span><span id={`${groupId}-byok-description`} className="text-xs leading-5 text-muted-foreground">使用个人模型接口，不扣会员每日额度，不读取 Hermes 私有补充资料。</span></span>
      </label>
      <label className={`flex min-h-11 items-start gap-3 rounded-lg border p-3 text-sm ${!available ? "cursor-not-allowed bg-muted/40" : value === "managed" ? "border-primary bg-primary/5" : "bg-surface"}`}>
        <input type="radio" name={groupId} value="managed" aria-label="Hermes 云端研究（会员专属）" aria-describedby={`${groupId}-hermes-description`} checked={value === "managed"} disabled={!available} onChange={() => { if (available) onChange("managed"); }} className="mt-1 shrink-0 accent-primary" />
        <span className="grid gap-1"><span className="flex flex-wrap items-center gap-2 font-semibold"><span>Hermes 云端研究</span><span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">会员专属</span></span><span id={`${groupId}-hermes-description`} className="text-xs leading-5 text-muted-foreground">网站独立运行的研究服务，无需个人 API Key；须核实有效 VIP 与每日额度。</span></span>
      </label>
    </div>
    <Button type="button" variant="secondary" size="small" className="min-h-11 w-fit" disabled={disabled || loading} onClick={() => void refresh()}>{loading ? "正在核实会员额度" : "核实 Hermes 会员额度"}</Button>
    <p role="status" className="text-xs leading-5 text-muted-foreground">{status ? !status.enabled || !status.configured ? "Hermes 尚未开放或云端模型未配置；请使用自带 Key。" : !status.has_vip ? "Hermes 云端研究仅供有效 VIP 使用；自带 Key 保持原有权限。" : status.remaining === 0 ? `Hermes 今日额度已用完（${status.used} / ${status.daily_limit}）。按北京时间每日更新额度，自带 Key 模式不受影响。` : `北京时间 ${status.usage_day}：已用 ${status.used} / ${status.daily_limit}，剩余 ${status.remaining} 次。按服务器接受的唯一任务计一次，自动重试不重复扣减；服务端确认最终失败会返还。` : "Hermes 需先核实服务端配置与当前会员额度，未核实不会排队或扣额。"}</p>
    {status?.user_id === actorId && !identityBlocked && !status.has_vip ? <Link href="/membership" className="inline-flex min-h-11 w-fit items-center text-sm font-medium text-primary underline underline-offset-4">在个人中心查看并开通 VIP</Link> : null}
    {identityBlocked ? <FieldMessage role="alert">登录账号已变化或退出，请返回当前账号的分析页后重新核实 Hermes 额度。</FieldMessage> : null}
    {error ? <FieldMessage role="alert">{error}</FieldMessage> : null}
  </fieldset>;
}
