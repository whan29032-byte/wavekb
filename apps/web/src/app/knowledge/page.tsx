import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpenText, CheckCircle } from "@phosphor-icons/react/dist/ssr";
import { childrenOf, knowledgeData, type KnowledgeTheme } from "@wavekb/knowledge";
import { KnowledgeExplorer } from "@/components/knowledge-explorer";

export const metadata: Metadata = {
  title: "知识库",
  description: "浏览已核验的艾略特波浪理论规则、指南、识别步骤与原书来源。",
};

function unitsInTheme(theme: KnowledgeTheme): string[] {
  return [...theme.unit_ids, ...theme.children.flatMap(unitsInTheme)];
}

export default function KnowledgePage() {
  const data = knowledgeData();
  const coreCount = data.pages.filter((page) => page.kind === "core").length;
  const listItems = data.pages.map(({ id, title, kind, parent, sections, search_terms, source_refs }) => ({
    id,
    title,
    kind,
    parent,
    searchText: [
      ...sections.flatMap((section) => [...section.paragraphs, ...section.items]),
      ...search_terms,
      ...source_refs.flatMap((source) => [source.chapter, source.section, source.source_id, ...source.figures]),
    ].join(" "),
  }));
  const chapterTitles: Record<string, string> = { "front-matter": "前置内容", "chapter-01": "第一章", "chapter-02": "第二章", "chapter-03": "第三章", "chapter-04": "第四章", "chapter-05": "第五章", "chapter-06": "第六章", "chapter-07": "第七章", "chapter-08": "第八章", appendix: "附录", glossary: "词汇表", "publisher-postscript": "原出版者后记" };

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

      <section className="grid gap-4 md:grid-cols-3" aria-label="知识库入口">
        <a href="#theme-routes" className="grid gap-2 rounded-xl border bg-surface p-5 hover:border-primary/45"><strong className="text-lg">按主题系统学习</strong><span className="text-sm leading-6 text-muted-foreground">从八大主题进入，先规则、再指南与证据。</span></a>
        <a href="#question-routes" className="grid gap-2 rounded-xl border bg-surface p-5 hover:border-primary/45"><strong className="text-lg">按问题查答案</strong><span className="text-sm leading-6 text-muted-foreground">18 条 Reasoning Routes 直接解析到同一批 Units。</span></a>
        <a href="#chapter-routes" className="grid gap-2 rounded-xl border bg-surface p-5 hover:border-primary/45"><strong className="text-lg">按原书阅读</strong><span className="text-sm leading-6 text-muted-foreground">保留前置、八章、附录、词汇表与后记顺序。</span></a>
      </section>

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

      <section id="theme-routes" className="grid scroll-mt-24 gap-4" aria-labelledby="theme-routes-title">
        <div className="grid gap-2"><h2 id="theme-routes-title" className="text-2xl font-semibold tracking-tight">按八大主题系统学习</h2><p className="text-sm leading-6 text-muted-foreground">主题只组织 Unit 引用，不复制正文。</p></div>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
          {data.themes.map((theme) => {
            const unitIds = unitsInTheme(theme);
            return unitIds[0] ? <Link key={theme.id} href={`/knowledge/unit-${unitIds[0]}`} className="grid gap-2 rounded-xl border bg-surface p-4 hover:border-primary/45"><strong className="text-sm leading-5">{theme.title}</strong><span className="text-xs text-muted-foreground">{unitIds.length} 个 Units</span></Link> : null;
          })}
        </div>
      </section>

      <section id="question-routes" className="grid scroll-mt-24 gap-4" aria-labelledby="question-routes-title">
        <div className="grid gap-2"><h2 id="question-routes-title" className="text-2xl font-semibold tracking-tight">按问题查答案</h2><p className="text-sm leading-6 text-muted-foreground">每条路线先打开 required Units；页面正文仍来自同一 Unit 数据。</p></div>
        <div className="grid gap-3 md:grid-cols-2">
          {data.questions.map((question) => <Link key={question.id} href={`/knowledge/questions/${question.id}`} className="grid gap-2 rounded-xl border bg-surface p-4 hover:border-primary/45"><strong className="text-sm leading-6">{question.question}</strong><span className="text-xs text-muted-foreground">4 阶段 · {question.required_unit_ids.length} 个必读 · {question.optional_unit_ids.length} 个辅助</span></Link>)}
        </div>
      </section>

      <section id="chapter-routes" className="grid scroll-mt-24 gap-4" aria-labelledby="chapter-routes-title">
        <div className="grid gap-2"><h2 id="chapter-routes-title" className="text-2xl font-semibold tracking-tight">按原书阅读</h2><p className="text-sm leading-6 text-muted-foreground">Chapter 只提供顺序和 Unit 引用，不另维护正文。</p></div>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          {data.chapters.map((chapter) => chapter.unit_ids[0] ? <Link key={chapter.id} href={`/knowledge/chapters/${chapter.id}`} className="flex items-center justify-between gap-3 rounded-xl border bg-surface p-4 hover:border-primary/45"><span><strong className="block text-sm">{chapterTitles[chapter.id] || chapter.id}</strong><span className="text-xs text-muted-foreground">{chapter.unit_ids.length} 个 Units</span></span><ArrowRight aria-hidden size={16} /></Link> : null)}
        </div>
      </section>

      <KnowledgeExplorer items={listItems} />
    </main>
  );
}
