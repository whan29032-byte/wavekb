"use client";

import { Button } from "@wavekb/ui";

export default function RewardsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="mx-auto grid max-w-3xl gap-4 px-4 py-16 md:px-6"><h1 className="text-2xl font-semibold">积分服务暂时不可用</h1><p className="text-sm leading-6 text-muted-foreground">余额、库存和兑换状态没有在页面端猜测或改写。请稍后重新读取服务器记录。</p><Button type="button" className="w-fit" onClick={reset}>重新加载</Button></main>;
}
