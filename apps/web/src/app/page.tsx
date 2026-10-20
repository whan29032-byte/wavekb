import Link from "next/link";
import { ArrowRight, ArrowUpRight, BookOpenText, ChatsCircle, DiscordLogo, XLogo } from "@phosphor-icons/react/dist/ssr";
import { BOARD_SLUGS, BOARDS } from "@wavekb/domain";
import { knowledgeData } from "@wavekb/knowledge";
import { Button, Card } from "@wavekb/ui";
import { DirectoryAvatar } from "@/components/directory-avatar";
import { getKnowledgeBookCatalog } from "@/lib/knowledge/book-catalog";
import { listPublicDirectory, type DirectoryResource } from "@/lib/directory/server-repository";

function DirectoryGroup({ platform, resources }: { platform: "x" | "discord"; resources: DirectoryResource[] }) {
  const isX = platform === "x";
  return (
    <section className="grid self-start content-start gap-4" aria-labelledby={`directory-${platform}`}>
      <header className="flex items-start gap-3 border-b border-border pb-3">
        <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-[var(--radius-control)] bg-surface-subtle text-primary">{isX ? <XLogo aria-hidden size={18} /> : <DiscordLogo aria-hidden size={20} weight="fill" />}</span>
        <div>
          <h3 id={`directory-${platform}`} className="text-lg font-semibold">{isX ? "X 波浪理论研究者" : "Discord 波浪理论社区"}</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{isX ? "关注公开的波浪分析、研究观点与市场图表。" : "进入波浪理论学习、讨论与复盘社区。"}</p>
        </div>
      </header>
      {resources.length ? (
        <div className="grid gap-px overflow-hidden rounded-[var(--radius-card)] border border-border bg-border shadow-[var(--shadow-xs)] sm:grid-cols-2">
          {resources.map((resource) => (
            <a key={resource.id} href={resource.url} target="_blank" rel="noopener noreferrer" className="group grid min-h-[6.5rem] grid-cols-[auto_1fr_auto] content-center items-center gap-3 bg-surface p-4 transition-colors hover:bg-surface-subtle focus-visible:z-10">
              <DirectoryAvatar src={resource.avatar_url} fallback={isX ? "X" : "D"} name={resource.name} />
              <span className="min-w-0">
                <strong className="block truncate text-sm font-semibold">{resource.name}</strong>
                <span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">{resource.description || (isX ? "X 波浪理论研究者" : "Discord 波浪理论社区")}</span>
              </span>
              <ArrowUpRight aria-hidden size={17} className="text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" />
            </a>
          ))}
        </div>
      ) : <p className="rounded-[var(--radius-card)] border border-dashed border-border bg-surface px-4 py-5 text-sm text-muted-foreground">这一分区暂时没有已上架推荐。</p>}
    </section>
  );
}

export default async function HomePage() {
  const directory = await listPublicDirectory();
  const data = knowledgeData();
  const books = getKnowledgeBookCatalog(data);

  return (
    <main>
      <section className="relative overflow-hidden border-b border-border">
        <div aria-hidden className="hero-grid absolute inset-0" />
        <div className="relative mx-auto grid max-w-7xl gap-10 px-4 py-16 md:grid-cols-[minmax(0,1.15fr)_minmax(20rem,.85fr)] md:items-center md:gap-14 md:px-6 md:py-24">
          <div className="grid gap-8">
            <div className="grid gap-4">
              <span className="eyebrow">Wave theory research</span>
              <h1 className="text-display font-semibold leading-[1.06] tracking-[-0.05em]">
                <span className="inline-block">把波浪判断写清楚，</span>
                <br className="hidden sm:block" />
                <span className="text-primary">也留下证据。</span>
              </h1>
              <p className="max-w-[58ch] text-base leading-7 text-muted-foreground md:text-lg">
                查规则、做分析、发观点。知识库与社区使用同一套研究上下文。
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="large"><Link href="/knowledge">打开知识库<ArrowRight aria-hidden size={18} /></Link></Button>
              <Button asChild size="large" variant="secondary"><Link href="/community/idea_sharing">进入社区</Link></Button>
            </div>
            <dl className="grid max-w-xl grid-cols-3 gap-4 border-t border-border pt-6">
              <div><dt className="text-xs font-medium text-muted-foreground">知识条目</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{data.pages.length}</dd></div>
              <div><dt className="text-xs font-medium text-muted-foreground">研究板块</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{BOARD_SLUGS.length}</dd></div>
              <div><dt className="text-xs font-medium text-muted-foreground">原书来源</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{books.length}</dd></div>
            </dl>
          </div>
          <aside className="grid gap-3" aria-label="社区板块">
            {BOARD_SLUGS.map((slug, index) => (
              <Card asChild key={slug} variant="interactive" padding="sm" className="group">
                <Link href={`/community/${slug}`} className="grid grid-cols-[auto_1fr_auto] items-center gap-4">
                  <span className="grid size-10 place-items-center rounded-[var(--radius-control)] bg-primary-selected text-primary">
                    {index % 2 ? <ChatsCircle aria-hidden size={21} weight="duotone" /> : <BookOpenText aria-hidden size={21} weight="duotone" />}
                  </span>
                  <span className="min-w-0">
                    <strong className="block text-sm font-semibold">{BOARDS[slug].title}</strong>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">{BOARDS[slug].description}</span>
                  </span>
                  <ArrowRight aria-hidden size={18} className="text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                </Link>
              </Card>
            ))}
          </aside>
        </div>
      </section>
      <section className="bg-surface-subtle/40" aria-labelledby="external-directory-title">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 md:px-6 md:py-16">
          <header className="grid max-w-2xl gap-2">
            <span className="eyebrow">External research</span>
            <h2 id="external-directory-title" className="text-title font-semibold tracking-[-0.03em]">外部研究与交流社区</h2>
            <p className="text-sm leading-6 text-muted-foreground">收录公开的波浪理论研究账号与交流社群，内容仅供参考，不代表本站观点。</p>
          </header>
          <div className="grid items-start gap-8 lg:grid-cols-2">
            <DirectoryGroup platform="x" resources={directory.filter((item) => item.platform === "x")} />
            <DirectoryGroup platform="discord" resources={directory.filter((item) => item.platform === "discord")} />
          </div>
        </div>
      </section>
    </main>
  );
}
