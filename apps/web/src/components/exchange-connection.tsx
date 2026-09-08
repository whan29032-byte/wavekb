"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowsClockwise, CheckCircle, Eye, EyeSlash, LinkBreak, LockKey } from "@phosphor-icons/react";
import type { ExchangeConnection } from "@wavekb/domain";
import { Button, Field, FieldMessage, Input, Label } from "@wavekb/ui";

function messageFor(error: string) {
  return ({
    read_only_ack_required: "请先确认这是一组已关闭交易和提现权限的观察 API。",
    public_amounts_consent_required: "加入公开排行前，请明确同意公开当前账户权益和累计盈利。",
    invalid_api_key: "API Key 格式无效。",
    invalid_secret_key: "Secret Key 格式无效。",
    binance_2014: "币安拒绝了这组 API Key，请检查格式。",
    binance_2015: "币安拒绝访问：请检查 Key、IP 白名单与 U 本位合约读取权限。",
    binance_1021: "服务器时间与币安不同步，请稍后重试。",
    binance_1022: "签名校验失败，请重新填写 Secret Key。",
    binance_multi_asset_not_supported: "当前版本暂不支持多资产保证金账户，以免收益率换算失真。",
    binance_transfer_asset_not_supported: "检测到非 USDT 转入转出，当前版本不会用不准确的汇率参与排行。",
    exchange_sync_gap_too_large: "距离上次同步已超过币安可查询的三个月资金流水范围。该连接已暂停排行，请断开后重新绑定并开始新的观察期。",
    exchange_gateway_unavailable: "交易所连接服务暂时不可用。",
    authentication_required: "请先登录。",
  } as Record<string, string>)[error] || "连接没有完成，请检查配置后重试。";
}

export function ExchangeConnectionPanel({ actorId }: { actorId: string | null }) {
  const router = useRouter();
  const [connection, setConnection] = useState<ExchangeConnection | null>(null);
  const [loading, setLoading] = useState(Boolean(actorId));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!actorId) return;
    let active = true;
    void fetch("/api/exchange/connection", { cache: "no-store" }).then(async (response) => {
      const payload = await response.json().catch(() => ({})) as { connection?: ExchangeConnection; error?: string };
      if (!response.ok) throw new Error(payload.error || "request_failed");
      if (active) setConnection(payload.connection ?? null);
    }).catch((cause) => { if (active) setError(messageFor(cause instanceof Error ? cause.message : "request_failed")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [actorId]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setPending(true); setError(""); setStatus("正在向币安验证只读访问…");
    try {
      const response = await fetch("/api/exchange/connection", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label: values.get("label"),
          api_key: values.get("apiKey"),
          secret_key: values.get("secretKey"),
          public_enabled: values.get("publicEnabled") === "on",
          public_amounts_consent: values.get("publicEnabled") === "on",
          read_only_ack: values.get("readOnlyAck") === "on",
        }),
      });
      const payload = await response.json().catch(() => ({})) as { connection?: ExchangeConnection; error?: string };
      if (!response.ok || !payload.connection) throw new Error(payload.error || "request_failed");
      setConnection(payload.connection); form.reset(); setStatus(payload.connection.public_enabled ? "连接已验证，已加入实时排行榜。" : "连接已验证，当前仅私下跟踪。"); router.refresh();
    } catch (cause) {
      setError(messageFor(cause instanceof Error ? cause.message : "request_failed")); setStatus("");
    } finally { setPending(false); }
  }

  async function action(kind: "sync" | "disconnect") {
    if (kind === "disconnect" && !window.confirm("确认断开币安观察 API？历史收益快照会保留，但不再公开或更新。")) return;
    setPending(true); setError(""); setStatus(kind === "sync" ? "正在同步账户快照…" : "正在断开连接…");
    try {
      const response = await fetch(`/api/exchange/connection/${kind}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const payload = await response.json().catch(() => ({})) as { connection?: ExchangeConnection; error?: string };
      if (!response.ok) throw new Error(payload.error || "request_failed");
      setConnection(kind === "disconnect" ? null : payload.connection ?? connection);
      setStatus(kind === "disconnect" ? "连接已断开。" : "同步完成，排行榜已按最新快照刷新。"); router.refresh();
    } catch (cause) { setError(messageFor(cause instanceof Error ? cause.message : "request_failed")); setStatus(""); }
    finally { setPending(false); }
  }

  async function setPublic(publicEnabled: boolean) {
    setPending(true); setError(""); setStatus(publicEnabled ? "正在确认公开范围…" : "正在退出公开排行…");
    try {
      const response = await fetch("/api/exchange/connection/public", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ public_enabled: publicEnabled }),
      });
      const payload = await response.json().catch(() => ({})) as { connection?: ExchangeConnection; error?: string };
      if (!response.ok || !payload.connection) throw new Error(payload.error || "request_failed");
      setConnection(payload.connection);
      setStatus(publicEnabled ? "已同意公开金额并加入实时排行榜。" : "已退出公开排行，连接仍会私下跟踪。");
      router.refresh();
    } catch (cause) { setError(messageFor(cause instanceof Error ? cause.message : "request_failed")); setStatus(""); }
    finally { setPending(false); }
  }

  if (!actorId) return <section className="grid gap-3 border-y py-5"><h2 className="font-semibold">绑定我的只读账户</h2><p className="text-sm leading-6 text-muted-foreground">登录后可绑定币安 U 本位合约观察 API。收益从绑定成功后开始计算，并按最新同步结果更新。</p><Button asChild variant="secondary" className="w-fit"><Link href="/login?next=%2Fleaderboard">登录后绑定</Link></Button></section>;
  if (loading) return <p role="status" className="border-y py-5 text-sm text-muted-foreground">正在读取交易所连接…</p>;

  if (connection) return <section className="grid gap-4 border-y py-5" aria-labelledby="exchange-status-title"><header className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="exchange-status-title" className="flex items-center gap-2 font-semibold"><CheckCircle aria-hidden size={19} className={connection.status === "active" ? "text-primary" : "text-destructive"} />{connection.label}</h2><p className="mt-1 text-xs text-muted-foreground">币安 U 本位合约 · Key {connection.secret_mask} · {connection.public_enabled && connection.public_amounts_consented ? "参与公开排行" : "仅自己可见"}</p></div><span className="text-xs font-medium">{connection.status === "active" ? "连接正常" : "同步异常"}</span></header><dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-xs text-muted-foreground">开始跟踪</dt><dd className="mt-1">{new Date(connection.started_at).toLocaleString("zh-CN")}</dd></div><div><dt className="text-xs text-muted-foreground">最近同步</dt><dd className="mt-1">{connection.last_synced_at ? new Date(connection.last_synced_at).toLocaleString("zh-CN") : "尚未同步"}</dd></div></dl>{connection.last_error_code ? <FieldMessage role="alert">{messageFor(connection.last_error_code)}</FieldMessage> : null}<div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" disabled={pending} onClick={() => void action("sync")}><ArrowsClockwise aria-hidden size={17} />立即同步</Button>{connection.public_enabled && connection.public_amounts_consented ? <Button type="button" variant="secondary" disabled={pending} onClick={() => void setPublic(false)}><EyeSlash aria-hidden size={17} />退出公开排行</Button> : <Button type="button" variant="secondary" disabled={pending} onClick={() => void setPublic(true)}><Eye aria-hidden size={17} />同意公开金额并加入排行</Button>}<Button type="button" variant="ghost" disabled={pending} onClick={() => void action("disconnect")}><LinkBreak aria-hidden size={17} />断开连接</Button></div>{status ? <p role="status" className="text-xs text-muted-foreground">{status}</p> : null}{error ? <FieldMessage role="alert">{error}</FieldMessage> : null}</section>;

  return <form className="grid gap-5 border-y py-5" onSubmit={submit}><header><h2 className="flex items-center gap-2 font-semibold"><LockKey aria-hidden size={19} className="text-primary" />绑定币安观察 API</h2><p className="mt-1 max-w-[70ch] text-sm leading-6 text-muted-foreground">仅支持 U 本位合约的单资产保证金模式。请新建专用 API，关闭现货/合约交易与提现权限，并尽量设置服务器 IP 白名单。密钥由服务端 AES-256-GCM 加密，浏览器之后只能看到末四位。</p></header><div className="grid gap-4 sm:grid-cols-2"><Field><Label htmlFor="exchange-label">连接名称</Label><Input id="exchange-label" name="label" defaultValue="币安 U 本位合约" minLength={2} maxLength={60} required /></Field><Field><Label htmlFor="exchange-api-key">API Key</Label><Input id="exchange-api-key" name="apiKey" type="password" autoComplete="off" minLength={16} maxLength={512} required /></Field><Field className="sm:col-span-2"><Label htmlFor="exchange-secret-key">Secret Key</Label><Input id="exchange-secret-key" name="secretKey" type="password" autoComplete="new-password" minLength={16} maxLength={512} required /></Field></div><label className="flex items-start gap-3 text-sm leading-6"><input name="readOnlyAck" type="checkbox" required className="mt-1.5 accent-primary" /><span>我确认这是一组专用观察 API，已关闭交易和提现权限；如权限变化，我会立即撤销并重新绑定。</span></label><label className="flex items-start gap-3 text-sm leading-6"><input name="publicEnabled" type="checkbox" className="mt-1.5 accent-primary" /><span>绑定成功后，把实时收益率、当前账户权益、累计盈利和站内身份加入公开排行榜；不公开仓位、订单、交易明细、资金流水或 API 信息。</span></label>{status ? <p role="status" className="text-sm text-muted-foreground">{status}</p> : null}{error ? <FieldMessage role="alert">{error}</FieldMessage> : null}<Button type="submit" className="w-fit" disabled={pending}>{pending ? "正在验证" : "验证并开始跟踪"}</Button></form>;
}
