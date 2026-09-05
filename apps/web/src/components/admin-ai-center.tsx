"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button, Field, FieldMessage, Input, Label } from "@wavekb/ui";

type Dashboard = { calls_today: number; tokens_today: number; cost_today: number; failed_today: number; review_queue: number };
type Provider = { id: string; name: string; adapter: string; base_url: string; enabled: boolean; last_four?: string };

async function adminRequest(path: string, body?: object) {
  const response = await fetch(`/api/admin/${path}`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as { error?: string; providers?: Provider[] } & Partial<Dashboard>;
  if (!response.ok) throw new Error(payload.error || "request_failed");
  return payload;
}

export function AdminAiCenter() {
  const [dashboard, setDashboard] = useState<Dashboard>({ calls_today: 0, tokens_today: 0, cost_today: 0, failed_today: 0, review_queue: 0 });
  const [providers, setProviders] = useState<Provider[]>([]);
  const [online, setOnline] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const [metrics, providerPayload] = await Promise.all([adminRequest("dashboard"), adminRequest("providers")]);
    setDashboard((current) => ({ ...current, ...metrics }));
    setProviders(providerPayload.providers ?? []);
    setOnline(true);
  }

  useEffect(() => {
    let active = true;
    void Promise.all([adminRequest("dashboard"), adminRequest("providers")]).then(([metrics, providerPayload]) => {
      if (!active) return;
      setDashboard((current) => ({ ...current, ...metrics }));
      setProviders(providerPayload.providers ?? []);
      setOnline(true);
    }).catch(() => {
      if (active) { setOnline(false); setError("AI 网关暂时无法连接，工作台和知识库仍可继续使用。"); }
    });
    return () => { active = false; };
  }, []);

  async function createProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setPending(true); setError("");
    try {
      await adminRequest("providers", { name: String(form.get("name") || "").trim(), adapter: String(form.get("adapter") || ""), base_url: String(form.get("baseUrl") || "").trim(), api_key: String(form.get("apiKey") || "") });
      formElement.reset();
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "备用接口保存失败。"); }
    finally { setPending(false); }
  }

  const metrics = [["今日调用", dashboard.calls_today.toLocaleString("zh-CN")],["今日 Token", dashboard.tokens_today.toLocaleString("zh-CN")],["今日费用", `$${Number(dashboard.cost_today).toFixed(2)}`],["失败请求", dashboard.failed_today.toLocaleString("zh-CN")],["待人工审核", dashboard.review_queue.toLocaleString("zh-CN")]];
  return <div className="grid gap-8"><section className={`rounded-xl border p-5 ${online ? "border-primary/35 bg-primary/5" : "bg-surface"}`}><h2 className="font-semibold">{online === null ? "正在连接 AI 网关" : online ? "AI 网关已连接" : "AI 网关尚未连接"}</h2><p className="mt-1 text-sm text-muted-foreground">{online ? "服务端密钥、路由、日志和预算控制均可用。" : "知识库与工作台仍可离线使用，网关恢复后才会发生外部模型调用。"}</p></section><section className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label="AI 网关指标">{metrics.map(([label,value]) => <article key={label} className="grid gap-2 rounded-xl border bg-surface p-4"><span className="text-xs text-muted-foreground">{label}</span><strong className="text-2xl tabular-nums">{value}</strong></article>)}</section><section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.75fr)]"><div className="grid content-start gap-4"><header><h2 className="text-xl font-semibold">平台备用接口</h2><p className="mt-1 text-sm text-muted-foreground">仅在网站明确启用平台兜底时使用，用户的私人接口不会出现在这里。</p></header>{providers.length ? providers.map((provider) => <article key={provider.id} className="grid gap-3 rounded-xl border bg-surface p-5"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{provider.name}</h3><p className="mt-1 text-xs text-muted-foreground">{provider.adapter}</p></div><span className="rounded-md bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">{provider.enabled ? "已启用" : "已停用"}</span></div><p className="break-all text-xs text-muted-foreground">{provider.base_url}</p><p className="text-xs">密钥 <span className="font-mono">{provider.last_four ? `••••${provider.last_four.slice(-4)}` : "尚未设置"}</span></p></article>) : <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">暂无平台备用接口。</p>}</div><form className="grid h-fit gap-5 rounded-xl border bg-surface p-5" onSubmit={createProvider}><header><h2 className="text-xl font-semibold">连接新的模型服务</h2><p className="mt-1 text-sm text-muted-foreground">地址和连接由服务器验证，密钥加密后不会回显。</p></header><Field><Label htmlFor="provider-name">服务商名称</Label><Input id="provider-name" name="name" required maxLength={80} /></Field><Field><Label htmlFor="provider-adapter">适配器</Label><select id="provider-adapter" name="adapter" className="h-11 rounded-lg border border-input bg-surface px-3 text-sm"><option value="openai_compatible">OpenAI 兼容</option><option value="anthropic">Anthropic Messages</option><option value="gemini">Google Gemini</option></select></Field><Field><Label htmlFor="provider-url">API 地址</Label><Input id="provider-url" name="baseUrl" type="url" required placeholder="https://api.example.com/v1" /></Field><Field><Label htmlFor="provider-key">API Key</Label><Input id="provider-key" name="apiKey" type="password" autoComplete="new-password" required /></Field>{error ? <FieldMessage role="alert">{error}</FieldMessage> : null}<Button type="submit" disabled={pending}>{pending ? "正在测试并保存" : "测试并保存"}</Button></form></section><section className="grid gap-4 rounded-xl border bg-surface p-5"><h2 className="text-xl font-semibold">治理边界</h2><ul className="grid gap-2 text-sm leading-6 text-muted-foreground"><li>密钥仅在服务端加密保存</li><li>输出先经过结构校验，再进入第10版规则闸门</li><li>确定性计算覆盖模型生成的仓位和风险数字</li><li>每次调用保留实际模型、知识版本、Token 与费用</li><li>AI 复盘进入人工审核队列，不会自动写入正式经验库</li></ul></section></div>;
}
