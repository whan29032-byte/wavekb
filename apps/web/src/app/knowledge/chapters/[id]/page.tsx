import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { notFound } from "next/navigation";
import { getKnowledgePage, knowledgeData } from "@wavekb/knowledge";

type PageProps = { params: Promise<{ id: string }> };

const chapterTitles: Record<string, string> = { "front-matter": "前置内容", "chapter-01": "第一章", "chapter-02": "第二章", "chapter-03": "第三章", "chapter-04": "第四章", "chapter-05": "第五章", "chapter-06": "第六章", "chapter-07": "第七章", "chapter-08": "第八章", appendix: "附录", glossary: "词汇表", "publisher-postscript": "原出版者后记" };

export const dynamicParams = false;

export function generateStaticParams() {
  return knowledgeData().chapters.map((chapter) => ({ id: chapter.id }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const id = (await params).id;
  return chapterTitles[id] ? { title: `${chapterTitles[id]} · 按原书阅读`, description: "按原书顺序列出同一批 canonical Units。" } : {};
}

export default async function KnowledgeChapterPage({ params }: PageProps) {
  const id = (await params).id;
  const chapter = knowledgeData().chapters.find((item) => item.id === id);
  if (!chapter) notFound();

  return (
    <main className="mx-auto grid max-w-4xl gap-8 px-4 py-10 md:px-6 md:py-14">
      <Link href="/knowledge#chapter-routes" className="inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground hover:text-primary"><ArrowLeft aria-hidden size={17} />返回原书目录</Link>
      <header className="grid gap-3 border-b pb-7"><span className="text-sm font-medium text-primary">原书顺序视图</span><h1 className="text-3xl font-semibold tracking-[-0.035em] md:text-5xl">{chapterTitles[id] || id}</h1><p className="text-sm leading-6 text-muted-foreground">本页只维护顺序与 Unit 引用；正文、类型、来源和图片均由同一 Unit 数据生成。</p></header>
      <ol className="grid gap-3">
        {chapter.unit_ids.map((unitId, index) => {
          const page = getKnowledgePage(`unit-${unitId}`);
          return page ? <li key={unitId}><Link href={`/knowledge/${page.id}`} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 rounded-xl border bg-surface p-4 hover:border-primary/45"><span className="text-xs font-semibold text-muted-foreground">{String(index + 1).padStart(2, "0")}</span><span><strong className="block text-sm leading-5">{page.title}</strong><span className="mt-1 block text-xs text-muted-foreground">{page.unit_types.join("、")} · {page.source_authorities.map((authority) => authority === "primary" ? "第10版" : "第11版补充").join(" / ")}</span></span><ArrowRight aria-hidden size={16} /></Link></li> : null;
        })}
      </ol>
    </main>
  );
}
