import Link from "next/link";
import { NotePencil } from "@phosphor-icons/react/dist/ssr";
import type { BoardSlug } from "@wavekb/domain";
import { Button } from "@wavekb/ui";

export function EmptyBoard({ board, configured }: { board: BoardSlug; configured: boolean }) {
  return (
    <section className="grid justify-items-start gap-4 rounded-xl border border-dashed bg-surface p-8 md:p-12">
      <NotePencil aria-hidden size={34} weight="duotone" className="text-primary" />
      <div className="grid gap-2">
        <h2 className="text-xl font-semibold">{configured ? "这个板块还没有内容" : "新应用尚未连接 Supabase"}</h2>
        <p className="max-w-[60ch] text-sm leading-6 text-muted-foreground">
          {configured ? "你可以发布第一篇内容。旧站和新站会读取同一份数据。" : "复制 .env.example 为 .env.local 并填入当前项目的公开配置即可预览真实数据。"}
        </p>
      </div>
      {configured ? <Button asChild><Link href={`/community/${board}/new`}>发布内容</Link></Button> : null}
    </section>
  );
}
