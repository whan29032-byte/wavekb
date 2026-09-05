import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, BookOpenText, FilePdf } from "@phosphor-icons/react/dist/ssr";
import { knowledgeData } from "@wavekb/knowledge";

export const metadata: Metadata = {
  title: "扩展书架",
  description: "阅读与核心规则库分离维护的专题蒸馏文献。",
};

function assetUrl(assetPath: string) {
  const base = (process.env.NEXT_PUBLIC_KNOWLEDGE_ASSET_BASE_URL || "").replace(/\/$/, "");
  return `${base}/${assetPath.replace(/^\//, "")}`;
}

export default function KnowledgeBooksPage() {
  const library = knowledgeData().library;

  return (
    <main className="mx-auto grid max-w-6xl gap-10 px-4 py-10 md:px-6 md:py-16">
      <header className="grid gap-4 border-b pb-8 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div className="grid gap-3">
          <span className="flex items-center gap-2 text-sm font-medium text-primary"><BookOpenText aria-hidden size={20} weight="duotone" />知识库 · 扩展书架</span>
          <h1 className="max-w-[16ch] text-4xl font-semibold leading-tight tracking-[-0.04em] md:text-5xl">专题文献，和核心规则分开读。</h1>
          <p className="max-w-[68ch] text-sm leading-6 text-muted-foreground md:text-base">{library.description}</p>
        </div>
        <span className="inline-flex w-fit items-center gap-2 rounded-xl border bg-surface px-4 py-3 text-sm text-muted-foreground"><FilePdf aria-hidden size={20} className="text-primary" />{library.books.length} 本完整蒸馏</span>
      </header>

      <section className="grid gap-5" aria-label="扩展书架书目">
        {library.books.map((book) => (
          <article key={book.id} className="grid overflow-hidden rounded-2xl border bg-surface md:grid-cols-[11.5rem_minmax(0,1fr)]">
            <div className="relative min-h-56 bg-muted md:min-h-full"><Image src={assetUrl(book.cover_path)} alt={`${book.title}封面`} fill sizes="(min-width: 768px) 11.5rem, 100vw" className="object-contain" /></div>
            <div className="grid gap-5 p-5 md:p-7">
              <div className="grid gap-2"><span className="text-xs font-semibold tracking-wide text-primary">{book.eyebrow}</span><h2 className="text-2xl font-semibold tracking-tight">{book.title}</h2><p className="max-w-[72ch] text-sm leading-6 text-muted-foreground">{book.description}</p></div>
              <div className="flex flex-wrap gap-2">{book.topics.map((topic) => <span key={topic} className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">{topic}</span>)}</div>
              <div className="grid gap-1 text-xs leading-5 text-muted-foreground"><span>{book.pdf_pages} 页蒸馏 · 覆盖 {book.source_page_count.toLocaleString("zh-CN")} 页/篇来源</span><span>{book.coverage_note}</span></div>
              <Link href={`/knowledge/books/${book.id}`} className="inline-flex w-fit items-center gap-2 text-sm font-semibold text-primary hover:underline">查看阅读导览与全文 <ArrowRight aria-hidden size={17} /></Link>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
