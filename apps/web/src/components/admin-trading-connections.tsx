"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Prohibit } from "@phosphor-icons/react";
import { Button, FieldMessage, Input } from "@wavekb/ui";
import type { AdminTradingConnection } from "@/lib/admin/server-repository";

const statusLabel = { active: "正常同步", error: "同步异常", disabled: "已停用" } as const;

export function AdminTradingConnections({ connections }: { connections: AdminTradingConnection[] }) {
  const router = useRouter();
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [displayEquity, setDisplayEquity] = useState<Record<string, string>>(() => Object.fromEntries(connections.map((connection) => [connection.id, connection.public_display_equity_usdt || ""])));
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  async function disable(connection: AdminTradingConnection) {
    const reason = String(reasons[connection.id] || "").trim();
    if (reason.length < 2) return setError("请填写至少 2 个字符的停用原因。");
    const owner = connection.owner?.display_name || connection.owner?.public_uid || connection.owner_id.slice(0, 8);
    if (!window.confirm(`确认停用 ${owner} 的交易所连接？密钥会立即失效并停止公开排名。`)) return;
    setPending(connection.id); setError(""); setStatus("");
    try {
      const response = await fetch(`/api/admin/trading-connections/${connection.id}/disable`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "administration_failed");
      setStatus("连接已停用，密钥已撤销，操作已写入治理日志。");
      setReasons((current) => ({ ...current, [connection.id]: "" }));
      router.refresh();
    } catch { setError("停用没有完成，请刷新后重试。"); }
    finally { setPending(""); }
  }

  async function saveDisplayEquity(connection: AdminTradingConnection) {
    const reason = String(reasons[`${connection.id}:display`] || "").trim();
    if (reason.length < 2) return setError("修改显示余额前请填写至少 2 个字符的原因。");
    const value = String(displayEquity[connection.id] || "").trim();
    if (value && !/^(?:0|[1-9]\d{0,21})(?:\.\d{1,8})?$/.test(value)) return setError("显示余额必须是非负数字，最多 8 位小数。");
    setPending(`${connection.id}:display`); setError(""); setStatus("");
    try {
      const response = await fetch(`/api/admin/trading-connections/${connection.id}/display-equity`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ display_equity_usdt: value || null, reason }) });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "administration_failed");
      setStatus(value ? "排行榜显示余额已更新。" : "已清除自定义余额，排行榜将恢复显示实时同步值。");
      router.refresh();
    } catch { setError("显示余额没有更新，请刷新后重试。"); }
    finally { setPending(""); }
  }

  return <div className="grid gap-4"><div aria-live="polite" className="min-h-6">{error ? <FieldMessage role="alert">{error}</FieldMessage> : status ? <p className="text-sm font-medium text-primary">{status}</p> : null}</div><div className="overflow-x-auto border-y"><div className="min-w-[78rem]"><div className="grid grid-cols-[minmax(12rem,1.2fr)_8rem_8rem_11rem_15rem_minmax(18rem,1fr)] gap-3 px-4 py-3 text-xs font-medium text-muted-foreground"><span>用户 / 连接</span><span>状态</span><span>公开排行</span><span>最近同步</span><span>排行榜显示余额</span><span>治理操作</span></div>{connections.length ? connections.map((connection) => <article key={connection.id} className="grid grid-cols-[minmax(12rem,1.2fr)_8rem_8rem_11rem_15rem_minmax(18rem,1fr)] items-center gap-3 border-t px-4 py-4 text-sm"><div className="min-w-0"><strong className="block truncate">{connection.owner?.display_name || "未知用户"}</strong><span className="mt-1 block text-xs text-muted-foreground">{connection.owner?.public_uid ? <Link href={`/member/${connection.owner.public_uid}`} className="hover:text-primary">UID {connection.owner.public_uid}</Link> : connection.owner_id.slice(0, 8)} · Key {connection.secret_mask}</span></div><strong className={connection.status === "error" ? "text-destructive" : connection.status === "active" ? "text-primary" : "text-muted-foreground"}>{statusLabel[connection.status]}</strong><span>{connection.public_enabled ? "公开" : "隐藏"}</span><span className="text-xs text-muted-foreground">{connection.last_synced_at ? new Date(connection.last_synced_at).toLocaleString("zh-CN") : "未同步"}{connection.consecutive_failures ? ` · 失败 ${connection.consecutive_failures}` : ""}</span><div className="grid gap-2"><Input aria-label={`${connection.owner?.display_name || connection.id} 的排行榜显示余额`} inputMode="decimal" value={displayEquity[connection.id] || ""} onChange={(event) => setDisplayEquity((current) => ({ ...current, [connection.id]: event.target.value }))} placeholder="跟随实时余额" /><Input aria-label={`${connection.owner?.display_name || connection.id} 的余额修改原因`} value={reasons[`${connection.id}:display`] || ""} onChange={(event) => setReasons((current) => ({ ...current, [`${connection.id}:display`]: event.target.value }))} maxLength={500} placeholder="修改原因（写入审计）" /><Button type="button" size="small" disabled={pending === `${connection.id}:display`} onClick={() => void saveDisplayEquity(connection)}><Check aria-hidden size={16} />保存显示值</Button></div>{connection.status !== "disabled" ? <div className="flex gap-2"><Input aria-label={`停用 ${connection.owner?.display_name || connection.id} 的原因`} value={reasons[connection.id] || ""} onChange={(event) => setReasons((current) => ({ ...current, [connection.id]: event.target.value }))} maxLength={500} placeholder="停用原因（写入审计）" /><Button type="button" variant="danger" size="small" disabled={pending === connection.id} onClick={() => void disable(connection)}><Prohibit aria-hidden size={16} />停用</Button></div> : <span className="text-xs text-muted-foreground">{connection.last_error_code === "disabled_by_admin" ? "管理员停用" : "用户已断开"}</span>}</article>) : <p className="border-t p-7 text-sm text-muted-foreground">还没有用户绑定交易所观察 API。</p>}</div></div></div>;
}
