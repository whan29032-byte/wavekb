import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowSquareOut, BookOpenText, FilePdf, SealCheck } from "@phosphor-icons/react/dist/ssr";
import { notFound } from "next/navigation";
import { knowledgeData } from "@wavekb/knowledge";

type PageProps = { params: Promise<{ id: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return knowledgeData().library.books.map((book) => ({ id: book.id }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const book = knowledgeData().library.books.find((item) => item.id === id);
  return book ? { title: book.title, description: book.description } : {};
}

function assetUrl(assetPath: string) {
  const base = (process.env.NEXT_PUBLIC_KNOWLEDGE_ASSET_BASE_URL || "").replace(/\/$/, "");
  return `${base}/${assetPath.replace(/^\//, "")}`;
}

export default async function KnowledgeBookDetailPage({ params }: PageProps) {
  const { id } = await params;
  const book = knowledgeData().library.books.find((item) => item.id === id);
  if (!book) notFound();

  return (
    <main className="mx-auto grid max-w-6xl gap-8 px-4 py-10 md:grid-cols-[minmax(0,1fr)_16rem] md:px-6 md:py-14">
      <article className="grid min-w-0 gap-8">
        <Link href="/knowledge/books" className="inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground hover:text-primary"><ArrowLeft aria-hidden size={17} />返回扩展书架</Link>
        <header className="grid gap-6 border-b pb-8 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-end">
          <div className="relative aspect-[0.71] overflow-hidden rounded-xl border bg-muted"><Image src={assetUrl(book.cover_path)} alt={`${book.title}封面`} fill sizes="10rem" className="object-contain" /></div>
          <div className="grid gap-4"><span className="flex items-center gap-2 text-sm font-medium text-primary"><BookOpenText aria-hidden size={20} weight="duotone" />{book.eyebrow}</span><h1 className="max-w-[20ch] text-3xl font-semibold leading-tight tracking-[-0.035em] md:text-5xl">{book.title}</h1><p className="max-w-[62ch] text-sm leading-6 text-muted-foreground">{book.description}</p><a href={assetUrl(book.pdf_path)} target="_blank" rel="noopener noreferrer" className="inline-flex w-fit items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"><FilePdf aria-hidden size={18} />打开完整蒸馏 PDF <ArrowSquareOut aria-hidden size={16} /></a></div>
        </header>

        <section className="grid gap-3"><h2 className="text-2xl font-semibold tracking-tight">收录范围</h2><p className="max-w-[76ch] text-base leading-8 text-foreground/90">{book.source_label}</p><p className="max-w-[76ch] text-base leading-8 text-foreground/90">{book.coverage_note}</p></section>

        <section className="grid gap-4"><h2 className="text-2xl font-semibold tracking-tight">阅读导览</h2><div className="grid gap-3">{book.reading_guide.map((item, index) => <article key={item.title} className="grid gap-2 rounded-xl border bg-surface p-5"><span className="text-xs font-semibold text-primary">{String(index + 1).padStart(2, "0")}</span><h3 className="text-lg font-semibold">{item.title}</h3><p className="max-w-[72ch] text-sm leading-7 text-muted-foreground">{item.description}</p></article>)}</div></section>

        <section className="grid gap-4"><h2 className="text-2xl font-semibold tracking-tight">使用边界</h2><ul className="grid max-w-[76ch] gap-2 pl-5 text-base leading-7 text-foreground/90">{book.boundaries.map((item) => <li key={item} className="list-disc pl-1 marker:text-primary">{item}</li>)}</ul></section>
      </article>

      <aside className="grid h-fit gap-5 md:sticky md:top-24"><div className="grid gap-3 rounded-xl border bg-surface p-4"><h2 className="flex items-center gap-2 text-sm font-semibold"><SealCheck aria-hidden size={17} className="text-primary" />文献资料</h2><dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs text-muted-foreground"><dt>蒸馏页数</dt><dd>{book.pdf_pages}</dd><dt>覆盖来源</dt><dd>{book.source_page_count.toLocaleString("zh-CN")}</dd><dt>生成日期</dt><dd>{book.generated_on}</dd><dt>校验值</dt><dd className="break-all font-mono text-[10px] leading-4">SHA-256 {book.sha256}</dd></dl></div><div className="grid gap-2"><h2 className="text-sm font-semibold">主题</h2><div className="flex flex-wrap gap-2">{book.topics.map((topic) => <span key={topic} className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">{topic}</span>)}</div></div></aside>
    </main>
  );
}
