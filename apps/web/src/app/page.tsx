import Link from "next/link";
import { ArrowRight, BookOpenText, ChatsCircle } from "@phosphor-icons/react/dist/ssr";
import { BOARD_SLUGS, BOARDS } from "@wavekb/domain";
import { Button } from "@wavekb/ui";

export default function HomePage() {
  return (
    <main>
      <section className="mx-auto grid min-h-[calc(100dvh-4rem)] max-w-7xl content-center gap-10 px-4 py-16 md:grid-cols-[minmax(0,1.2fr)_minmax(20rem,.8fr)] md:px-6 md:py-20">
        <div className="grid content-center gap-7">
          <div className="grid gap-4">
            <h1 className="max-w-[14ch] text-4xl font-semibold leading-[1.06] tracking-[-0.045em] md:text-6xl">
              把波浪判断写清楚，也留下证据。
            </h1>
            <p className="max-w-[58ch] text-base leading-7 text-muted-foreground md:text-lg">
              查规则、做分析、发观点。知识库与社区使用同一套研究上下文。
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="large"><Link href="/knowledge">打开知识库</Link></Button>
            <Button asChild size="large" variant="secondary"><Link href="/community/idea_sharing">进入社区</Link></Button>
          </div>
        </div>
        <aside className="grid content-center gap-3" aria-label="社区板块">
          {BOARD_SLUGS.map((slug, index) => (
            <Link key={slug} href={`/community/${slug}`} className="group grid grid-cols-[auto_1fr_auto] items-center gap-4 rounded-xl border bg-surface p-4 transition-colors hover:border-primary/50 md:p-5">
              <span className="grid size-10 place-items-center rounded-lg bg-muted text-primary">
                {index % 2 ? <ChatsCircle aria-hidden size={21} weight="duotone" /> : <BookOpenText aria-hidden size={21} weight="duotone" />}
              </span>
              <span className="min-w-0">
                <strong className="block text-sm font-semibold">{BOARDS[slug].title}</strong>
                <span className="mt-1 block truncate text-xs text-muted-foreground">{BOARDS[slug].description}</span>
              </span>
              <ArrowRight aria-hidden size={18} className="text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
            </Link>
          ))}
        </aside>
      </section>
    </main>
  );
}
