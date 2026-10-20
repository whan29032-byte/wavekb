"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChartLineUp, FloppyDisk } from "@phosphor-icons/react";
import { Button, Field, FieldMessage, Input, Label } from "@wavekb/ui";
import { saveCommunityEngagementSettings } from "@/lib/admin/engagement-client-repository";
import type { CommunityEngagementSettings } from "@/lib/admin/engagement-types";
import { createClient } from "@/lib/supabase/client";

type NumberKey = Exclude<keyof CommunityEngagementSettings, "virtual_enabled" | "updated_at">;

const groups: Array<{
  title: string;
  copy: string;
  fields: Array<{ key: NumberKey; label: string; help?: string }>;
}> = [
  {
    title: "真实点赞积分",
    copy: "只有真实点赞写入积分账本；虚拟点赞不会产生任何积分。每个点赞者对同一帖子只奖励一次，并受每日上限约束。",
    fields: [
      { key: "like_points", label: "每个点赞奖励积分", help: "0 表示不奖励积分，最大 100。" },
      { key: "like_daily_cap", label: "作者每日最多获得点赞积分次数", help: "超过上限后仍会显示点赞，但不再加积分。" },
    ],
  },
  {
    title: "活跃权重",
    copy: "作者权重 = 已发布帖子×3 + 可见评论 + 收到的真实点赞 + 近 30 天签到 + 账号月龄。达到阈值即视为活跃用户。",
    fields: [
      { key: "active_weight_threshold", label: "活跃阈值", help: "例如 20：持续发帖和互动的作者会进入活跃档。" },
    ],
  },
  {
    title: "不活跃用户展示加成",
    copy: "用于展示的虚拟浏览和点赞范围。数值是每个帖子稳定生成一次的区间，不会随时间无限增长。",
    fields: [
      { key: "inactive_view_min", label: "浏览下限" },
      { key: "inactive_view_max", label: "浏览上限" },
      { key: "inactive_like_min", label: "点赞下限" },
      { key: "inactive_like_max", label: "点赞上限" },
    ],
  },
  {
    title: "活跃用户展示加成",
    copy: "活跃作者获得更高的展示区间，但仍只影响前台数字，不影响真实点赞、积分或账本。",
    fields: [
      { key: "active_view_min", label: "浏览下限" },
      { key: "active_view_max", label: "浏览上限" },
      { key: "active_like_min", label: "点赞下限" },
      { key: "active_like_max", label: "点赞上限" },
    ],
  },
];

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/admin_required|permission|jwt/i.test(message)) return "当前账号没有互动设置权限。";
  if (/engagement_settings_invalid/i.test(message)) return "设置值不合法：请检查上下限、积分和每日上限。";
  return message || "互动设置没有保存。";
}

export function AdminEngagementSettings({ actorId, initialSettings }: { actorId: string; initialSettings: CommunityEngagementSettings }) {
  const router = useRouter();
  const [settings, setSettings] = useState(initialSettings);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  function update(key: NumberKey, value: string) {
    const parsed = Number(value);
    setSettings((current) => ({ ...current, [key]: Number.isFinite(parsed) ? parsed : 0 }));
    setStatus("");
  }

  function validate() {
    if (!Number.isInteger(settings.like_points) || settings.like_points < 0 || settings.like_points > 100) return "每个点赞奖励积分必须是 0 至 100 的整数。";
    if (!Number.isInteger(settings.like_daily_cap) || settings.like_daily_cap < 1 || settings.like_daily_cap > 10000) return "每日点赞积分上限必须是 1 至 10000 的整数。";
    if (!Number.isInteger(settings.active_weight_threshold) || settings.active_weight_threshold < 0) return "活跃阈值必须是大于或等于 0 的整数。";
    for (const group of groups.slice(2)) {
      const minKey = group.fields[0]!.key;
      const maxKey = group.fields[1]!.key;
      const likeMinKey = group.fields[2]!.key;
      const likeMaxKey = group.fields[3]!.key;
      if (![minKey, maxKey, likeMinKey, likeMaxKey].every((key) => Number.isInteger(settings[key]) && settings[key] >= 0)) return `${group.title}必须是非负整数。`;
      if (settings[maxKey] < settings[minKey]) return `${group.title}的浏览上限不能小于下限。`;
      if (settings[likeMaxKey] < settings[likeMinKey]) return `${group.title}的点赞上限不能小于下限。`;
      if (Math.max(settings[maxKey], settings[likeMaxKey]) > 1_000_000) return `${group.title}的展示值不能超过 1,000,000。`;
    }
    return "";
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validate();
    if (validation) return setError(validation);
    setPending(true);
    setError("");
    setStatus("");
    try {
      const client = createClient();
      const auth = await client.auth.getUser();
      if (!auth.data.user || auth.data.user.id !== actorId) throw new Error("authentication_required");
      const saved = await saveCommunityEngagementSettings(client, settings);
      setSettings(saved);
      setStatus("互动展示设置已保存。");
      router.refresh();
    } catch (saveError) {
      setError(friendlyError(saveError));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="grid gap-6" onSubmit={submit}>
      <section className="grid gap-4 rounded-xl border bg-surface p-4 md:p-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-primary"><ChartLineUp aria-hidden size={17} />社区互动展示</span>
            <h2 className="mt-1 text-xl font-semibold">虚拟浏览与点赞加成</h2>
            <p className="mt-1 max-w-[72ch] text-sm leading-6 text-muted-foreground">加成只改变前台展示数字，不写入点赞表、不触发积分、不影响账本。关闭后所有帖子只显示真实计数。</p>
          </div>
          <label className="flex min-h-11 items-center gap-2 rounded-lg border bg-background px-3 text-sm font-medium">
            <input type="checkbox" checked={settings.virtual_enabled} onChange={(event) => { setSettings((current) => ({ ...current, virtual_enabled: event.target.checked })); setStatus(""); }} />
            启用展示加成
          </label>
        </header>
        <div className="grid gap-3 rounded-lg bg-muted/50 p-4 text-sm sm:grid-cols-2">
          <p><strong>不活跃作者：</strong>{settings.inactive_view_min}–{settings.inactive_view_max} 浏览，{settings.inactive_like_min}–{settings.inactive_like_max} 赞</p>
          <p><strong>活跃作者：</strong>{settings.active_view_min}–{settings.active_view_max} 浏览，{settings.active_like_min}–{settings.active_like_max} 赞</p>
        </div>
      </section>

      {groups.map((group) => (
        <section key={group.title} className="grid gap-4 rounded-xl border bg-surface p-4 md:p-5">
          <header>
            <h2 className="text-lg font-semibold">{group.title}</h2>
            <p className="mt-1 max-w-[76ch] text-sm leading-6 text-muted-foreground">{group.copy}</p>
          </header>
          <div className={`grid gap-3 ${group.fields.length >= 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2"}`}>
            {group.fields.map((field) => (
              <Field key={field.key}>
                <Label htmlFor={`engagement-${field.key}`}>{field.label}</Label>
                <Input id={`engagement-${field.key}`} type="number" min={0} step={1} value={String(settings[field.key])} onChange={(event) => update(field.key, event.target.value)} />
                {field.help ? <span className="text-xs text-muted-foreground">{field.help}</span> : null}
              </Field>
            ))}
          </div>
        </section>
      ))}

      {error ? <FieldMessage role="alert">{error}</FieldMessage> : null}
      {status ? <p role="status" className="text-sm font-medium text-primary">{status}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <span className="text-xs text-muted-foreground">最近更新：{new Date(settings.updated_at).toLocaleString("zh-CN")}</span>
        <Button type="submit" disabled={pending}><FloppyDisk aria-hidden size={17} />{pending ? "正在保存" : "保存互动设置"}</Button>
      </div>
    </form>
  );
}
