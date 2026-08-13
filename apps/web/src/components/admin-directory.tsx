"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DiscordLogo, FloppyDisk, Plus, Trash, XLogo } from "@phosphor-icons/react";
import { Button, Field, FieldMessage, Input, Label } from "@wavekb/ui";
import type { AdminDirectoryResource } from "@/lib/admin/server-repository";

type DirectoryInput = { platform: "x" | "discord"; name: string; description: string; url: string; avatar_url?: string; sort_order: number; active: boolean };
const controlClass = "h-11 w-full rounded-lg border border-input bg-surface px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20";

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/invalid_resource_url|invalid_platform/i.test(message)) return "只接受有效的 X 个人主页或 Discord 邀请链接。";
  if (/invalid_sort_order/i.test(message)) return "首页顺序应为 0 至 100000 的整数。";
  if (/invalid_resource_name/i.test(message)) return "系统无法识别名称，请手动填写显示名称。";
  if (/resource_not_found/i.test(message)) return "这条推荐已不存在，请刷新页面。";
  if (/admin_required|permission|jwt/i.test(message)) return "当前登录状态没有管理员权限。";
  return message || "首页推荐操作没有完成。";
}

function ResourceEditor({ resource, pending, onSave, onDelete }: { resource: AdminDirectoryResource; pending: boolean; onSave: (value: DirectoryInput) => Promise<boolean>; onDelete: () => Promise<boolean> }) {
  const [name, setName] = useState(resource.name);
  const [description, setDescription] = useState(resource.description || "");
  const [url, setUrl] = useState(resource.url);
  const [avatarUrl, setAvatarUrl] = useState(resource.avatar_url || "");
  const [sortOrder, setSortOrder] = useState(String(resource.sort_order));
  const [active, setActive] = useState(resource.active);
  const [error, setError] = useState("");

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const order = Number(sortOrder);
    if (!name.trim() || name.trim().length > 120) return setError("显示名称应为 1 至 120 个字符。");
    if (!Number.isInteger(order) || order < 0 || order > 100000) return setError("首页顺序应为 0 至 100000 的整数。");
    try { if (new URL(url).protocol !== "https:") throw new Error(); } catch { return setError("跳转链接必须是有效的 HTTPS 地址。"); }
    if (avatarUrl) { try { if (new URL(avatarUrl).protocol !== "https:") throw new Error(); } catch { return setError("头像链接必须是有效的 HTTPS 地址。"); } }
    setError("");
    await onSave({ platform: resource.platform, name: name.trim(), description: description.trim(), url: url.trim(), avatar_url: avatarUrl.trim(), sort_order: order, active });
  }

  return <article className="overflow-hidden rounded-xl border bg-surface"><header className="flex items-center gap-3 border-b p-4"><span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-primary">{resource.platform === "x" ? <XLogo aria-hidden size={20} /> : <DiscordLogo aria-hidden size={20} />}</span><span className="min-w-0"><strong className="block truncate">{resource.name}</strong><span className="text-xs text-muted-foreground">{resource.active ? "官网展示中" : "已下架"} · {resource.platform === "x" ? "X 博主" : "Discord 社区"}</span></span></header><form className="grid gap-4 p-4" onSubmit={save}><div className="grid gap-3 sm:grid-cols-2"><Field><Label>显示名称</Label><Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required /></Field><Field><Label>一句话介绍</Label><Input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={300} /></Field></div><Field><Label>跳转链接</Label><Input type="url" value={url} onChange={(event) => setUrl(event.target.value)} maxLength={2048} required /></Field><div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto]"><Field><Label>头像链接</Label><Input type="url" value={avatarUrl} onChange={(event) => setAvatarUrl(event.target.value)} maxLength={2048} /></Field><Field><Label>首页顺序</Label><Input type="number" min={0} max={100000} step={1} value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} /></Field><label className="flex min-h-11 items-center gap-2 self-end rounded-lg border bg-background px-3 text-sm font-medium"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />官网展示</label></div>{error ? <FieldMessage role="alert">{error}</FieldMessage> : null}<footer className="flex flex-wrap justify-between gap-3 border-t pt-4"><Button type="button" variant="danger" disabled={pending} onClick={() => { if (window.confirm(`确认永久删除“${resource.name}”？若只想暂时隐藏，请关闭官网展示。`)) void onDelete(); }}><Trash aria-hidden size={17} />删除</Button><Button type="submit" disabled={pending}><FloppyDisk aria-hidden size={17} />保存修改</Button></footer></form></article>;
}

export function AdminDirectory({ initialResources }: { initialResources: AdminDirectoryResource[] }) {
  const router = useRouter();
  const [resources, setResources] = useState(initialResources);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [platform, setPlatform] = useState<"x" | "discord">("x");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sortOrder, setSortOrder] = useState(String((resources.length + 1) * 10));

  async function refresh() {
    const response = await fetch("/api/admin/directory", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(payload.error || "administration_failed"));
    setResources(Array.isArray(payload.resources) ? payload.resources : []);
  }

  async function mutate(key: string, path: string, body: object, success: string) {
    setPending(key); setError(""); setStatus("");
    try {
      const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload.error || "administration_failed"));
      await refresh();
      setStatus(success);
      router.refresh();
      return true;
    } catch (mutationError) {
      setError(friendlyError(mutationError));
      return false;
    } finally {
      setPending("");
    }
  }

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const order = Number(sortOrder);
    if (!Number.isInteger(order) || order < 0 || order > 100000) return setError("首页顺序应为 0 至 100000 的整数。");
    try { if (new URL(url).protocol !== "https:") throw new Error(); } catch { return setError("请填写有效的 HTTPS 链接。"); }
    const saved = await mutate("create", "/api/admin/directory", { platform, url: url.trim(), name: name.trim(), description: description.trim(), sort_order: order, active: true }, "首页推荐已添加，头像与规范链接由网关校验。" );
    if (saved) { setUrl(""); setName(""); setDescription(""); setSortOrder(String((resources.length + 2) * 10)); }
  }

  return <div className="grid gap-8"><div aria-live="polite" className="min-h-6">{error ? <FieldMessage role="alert">{error}</FieldMessage> : status ? <p className="text-sm font-medium text-primary">{status}</p> : null}</div><section className="grid gap-4" aria-labelledby="directory-create-title"><header><span className="flex items-center gap-2 text-xs font-semibold text-primary"><Plus aria-hidden size={17} />新增推荐</span><h2 id="directory-create-title" className="mt-1 text-xl font-semibold">从公开主页识别名称与头像</h2><p className="mt-1 text-sm text-muted-foreground">仅接受 X 个人主页与 Discord 邀请。网关会规范链接并尝试读取公开元数据。</p></header><form className="grid gap-3 rounded-xl border bg-surface p-4 md:grid-cols-[10rem_minmax(0,1fr)_minmax(10rem,.55fr)_8rem_auto] md:items-end" onSubmit={create}><Field><Label>类型</Label><select className={controlClass} value={platform} onChange={(event) => setPlatform(event.target.value as "x" | "discord")}><option value="x">X 博主</option><option value="discord">Discord 社区</option></select></Field><Field><Label>公开链接</Label><Input type="url" value={url} onChange={(event) => setUrl(event.target.value)} maxLength={2048} required placeholder="https://x.com/..." /></Field><Field><Label>显示名称</Label><Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="可自动识别" /></Field><Field><Label>首页顺序</Label><Input type="number" min={0} max={100000} step={1} value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} /></Field><Button type="submit" disabled={pending === "create"}><Plus aria-hidden size={17} />添加</Button><Field className="md:col-span-full"><Label>一句话介绍</Label><Input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={300} placeholder="可选，Discord 会尝试自动识别" /></Field></form></section><section className="grid gap-4" aria-labelledby="directory-list-title"><header className="flex items-end justify-between gap-4"><div><span className="text-xs font-semibold text-primary">首页目录</span><h2 id="directory-list-title" className="mt-1 text-xl font-semibold">链接、展示顺序与上下架</h2></div><span className="text-xs text-muted-foreground">{resources.filter((item) => item.active).length} 个展示中</span></header><div className="grid gap-4 lg:grid-cols-2">{resources.length ? resources.map((resource) => <ResourceEditor key={`${resource.id}:${resource.updated_at}`} resource={resource} pending={pending === resource.id} onSave={(value) => mutate(resource.id, `/api/admin/directory/${resource.id}`, value, `“${resource.name}”已更新。`)} onDelete={() => mutate(resource.id, `/api/admin/directory/${resource.id}/delete`, {}, `“${resource.name}”已删除。`)} />) : <p className="rounded-xl border border-dashed bg-surface p-6 text-sm text-muted-foreground lg:col-span-2">还没有首页推荐。</p>}</div></section></div>;
}
