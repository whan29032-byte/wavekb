"use client";

import { Button } from "@wavekb/ui";

export default function EditMemberProfileError({ reset }: { error: Error; reset: () => void }) {
  return <main className="mx-auto grid max-w-3xl justify-items-start gap-4 px-4 py-20 md:px-6"><h1 className="text-2xl font-semibold">个人资料暂时无法读取</h1><p className="text-sm text-muted-foreground">没有上传或修改任何资料，可以安全重试。</p><Button onClick={reset}>重新加载</Button></main>;
}
