import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpenText, CheckCircle } from "@phosphor-icons/react/dist/ssr";
import { childrenOf, knowledgeData } from "@wavekb/knowledge";
import { KnowledgeExplorer } from "@/components/knowledge-explorer";

export const metadata: Metadata = {
  title: "知识库",
  description: "浏览已核验的艾略特波浪理论规则、指南、识别步骤与原书来源。",
};

export default function KnowledgePage() {
  const data = knowledgeData();
  const coreCount = data.pages.filter((page) => page.kind === "core").length;
  const listItems = data.pages.map(({ id, title, kind, parent, sections }) => ({
    id,
    title,
    kind,
    parent,
    searchText: sections.flatMap((section) => [...section.paragraphs, ...section.items]).join(" "),
  }));

  return (
    <main className="mx-auto grid max-w-6xl gap-12 px-4 py-10 md:px-6 md:py-16">
      <header className="grid gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div className="grid gap-3">
          <div className="flex items-center gap-2 text-sm font-medium text-primary"><BookOpenText aria-hidden size={20} weight="duotone" />艾略特波浪理论</div>
          <h1 className="max-w-[16ch] text-4xl font-semibold leading-tight tracking-[-0.04em] md:text-5xl">规则、指南与原书证据放在一起。</h1>
          <p className="max-w-[65ch] text-sm leading-6 text-muted-foreground md:text-base">共 {data.pages.length} 个条目。每页保留适用范围、强制规则、检查步骤、失效条件、常见错误和来源。</p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border bg-surface px-4 py-3 text-sm text-muted-foreground"><CheckCircle aria-hidden size={20} weight="duotone" className="text-primary" />{coreCount} 个核心条目</div>
      </header>

      <section className="grid gap-4 md:grid-cols-2" aria-label="知识库分区">
        {data.roots.map((root) => {
          const children = childrenOf(root.id);
          const first = children[0];
          return (
            <article key={root.id} className="grid gap-5 rounded-xl border bg-surface p-5 md:p-7">
              <div className="grid gap-2">
                <h2 className="text-2xl font-semibold tracking-tight">{root.title}</h2>
                <p className="text-sm leading-6 text-muted-foreground">{root.kind === "core" ? "以第 10 版原书为核心，区分硬规则、指南和历史观察。" : "保留来源状态，用于训练、复盘和交叉核验。"}</p>
              </div>
              <div className="grid gap-2">
                {children.slice(0, 5).map((page) => <Link key={page.id} href={`/knowledge/${page.id}`} className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2.5 text-sm font-medium hover:text-primary"><span>{page.title}</span><ArrowRight aria-hidden size={16} /></Link>)}
              </div>
              {first ? <Link href={`/knowledge/${first.id}`} className="w-fit text-sm font-semibold text-primary hover:underline">从本分区开始</Link> : null}
            </article>
          );
        })}
      </section>

      <KnowledgeExplorer items={listItems} />
    </main>
  );
}
