"use client";

import { Button } from "@wavekb/ui";

export default function MemberProfileError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto grid max-w-3xl justify-items-start gap-4 px-4 py-20 md:px-6">
      <h1 className="text-2xl font-semibold">用户主页暂时无法读取</h1>
      <p className="text-sm text-muted-foreground">资料或社交状态读取失败。可以安全重试，不会发送关注或好友请求。</p>
      <Button onClick={reset}>重新加载</Button>
    </main>
  );
}
