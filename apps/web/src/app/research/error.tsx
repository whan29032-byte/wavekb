"use client";
import Link from "next/link";
import { Button } from "@wavekb/ui";

export default function ResearchError({ reset }: { reset: () => void }) {
  return <main className="mx-auto max-w-3xl px-4 py-12"><h1 className="text-2xl font-semibold">研报暂时无法读取</h1><p role="alert" className="my-4 text-sm leading-7 text-muted-foreground">数据源可能限流或暂时不可用；若持续出现，请管理员检查服务器的 TLINE_API_KEY 配置与接口权限。网站其他功能不受影响。</p><div className="flex flex-wrap gap-3"><Button onClick={reset}>重新加载</Button><Button asChild variant="secondary"><Link href="/research">返回最近研报</Link></Button></div></main>;
}
