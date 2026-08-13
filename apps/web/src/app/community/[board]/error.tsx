"use client";

import { Button } from "@wavekb/ui";

export default function BoardError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto grid max-w-3xl justify-items-start gap-4 px-4 py-20 md:px-6">
      <h1 className="text-2xl font-semibold">板块暂时无法读取</h1>
      <p className="text-sm text-muted-foreground">网络或数据服务出现了短暂异常。你可以重试，未发布的草稿不会受影响。</p>
      <Button onClick={reset}>重新加载</Button>
    </main>
  );
}
