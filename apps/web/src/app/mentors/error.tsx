"use client";

import { Button } from "@wavekb/ui";

export default function MentorsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="mx-auto grid max-w-3xl gap-4 px-4 py-16 md:px-6"><h1 className="text-2xl font-semibold">导师专区暂时无法读取</h1><p className="text-sm text-muted-foreground">没有显示空目录，以免把连接失败误认为没有导师。请稍后重试。</p><Button className="w-fit" onClick={reset}>重新读取</Button></main>;
}
