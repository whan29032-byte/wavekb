"use client";

import { Button } from "@wavekb/ui";

export default function AdminError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="grid gap-4 p-6 lg:p-8"><h1 className="text-2xl font-semibold">后台数据暂时不可用</h1><p className="max-w-[65ch] text-sm leading-6 text-muted-foreground">页面没有用空数组掩盖读取失败。请确认管理网关在线、数据库迁移完整且当前账号仍有管理员权限。</p><Button type="button" className="w-fit" onClick={reset}>重新读取</Button></main>;
}
