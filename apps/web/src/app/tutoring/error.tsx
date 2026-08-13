"use client";

import { Button } from "@wavekb/ui";

export default function TutoringError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="mx-auto grid max-w-3xl gap-4 px-4 py-16 md:px-6"><h1 className="text-2xl font-semibold">辅导数据暂时无法读取</h1><p className="text-sm text-muted-foreground">没有显示空状态，以免把连接失败误认为权益消失。请稍后重试。</p><Button className="w-fit" onClick={reset}>重新读取</Button></main>;
}
