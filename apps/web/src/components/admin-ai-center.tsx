"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button, Field, FieldMessage, Input, Label } from "@wavekb/ui";

type Dashboard = { calls_today: number; tokens_today: number; cost_today: number; failed_today: number; review_queue: number };
type Provider = { id: string; name: string; adapter: string; base_url: string; enabled: boolean; last_four?: string };

async function adminRequest(path: string, body?: object) {
  const response = await fetch(`/api/admin/${path}`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as { error?: string; providers?: Provider[]; provider?: Provider } & Partial<Dashboard>;
  if (!response.ok) throw new Error(payload.error || "request_failed");
  return payload;
}

function adminFailure(cause: unknown, operation: "read" | "save") {
  // Only exact, fixed public codes may influence the UI. Never render an
  // upstream diagnostic, URL, key, database detail, or transport exception.
  const code = cause instanceof Error ? cause.message : "";
  return ({
    authentication_required: "登录状态已失效，请重新登录后操作。",
    admin_required: "当前账号没有 AI 后台管理权限，请使用管理员账号。",
    request_origin_invalid: "请求来源未通过校验，请刷新页面后重试。",
    admin_payload_too_large: "提交内容过大，请检查字段长度后重试。",
    admin_path_not_allowed: "此后台操作暂不可用，请刷新页面。",
    invalid_provider_url: "API 地址格式无效。请使用不含账号、密码、查询参数或片段的 HTTPS 地址。",
    provider_host_not_allowed: "该 API 主机尚未获网站允许，或属于禁止的内网地址。请联系管理员核对服务端主机白名单。",
    provider_name_conflict: "已有同名服务商。请先刷新列表核对现有配置，不要重复创建同名连接。",
    invalid_request: "服务商名称或适配器无效，请检查必填字段。",
    invalid_api_key: "API Key 不能为空，请重新填写；保存不会验证模型调用是否成功。",
    provider_save_failed: "服务商或密钥未能安全保存，请稍后刷新列表核实结果后再处理。",
  } as Record<string, string>)[code] || (operation === "save"
    ? "保存结果暂时无法确认。请先刷新后台列表核实，不要直接重复创建同名服务商。"
    : "AI 后台信息暂时无法读取，请稍后刷新；这不代表已保存的配置丢失。");
}

export function AdminAiCenter() {
  const [dashboard, setDashboard] = useState<Dashboard>({ calls_today: 0, tokens_today: 0, cost_today: 0, failed_today: 0, review_queue: 0 });
  const [providers, setProviders] = useState<Provider[]>([]);
  const [online, setOnline] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

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
    }).catch((cause) => {
      if (active) { setOnline(false); setError(adminFailure(cause, "read")); }
    });
    return () => { active = false; };
  }, []);

  async function createProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setPending(true); setError(""); setStatus("");
    let saved = false;
    try {
      const receipt = await adminRequest("providers", { name: String(form.get("name") || "").trim(), adapter: String(form.get("adapter") || ""), base_url: String(form.get("baseUrl") || "").trim(), api_key: String(form.get("apiKey") || "") });
      if (typeof receipt.provider?.id !== "string" || !receipt.provider.id) throw new Error("provider_save_unconfirmed");
      saved = true;
      formElement.reset();
      setStatus("服务商与密钥已安全保存。尚未验证模型调用；模型和路由仍需单独配置。密钥输入已清空。");
      await load();
    } catch (cause) {
      if (saved) {
        setOnline(false);
        setError("服务商与密钥已成功保存，但后台列表刷新失败。请使用“刷新后台信息”核对，不要重复保存或创建同名服务商。");
      } else setError(adminFailure(cause, "save"));
    }
    finally { setPending(false); }
  }

  async function refresh() {
    if (pending) return;
    setPending(true); setError("");
    try { await load(); setStatus("后台信息已刷新；网关管理接口连通不代表模型、密钥与路由已完成可用性验证。"); }
    catch (cause) { setOnline(false); setError(adminFailure(cause, "read")); }
    finally { setPending(false); }
  }

  const metrics = [["今日调用", dashboard.calls_today.toLocaleString("zh-CN")],["今日 Token", dashboard.tokens_today.toLocaleString("zh-CN")],["今日费用", `$${Number(dashboard.cost_today).toFixed(2)}`],["失败请求", dashboard.failed_today.toLocaleString("zh-CN")],["待人工审核", dashboard.review_queue.toLocaleString("zh-CN")]];
  return <div className="grid gap-8"><section className={`grid gap-3 rounded-xl border p-5 ${online ? "border-primary/35 bg-primary/5" : "bg-surface"}`}><div><h2 className="font-semibold">{online === null ? "正在连接 AI 网关" : online ? "AI 网关已连接" : "AI 网关管理信息暂不可用"}</h2><p className="mt-1 text-sm text-muted-foreground">{online === null ? "正在读取后台指标与服务商列表；不会发送模型测试请求。" : online ? "仅证明后台管理接口可读取；不代表模型、密钥、任务路由或会员 AI 已配置并通过调用验证。" : "后台信息暂时无法读取；这不代表已保存的配置丢失。"}</p></div><Button type="button" variant="secondary" className="min-h-11 w-fit" disabled={pending} onClick={() => void refresh()}>刷新后台信息</Button>{status ? <p role="status" className="text-sm leading-6 text-muted-foreground">{status}</p> : null}</section><section className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label="AI 网关指标">{metrics.map(([label,value]) => <article key={label} className="grid gap-2 rounded-xl border bg-surface p-4"><span className="text-xs text-muted-foreground">{label}</span><strong className="text-2xl tabular-nums">{value}</strong></article>)}</section><section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.75fr)]"><div className="grid content-start gap-4"><header><h2 className="text-xl font-semibold">平台备用接口</h2><p className="mt-1 text-sm text-muted-foreground">仅在网站明确启用平台兜底时使用，用户的私人接口不会出现在这里。</p></header>{providers.length ? providers.map((provider) => <article key={provider.id} className="grid gap-3 rounded-xl border bg-surface p-5"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{provider.name}</h3><p className="mt-1 text-xs text-muted-foreground">{provider.adapter}</p></div><span className="rounded-md bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">{provider.enabled ? "服务商配置已启用" : "服务商配置已停用"}</span></div><p className="break-all text-xs text-muted-foreground">{provider.base_url}</p><p className="text-xs">密钥 <span className="font-mono">{provider.last_four ? `••••${provider.last_four.slice(-4)}` : "尚未设置"}</span></p></article>) : <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">暂无平台备用接口。</p>}</div><form className="grid h-fit gap-5 rounded-xl border bg-surface p-5" onSubmit={createProvider}><header><h2 className="text-xl font-semibold">连接新的模型服务</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">仅校验 API 地址并加密保存密钥，不会发送模型测试请求。保存服务商不等于模型和路由已配置；密钥保存后不会回显。</p></header><Field><Label htmlFor="provider-name">服务商名称</Label><Input id="provider-name" name="name" required maxLength={80} /></Field><Field><Label htmlFor="provider-adapter">适配器</Label><select id="provider-adapter" name="adapter" className="h-11 rounded-lg border border-input bg-surface px-3 text-sm"><option value="openai_compatible">OpenAI 兼容</option><option value="anthropic">Anthropic Messages</option><option value="gemini">Google Gemini</option></select></Field><Field><Label htmlFor="provider-url">API 地址</Label><Input id="provider-url" name="baseUrl" type="url" required placeholder="https://api.deepseek.com/v1" aria-describedby="provider-url-help" /><p id="provider-url-help" className="text-xs leading-5 text-muted-foreground">DeepSeek 的 API 地址填写 https://api.deepseek.com/v1；deepseek-flash 是模型名，不填写在这里。其他服务商使用其官方 API 地址。</p></Field><Field><Label htmlFor="provider-key">API Key</Label><Input id="provider-key" name="apiKey" type="password" autoComplete="new-password" required /></Field>{error ? <FieldMessage role="alert">{error}</FieldMessage> : null}<Button type="submit" className="min-h-11" disabled={pending}>{pending ? "正在处理" : "安全保存"}</Button></form></section><section className="grid gap-4 rounded-xl border bg-surface p-5"><h2 className="text-xl font-semibold">治理边界</h2><ul className="grid gap-2 text-sm leading-6 text-muted-foreground"><li>密钥仅在服务端加密保存</li><li>输出先经过结构校验，再进入现有确定性规则闸门；知识检索以第11版原书为主，第10版条目用于版本对照</li><li>确定性计算覆盖模型生成的仓位和风险数字</li><li>每次调用保留实际模型、知识版本、Token 与费用</li><li>AI 复盘进入人工审核队列，不会自动写入正式经验库</li></ul></section></div>;
}
