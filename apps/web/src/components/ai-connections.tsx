"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, Field, FieldMessage, Input, Label } from "@wavekb/ui";

type AiConnection = {
  id: string;
  label: string;
  adapter: "openai_compatible" | "anthropic" | "gemini";
  base_url: string;
  model_name: string;
  max_output_tokens: number;
  temperature: number;
  enabled: boolean;
  is_default: boolean;
  secret_mask: string;
};

const providers = {
  openai_compatible: { label: "OpenAI 兼容接口", baseUrl: "https://api.openai.com/v1", model: "" },
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash", adapter: "openai_compatible" },
  anthropic: { label: "Claude / Anthropic", baseUrl: "https://api.anthropic.com", model: "", adapter: "anthropic" },
  gemini: { label: "Gemini", baseUrl: "https://generativelanguage.googleapis.com", model: "", adapter: "gemini" },
} as const;

async function request(path: string, body?: object) {
  const response = await fetch(`/api/ai/${path}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({})) as { error?: string; connections?: AiConnection[]; connection?: AiConnection };
  if (!response.ok) throw new Error(payload.error || "request_failed");
  return payload;
}

function aiError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/authentication_required/i.test(message)) return "登录状态已失效，请重新登录。";
  if (/request_origin_invalid/i.test(message)) return "请求来源无效，请刷新页面后重试。";
  if (/gateway|fetch|network/i.test(message)) return "AI 网关暂时无法连接，请稍后重试。";
  if (/request_failed/i.test(message)) return "保存失败，请检查接口地址和参数。";
  return message || "操作失败，请重试。";
}

export function AiConnections() {
  const [connections, setConnections] = useState<AiConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [provider, setProvider] = useState<keyof typeof providers>("openai_compatible");
  const [rotateId, setRotateId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const payload = await request("user/ai-connections");
    setConnections(payload.connections ?? []);
  }, []);

  useEffect(() => {
    let active = true;
    void request("user/ai-connections").then((payload) => {
      if (active) setConnections(payload.connections ?? []);
    }).catch((cause) => {
      if (active) setError(aiError(cause));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const selected = providers[provider];
    const label = String(form.get("label") ?? "").trim();
    const baseUrl = String(form.get("baseUrl") ?? "").trim();
    const modelName = String(form.get("modelName") ?? "").trim();
    const apiKey = String(form.get("apiKey") ?? "").trim();
    if (label.length < 2 || label.length > 60 || !baseUrl || !modelName || !apiKey) {
      setError("请完整填写接口名称、地址、模型名称和 API Key。");
      return;
    }
    setPending(true);
    setError("");
    try {
      await request("user/ai-connections", {
        label,
        adapter: "adapter" in selected ? selected.adapter : "openai_compatible",
        base_url: baseUrl,
        model_name: modelName,
        api_key: apiKey,
        max_output_tokens: Number(form.get("maxOutputTokens") || 4096),
        temperature: Number(form.get("temperature") || 0.2),
      });
      event.currentTarget.reset();
      setProvider("openai_compatible");
      await load();
    } catch (cause) {
      setError(aiError(cause));
    } finally {
      setPending(false);
    }
  }

  async function makeDefault(id: string) {
    setPending(true);
    setError("");
    try { await request(`user/ai-connections/${id}/default`, {}); await load(); }
    catch (cause) { setError(aiError(cause)); }
    finally { setPending(false); }
  }

  async function rotate(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const apiKey = String(new FormData(event.currentTarget).get("apiKey") ?? "").trim();
    if (!apiKey) { setError("请填写新的 API Key。"); return; }
    setPending(true);
    setError("");
    try { await request(`user/ai-connections/${id}/rotate-key`, { api_key: apiKey }); setRotateId(null); await load(); }
    catch (cause) { setError(aiError(cause)); }
    finally { setPending(false); }
  }

  const selected = providers[provider];
  return (
    <div className="grid gap-8">
      <section className="grid gap-4" aria-labelledby="connections-title">
        <header><h2 id="connections-title" className="text-xl font-semibold">你的模型接口</h2><p className="mt-1 text-sm text-muted-foreground">密钥仅发送到本站网关并加密保存，保存后不会在浏览器中回显。</p></header>
        {loading ? <p className="rounded-xl border p-5 text-sm text-muted-foreground">正在读取私有接口配置</p> : connections.length ? <div className="grid gap-3 sm:grid-cols-2">{connections.map((connection) => <article key={connection.id} className="grid gap-4 rounded-xl border bg-surface p-5"><header className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{connection.label}</h3><p className="mt-1 text-xs text-muted-foreground">{connection.model_name}</p></div><span className={`rounded-md px-2 py-1 text-xs font-semibold ${connection.is_default ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{connection.is_default ? "当前使用" : "可选"}</span></header><dl className="grid gap-2 text-xs text-muted-foreground"><div><dt className="sr-only">接口地址</dt><dd className="break-all">{connection.base_url}</dd></div><div className="flex justify-between"><dt>密钥</dt><dd className="font-mono">{connection.secret_mask}</dd></div></dl><div className="flex flex-wrap gap-2">{!connection.is_default ? <Button type="button" size="small" variant="secondary" disabled={pending} onClick={() => void makeDefault(connection.id)}>设为默认</Button> : null}<Button type="button" size="small" variant="ghost" disabled={pending} onClick={() => setRotateId(rotateId === connection.id ? null : connection.id)}>更换密钥</Button></div>{rotateId === connection.id ? <form className="grid gap-3 border-t pt-4" onSubmit={(event) => void rotate(event, connection.id)}><Field><Label htmlFor={`rotate-${connection.id}`}>新的 API Key</Label><Input id={`rotate-${connection.id}`} name="apiKey" type="password" autoComplete="new-password" required /></Field><Button type="submit" size="small" disabled={pending}>加密保存</Button></form> : null}</article>)}</div> : <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">尚未连接模型。添加后，分析流程即可提交 AI 候选分析。</p>}
      </section>

      <form className="grid gap-5 rounded-xl border bg-surface p-5 md:p-7" onSubmit={create}>
        <header><h2 className="text-xl font-semibold">添加我的 AI 接口</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">模型和费用由你选择，本站继续负责知识检索、规则注入与结构校验。</p></header>
        <div className="grid gap-5 sm:grid-cols-2"><Field><Label htmlFor="ai-label">接口名称</Label><Input id="ai-label" name="label" minLength={2} maxLength={60} required placeholder="例如：我的 DeepSeek" /></Field><Field><Label htmlFor="ai-provider">API 服务商</Label><select id="ai-provider" className="h-11 rounded-lg border border-input bg-surface px-3 text-sm" value={provider} onChange={(event) => setProvider(event.target.value as keyof typeof providers)}>{Object.entries(providers).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select></Field><Field className="sm:col-span-2"><Label htmlFor="ai-base-url">API 地址</Label><Input id="ai-base-url" key={`${provider}-url`} name="baseUrl" type="url" required defaultValue={selected.baseUrl} /></Field><Field><Label htmlFor="ai-model">模型名称</Label><Input id="ai-model" key={`${provider}-model`} name="modelName" required defaultValue={selected.model} placeholder="服务商提供的模型名称" /></Field><Field><Label htmlFor="ai-key">API Key</Label><Input id="ai-key" name="apiKey" type="password" autoComplete="new-password" required placeholder="只在保存时发送" /></Field><Field><Label htmlFor="ai-output">最大输出长度</Label><Input id="ai-output" name="maxOutputTokens" type="number" min={1} max={262144} defaultValue={4096} /></Field><Field><Label htmlFor="ai-temperature">温度参数</Label><Input id="ai-temperature" name="temperature" type="number" min={0} max={2} step={0.05} defaultValue={0.2} /></Field></div>
        {error ? <FieldMessage role="alert">{error}</FieldMessage> : null}
        <Button className="w-fit" type="submit" disabled={pending}>{pending ? "正在加密保存" : "保存并加密"}</Button>
      </form>
    </div>
  );
}
