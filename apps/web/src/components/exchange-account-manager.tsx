"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowsClockwise, CheckCircle, LinkBreak, LockKey, Trash, WarningCircle } from "@phosphor-icons/react";
import { Button, Field, FieldMessage, Input, Label } from "@wavekb/ui";
import { exchangeErrorMessage } from "@/lib/trading/exchange-errors";

type Provider = "binance" | "okx" | "bybit" | "bitget" | "exness";

type AccountCandidate = {
  external_account_ref: string;
  account_label: string;
  account_identifier_mask: string;
  account_currency: string;
  products: string[];
  read_only_status: "verified" | "user_attested";
};

type Connection = {
  id: string;
  provider: Provider;
  account_label: string;
  account_identifier_mask: string;
  account_currency: string;
  products: string[];
  read_only_status: "verified" | "user_attested";
  capability_status: "ready";
  history_coverage_started_at?: string | null;
  equity_tracking_started_at?: string | null;
  status: "pending_verification" | "active" | "error" | "disabled" | "deleting";
  public_enabled: boolean;
  last_synced_at: string | null;
  last_error_code: string;
};

const providerLabels: Record<Provider, string> = {
  binance: "Binance USD-M",
  okx: "OKX 永续与交割",
  bybit: "Bybit USDT 永续",
  bitget: "Bitget USDT 合约",
  exness: "Exness CFD",
};

function messageFor(code: string) {
  return ({
    read_only_ack_required: "请确认这组 API 已关闭交易和提现权限。",
    public_amounts_consent_required: "加入收益榜前需要明确同意公开收益率、账户权益和累计盈利。",
    account_unavailable: "这个交易账户暂时无法绑定。请检查它是否已关联其他站内账户。",
    exchange_account_selection_invalid: "请选择本次验证发现的账户。",
    credential_accounts_mismatch: "新凭证没有覆盖当前凭证组的全部账户，暂未替换。",
    trading_provider_disabled: "该交易平台目前未开放连接。",
    exchange_gateway_unavailable: "交易账户服务暂时不可用，请稍后重试。",
    authentication_required: "请先登录。",
    exness_invalid_api_key: "Exness API Key 无效或已过期，请重新生成后再试。",
    exness_invalid_signature: "Exness 签名验证失败，请确认 API Key 与私钥来自同一组凭据。",
    exness_permission_denied: "这组 API Key 没有访问该交易账户的只读权限。",
    exness_rate_limited: "Exness 请求过于频繁，请稍后再试。",
    exness_unavailable: "无法连接 Exness Gateway，请检查 Gateway Host 后重试。",
    exness_invalid_private_key: "Exness 私钥格式或内容不正确，请粘贴完整的 128 位私钥或 PKCS#8 PEM。",
    exness_credentials_required: "请完整填写 Exness API Key、私钥和 Gateway Host。",
    exness_account_ids_required: "请填写 Exness 交易账户 ID。",
    exness_invalid_account_ids: "Exness 交易账户 ID 只能填写数字，不要包含 #。",
    exness_discovery_not_allowed: "请填写 Exness API 管理页 DNS Widget 中显示的 HTTPS Gateway Host。",
    exness_access_point_not_allowed: "Exness 返回了不受信任的 Access Point，请稍后重试或联系 Exness 支持。",
    exness_read_only_scope_required: "只允许绑定 Trading Read-only API Key。",
    exness_account_trading_disabled: "该 Exness 交易账户目前不可用，请检查账户状态。",
  } as Record<string, string>)[code] ?? exchangeErrorMessage(code);
}

function credentialPayload(provider: Provider, form: HTMLFormElement): Record<string, string> {
  const values = new FormData(form);
  const base = {
    apiKey: String(values.get("apiKey") || "").trim(),
    secretKey: String(values.get("secretKey") || "").trim(),
  };
  if (provider === "okx" || provider === "bitget") {
    return { ...base, passphrase: String(values.get("passphrase") || "") };
  }
  if (provider === "exness") {
    const accountIds = String(values.get("accountIds") || "")
      .split(/[\n,]+/).map((item) => item.trim()).filter(Boolean).join(",");
    return {
      apiKey: base.apiKey,
      privateKey: String(values.get("privateKey") || "").trim(),
      accountIds,
      discoveryBaseUrl: String(values.get("discoveryBaseUrl") || "").trim(),
      trading_scope: "read_only",
    };
  }
  return base;
}

type ExchangeApiPayload = {
  error?: unknown;
  connections?: unknown;
  connection?: unknown;
  validation?: { accounts?: unknown };
  sync?: { status?: unknown; reason?: unknown };
};

async function payload(response: Response): Promise<ExchangeApiPayload> {
  const value: unknown = await response.json().catch(() => ({}));
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as ExchangeApiPayload
    : {};
}

async function fetchConnections(): Promise<Connection[]> {
  const response = await fetch("/api/exchange/connections", { cache: "no-store" });
  const body = await payload(response);
  if (!response.ok) throw new Error(String(body.error || "request_failed"));
  return Array.isArray(body.connections) ? body.connections as Connection[] : [];
}

function lastSuccessfulSync(value: string | null): string {
  if (!value) return "尚未成功同步";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "尚未成功同步";
  return `最后成功同步：${date.toLocaleString("zh-CN")}`;
}

export function ExchangeAccountManager({ actorId }: { actorId: string | null }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [provider, setProvider] = useState<Provider>("binance");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [candidates, setCandidates] = useState<AccountCandidate[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [validatedCredentials, setValidatedCredentials] = useState<Record<string, string> | null>(null);
  const [reverifyConnectionId, setReverifyConnectionId] = useState<string | null>(null);
  const [readOnlyAck, setReadOnlyAck] = useState(false);
  const [loading, setLoading] = useState(Boolean(actorId));
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!actorId) return;
    let active = true;
    void fetchConnections()
      .then((items) => { if (active) setConnections(items); })
      .catch((cause) => { if (active) setError(messageFor(cause instanceof Error ? cause.message : "request_failed")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [actorId]);

  function changeProvider(value: Provider) {
    setProvider(value);
    setCandidates([]);
    setSelected([]);
    setValidatedCredentials(null);
    setReverifyConnectionId(null);
    setReadOnlyAck(false);
    setNotice("");
    setError("");
  }

  async function validate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const credentials = credentialPayload(provider, event.currentTarget);
    setPending(true); setError(""); setNotice("正在验证只读权限…");
    try {
      const response = await fetch("/api/exchange/connections/validate", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, credentials, read_only_ack: readOnlyAck }),
      });
      const body = await payload(response);
      if (!response.ok || !body.validation) throw new Error(String(body.error || "request_failed"));
      const accounts = Array.isArray(body.validation.accounts) ? body.validation.accounts as AccountCandidate[] : [];
      setCandidates(accounts);
      setSelected(accounts.length === 1 ? [accounts[0]!.external_account_ref] : []);
      setValidatedCredentials(credentials);
      setNotice(accounts.length === 1 ? "验证完成，可以连接账户。" : `验证完成，发现 ${accounts.length} 个账户。`);
    } catch (cause) {
      setCandidates([]); setValidatedCredentials(null); setNotice("");
      setError(messageFor(cause instanceof Error ? cause.message : "request_failed"));
    } finally { setPending(false); }
  }

  async function connect() {
    if (!validatedCredentials || (!reverifyConnectionId && !selected.length)) return;
    setPending(true); setError(""); setNotice("正在建立加密连接…");
    try {
      const label = String(new FormData(formRef.current!).get("label") || "").trim();
      const response = await fetch(reverifyConnectionId
        ? `/api/exchange/connections/${reverifyConnectionId}/reverify`
        : "/api/exchange/connections/connect", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(reverifyConnectionId
          ? { credentials: validatedCredentials, read_only_ack: true }
          : { provider, label, credentials: validatedCredentials, read_only_ack: true, selected_account_refs: selected }),
      });
      const body = await payload(response);
      if (!response.ok || !Array.isArray(body.connections)) throw new Error(String(body.error || "request_failed"));
      setConnections((current) => {
        const ids = new Set((body.connections as Connection[]).map((item) => item.id));
        return [...current.filter((item) => !ids.has(item.id)), ...body.connections as Connection[]];
      });
      const count = body.connections.length;
      setNotice(reverifyConnectionId ? `已更新 ${count} 个关联账户的凭证` : `已连接 ${count} 个账户`);
      setCandidates([]); setSelected([]); setValidatedCredentials(null); setReadOnlyAck(false); setReverifyConnectionId(null);
      formRef.current?.reset();
      router.refresh();
    } catch (cause) {
      setNotice(""); setError(messageFor(cause instanceof Error ? cause.message : "request_failed"));
    } finally { setPending(false); }
  }

  function beginReverify(connection: Connection) {
    setProvider(connection.provider);
    setReverifyConnectionId(connection.id);
    setCandidates([]); setSelected([]); setValidatedCredentials(null); setReadOnlyAck(false);
    setError(""); setNotice(`请填写“${connection.account_label}”所在凭证组的新只读 API。`);
    formRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }

  async function connectionAction(connection: Connection, action: "public" | "disconnect" | "data" | "sync") {
    if (action === "disconnect" && !window.confirm(`确认断开“${connection.account_label}”？已同步的复盘数据会保留。`)) return;
    if (action === "data" && !window.confirm(`确认删除“${connection.account_label}”的交易数据？数据将隐藏并进入 30 天删除期。`)) return;
    setPending(true); setError(""); setNotice("");
    const method = action === "data" ? "DELETE" : "POST";
    const nextPublic = !connection.public_enabled;
    try {
      const response = await fetch(`/api/exchange/connections/${connection.id}/${action}`, {
        method,
        ...(method === "POST" ? {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(action === "public" ? { public_enabled: nextPublic, public_amounts_consent: nextPublic } : {}),
        } : {}),
      });
      const body = await payload(response);
      if (!response.ok) throw new Error(String(body.error || "request_failed"));
      if (action === "data") setConnections((items) => items.filter((item) => item.id !== connection.id));
      else if (action === "sync") setConnections(await fetchConnections());
      else if (body.connection) setConnections((items) => items.map((item) => item.id === connection.id ? body.connection as Connection : item));
      setNotice(action === "public" ? (nextPublic ? "该账户已加入收益榜。" : "该账户已退出收益榜。") : action === "disconnect" ? "账户连接已断开。" : action === "data" ? "删除申请已提交。" : body.sync?.status === "published" ? "交易记录已同步。" : body.sync?.reason === "manual_throttled" ? "刚刚同步过，请稍后再试。" : "同步任务正在由其他进程处理。");
      router.refresh();
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "request_failed";
      if (action === "sync") {
        try { setConnections(await fetchConnections()); } catch { /* Preserve the original sync failure. */ }
        router.refresh();
      }
      setError(messageFor(code));
    }
    finally { setPending(false); }
  }

  if (!actorId) return (
    <section className="grid gap-3 border-y py-5">
      <h2 className="font-semibold">连接只读交易账户</h2>
      <p className="text-sm leading-6 text-muted-foreground">登录并激活 UID 后，可连接交易平台并自动生成复盘数据。</p>
      <Button asChild variant="secondary" className="w-fit"><Link href="/login?next=%2Fworkbench">登录后连接</Link></Button>
    </section>
  );
  if (loading) return <p role="status" className="border-y py-5 text-sm text-muted-foreground">正在读取交易账户…</p>;

  return (
    <section className="grid gap-8" aria-labelledby="exchange-manager-title">
      <header className="grid gap-2">
        <h2 id="exchange-manager-title" className="flex items-center gap-2 text-xl font-semibold"><LockKey aria-hidden size={20} />交易账户连接</h2>
        <p className="max-w-[76ch] text-sm leading-6 text-muted-foreground">仅使用关闭交易与提现权限的观察 API。密钥只在服务端加密保存，页面仅显示账户掩码。</p>
      </header>

      <form ref={formRef} className="grid gap-5 rounded-xl border p-5" onSubmit={validate}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field>
            <Label htmlFor="exchange-provider">交易平台</Label>
            <select id="exchange-provider" value={provider} onChange={(event) => changeProvider(event.target.value as Provider)} className="h-10 rounded-md border bg-background px-3 text-sm">
              {Object.entries(providerLabels).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
            </select>
          </Field>
          <Field><Label htmlFor="exchange-label">连接名称</Label><Input key={provider} id="exchange-label" name="label" defaultValue={`${providerLabels[provider]} 只读账户`} maxLength={80} required /></Field>
          <Field><Label htmlFor="exchange-api-key">API Key</Label><Input id="exchange-api-key" name="apiKey" type="password" autoComplete="off" required /></Field>
          {provider !== "exness" ? <Field><Label htmlFor="exchange-secret-key">Secret Key</Label><Input id="exchange-secret-key" name="secretKey" type="password" autoComplete="new-password" required /></Field> : null}
          {(provider === "okx" || provider === "bitget") ? <Field><Label htmlFor="exchange-passphrase">API Passphrase</Label><Input id="exchange-passphrase" name="passphrase" type="password" autoComplete="new-password" required /></Field> : null}
          {provider === "exness" ? <>
            <Field className="md:col-span-2">
              <Label htmlFor="exchange-discovery-base-url">Gateway Host（DNS Widget）</Label>
              <Input id="exchange-discovery-base-url" name="discoveryBaseUrl" type="url" inputMode="url" autoComplete="off" placeholder="https://gateway.example" required />
              <FieldMessage>复制 Exness API 管理页 DNS Widget 当前显示的 HTTPS Gateway Host，不要使用示例地址。</FieldMessage>
            </Field>
            <Field className="md:col-span-2">
              <Label htmlFor="exchange-private-key">私钥（128 位十六进制或 PKCS#8 PEM）</Label>
              <textarea id="exchange-private-key" name="privateKey" required rows={5} className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs" />
              <FieldMessage>粘贴创建这组 API Key 时保存的私钥；不要填写 API Key 标识或公钥。</FieldMessage>
            </Field>
            <Field className="md:col-span-2"><Label htmlFor="exchange-account-ids">交易账户 ID（每行一个）</Label><textarea id="exchange-account-ids" name="accountIds" required rows={3} className="w-full rounded-md border bg-background px-3 py-2 text-sm" /></Field>
          </> : null}
        </div>
        <label className="flex items-start gap-3 text-sm leading-6">
          <input type="checkbox" checked={readOnlyAck} onChange={(event) => setReadOnlyAck(event.target.checked)} className="mt-1.5 accent-primary" />
          <span>我确认已关闭交易和提现权限，仅允许读取账户、成交与资金历史。</span>
        </label>
        <Button type="submit" className="w-fit" disabled={pending || !readOnlyAck}>{pending ? "正在验证…" : "验证只读权限"}</Button>
      </form>

      {candidates.length ? <section className="grid gap-3 rounded-xl border p-5" aria-labelledby="candidate-title">
        <h3 id="candidate-title" className="font-semibold">{reverifyConnectionId ? "确认新凭证覆盖的账户" : "选择要连接的账户"}</h3>
        {candidates.map((candidate) => <label key={candidate.external_account_ref} className="flex items-center gap-3 rounded-lg border p-3 text-sm">
          <input type="checkbox" disabled={Boolean(reverifyConnectionId)} checked={reverifyConnectionId ? true : selected.includes(candidate.external_account_ref)} onChange={(event) => setSelected((items) => event.target.checked ? [...items, candidate.external_account_ref] : items.filter((item) => item !== candidate.external_account_ref))} />
          <span className="font-medium">{candidate.account_label}</span><span className="text-muted-foreground">{candidate.account_identifier_mask} · {candidate.account_currency}</span>
        </label>)}
        <Button type="button" className="w-fit" disabled={pending || (!reverifyConnectionId && !selected.length)} onClick={() => void connect()}>{reverifyConnectionId ? "更新这组凭证" : `连接 ${selected.length} 个账户`}</Button>
      </section> : null}

      <section className="grid gap-3" aria-labelledby="connected-title">
        <h3 id="connected-title" className="font-semibold">已连接账户</h3>
        {!connections.length ? <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">还没有连接交易账户</p> : connections.map((connection) => {
          const syncUnhealthy = connection.status !== "disabled"
            && connection.status !== "deleting"
            && (connection.status === "error" || Boolean(connection.last_error_code));
          return (
          <article key={connection.id} data-testid={`exchange-connection-${connection.id}`} className="grid gap-4 rounded-xl border p-5">
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div><h4 className="flex items-center gap-2 font-semibold"><CheckCircle aria-hidden size={18} />{connection.account_label}</h4><p className="mt-1 text-xs text-muted-foreground">{providerLabels[connection.provider]} · {connection.account_identifier_mask} · {connection.account_currency}</p></div>
              <span className={syncUnhealthy ? "flex items-center gap-1 text-xs font-medium text-warning" : "text-xs text-muted-foreground"}>
                {syncUnhealthy ? <WarningCircle aria-hidden size={16} /> : null}
                {connection.status === "disabled" ? "已断开" : syncUnhealthy ? "同步异常" : connection.status === "active" ? "连接正常" : "需要检查"}
              </span>
            </header>
            {syncUnhealthy ? <div className="grid gap-1 border-l-2 border-warning pl-3 text-sm leading-6">
              <p className="font-medium text-warning">{messageFor(connection.last_error_code)}</p>
              <p className="text-muted-foreground">当前保留上次完整数据</p>
              {connection.last_synced_at
                ? <time className="text-xs text-muted-foreground" dateTime={connection.last_synced_at}>{lastSuccessfulSync(connection.last_synced_at)}</time>
                : <p className="text-xs text-muted-foreground">{lastSuccessfulSync(null)}</p>}
            </div> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" disabled={pending || connection.status !== "active" || syncUnhealthy} onClick={() => void connectionAction(connection, "public")}>{connection.public_enabled ? "退出收益榜" : "加入收益榜"}</Button>
              <Button type="button" variant="ghost" disabled={pending || (connection.status !== "active" && connection.status !== "error")} onClick={() => void connectionAction(connection, "sync")}><ArrowsClockwise aria-hidden size={16} />立即同步</Button>
              <Button type="button" variant="ghost" disabled={pending} onClick={() => beginReverify(connection)}>更新 API</Button>
              <Button type="button" variant="ghost" disabled={pending || connection.status === "disabled"} onClick={() => void connectionAction(connection, "disconnect")}><LinkBreak aria-hidden size={16} />断开连接</Button>
              <Button type="button" variant="ghost" disabled={pending} onClick={() => void connectionAction(connection, "data")}><Trash aria-hidden size={16} />删除数据</Button>
            </div>
          </article>
          );
        })}
      </section>
      {notice ? <p role="status" className="text-sm text-muted-foreground">{notice}</p> : null}
      {error ? <FieldMessage role="alert">{error}</FieldMessage> : null}
    </section>
  );
}
