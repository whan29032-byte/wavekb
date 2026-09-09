import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { getKnowledgeBookCatalog } from "@/lib/knowledge/book-catalog";
import { publicMetadata } from "@/lib/seo";

export const metadata: Metadata = publicMetadata({
  title: "图书",
  description: "阅读 WaveKB 的核心主书与扩展研究资料。",
  path: "/knowledge/books",
});

function assetUrl(assetPath: string) {
  const base = (process.env.NEXT_PUBLIC_KNOWLEDGE_ASSET_BASE_URL || "").replace(/\/$/, "");
  return `${base}/${assetPath.replace(/^\//, "")}`;
}

export default function KnowledgeBooksPage() {
  const books = getKnowledgeBookCatalog();

  return (
    <main className="mx-auto grid max-w-6xl gap-10 px-4 py-10 md:px-6 md:py-14">
      <header className="grid gap-5 border-b pb-8">
        <Link href="/knowledge" className="inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground hover:text-primary"><ArrowLeft aria-hidden size={17} />返回知识库</Link>
        <div className="grid gap-3">
          <h1 className="text-4xl font-semibold tracking-[-0.04em] md:text-5xl">三本图书</h1>
          <p className="max-w-[68ch] text-base leading-7 text-muted-foreground">选择一本书进入独立目录和书内搜索。核心主书用于规则判断，扩展资料用于交叉阅读。</p>
        </div>
      </header>

      <section className="grid gap-8 lg:grid-cols-3" aria-label="知识库图书">
        {books.map((book) => (
          <Link key={book.id} href={book.href} className="group grid content-start gap-4 border-t pt-4 focus-visible:rounded-lg">
            <div className="relative aspect-[.71] w-full max-w-[13rem] overflow-hidden rounded-lg border bg-muted">
              <Image src={assetUrl(book.coverPath)} alt={`${book.title}封面`} fill sizes="13rem" className="object-contain" />
            </div>
            <span className="grid gap-2">
              <span className="flex flex-wrap items-center gap-2 text-xs"><strong className={book.kind === "core" ? "text-primary" : "text-muted-foreground"}>{book.label}</strong><span className="text-muted-foreground">{book.edition}</span></span>
              <strong className="text-xl leading-7 group-hover:text-primary">{book.title}</strong>
              <span className="text-sm leading-6 text-muted-foreground">{book.description}</span>
              <span className="inline-flex items-center gap-1 text-sm font-semibold">进入图书<ArrowRight aria-hidden size={16} className="transition-transform group-hover:translate-x-0.5" /></span>
            </span>
          </Link>
        ))}
      </section>
    </main>
  );
}
