import Link from "next/link";
import { ArrowRight, ArrowUpRight, BookOpenText, ChatsCircle, DiscordLogo, XLogo } from "@phosphor-icons/react/dist/ssr";
import { BOARD_SLUGS, BOARDS } from "@wavekb/domain";
import { Button } from "@wavekb/ui";
import { DirectoryAvatar } from "@/components/directory-avatar";
import { listPublicDirectory, type DirectoryResource } from "@/lib/directory/server-repository";

function DirectoryGroup({ platform, resources }: { platform: "x" | "discord"; resources: DirectoryResource[] }) {
  const isX = platform === "x";
  return (
    <section className="grid gap-4" aria-labelledby={`directory-${platform}`}>
      <header className="flex items-start gap-3 border-b pb-3">
        <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-muted text-primary">{isX ? <XLogo aria-hidden size={18} /> : <DiscordLogo aria-hidden size={20} weight="fill" />}</span>
        <div>
          <h3 id={`directory-${platform}`} className="text-lg font-semibold">{isX ? "X 波浪理论博主推荐" : "Discord 波浪理论频道推荐"}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{isX ? "关注公开的波浪分析、研究观点与市场图表。" : "进入波浪理论学习、讨论与复盘社区。"}</p>
        </div>
      </header>
      {resources.length ? (
        <div className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2">
          {resources.map((resource) => (
            <a key={resource.id} href={resource.url} target="_blank" rel="noopener noreferrer" className="group grid grid-cols-[auto_1fr_auto] items-center gap-3 bg-surface p-4 transition-colors hover:bg-muted focus-visible:z-10">
              <DirectoryAvatar src={resource.avatar_url} fallback={isX ? "X" : "D"} name={resource.name} />
              <span className="min-w-0">
                <strong className="block truncate text-sm font-semibold">{resource.name}</strong>
                <span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">{resource.description || (isX ? "X 波浪理论研究者" : "Discord 波浪理论社区")}</span>
              </span>
              <ArrowUpRight aria-hidden size={17} className="text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" />
            </a>
          ))}
        </div>
      ) : <p className="rounded-xl border border-dashed bg-surface px-4 py-5 text-sm text-muted-foreground">这一分区暂时没有已上架推荐。</p>}
    </section>
  );
}

export default async function HomePage() {
  const directory = await listPublicDirectory();
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
      <section className="border-t bg-surface/40" aria-labelledby="external-directory-title">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 md:px-6 md:py-16">
          <header className="max-w-2xl">
            <p className="text-xs font-semibold tracking-[.14em] text-primary">外部观察</p>
            <h2 id="external-directory-title" className="mt-2 text-2xl font-semibold tracking-[-.025em] md:text-3xl">波浪理论研究推荐</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">由后台现有推荐数据实时维护，仅作为外部研究入口，不代表本站背书。</p>
          </header>
          <div className="grid gap-8 lg:grid-cols-2">
            <DirectoryGroup platform="x" resources={directory.filter((item) => item.platform === "x")} />
            <DirectoryGroup platform="discord" resources={directory.filter((item) => item.platform === "discord")} />
          </div>
        </div>
      </section>
    </main>
  );
}
