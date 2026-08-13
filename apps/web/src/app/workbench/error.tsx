"use client";

import { Button } from "@wavekb/ui";

export default function WorkbenchError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="mx-auto grid max-w-3xl gap-4 px-4 py-16 md:px-6"><h1 className="text-2xl font-semibold">私人工作台暂时无法读取</h1><p className="text-sm leading-6 text-muted-foreground">没有显示空数据，以免误以为记录丢失。请检查连接后重试。</p><Button className="w-fit" onClick={reset}>重新读取</Button></main>;
}
