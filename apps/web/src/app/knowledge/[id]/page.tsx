import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Images, SealCheck } from "@phosphor-icons/react/dist/ssr";
import { notFound } from "next/navigation";
import { getKnowledgePage, knowledgeData, type KnowledgeAsset } from "@wavekb/knowledge";
import { KnowledgeImageViewer } from "@/components/knowledge-image-viewer";

type PageProps = { params: Promise<{ id: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return knowledgeData().pages.map((page) => ({ id: page.id }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const page = getKnowledgePage((await params).id);
  if (!page) return {};
  const description = page.sections.flatMap((section) => section.paragraphs).find(Boolean)?.slice(0, 150);
  return { title: page.title, description };
}

function assetUrl(assetPath: string) {
  const base = (process.env.NEXT_PUBLIC_KNOWLEDGE_ASSET_BASE_URL || "").replace(/\/$/, "");
  return `${base}/${assetPath.replace(/^\//, "")}`;
}

function uniqueAssets(assets: KnowledgeAsset[]) {
  return [...new Map(assets.map((asset) => [asset.asset_path, asset])).values()];
}

function AssetGrid({ assets, title }: { assets: KnowledgeAsset[]; title: string }) {
  if (!assets.length) return null;
  return (
    <section className="grid gap-4" aria-label={title}>
      <h2 className="text-xl font-semibold">{title}</h2>
      <KnowledgeImageViewer assets={assets.map((asset, index) => ({ url: assetUrl(asset.asset_path), alt: `${title} ${index + 1}`, width: asset.width, height: asset.height, caption: `${asset.book_pages?.length ? `书页 ${asset.book_pages.join(", ")}` : ""}${asset.book_pages?.length && asset.pdf_page ? " / " : ""}${asset.pdf_page ? `PDF 页 ${asset.pdf_page}` : ""}` }))} />
    </section>
  );
}

export default async function KnowledgeDetailPage({ params }: PageProps) {
  const page = getKnowledgePage((await params).id);
  if (!page) notFound();
  const primaryAssets = uniqueAssets([...page.primary_figures, ...page.figures, ...page.supplement_figures]);
  const sourceAssets = uniqueAssets(page.source_images);
  const related = page.related_page_ids.map(getKnowledgePage).filter((item) => item !== null);

  return (
    <main className="mx-auto grid max-w-6xl gap-8 px-4 py-10 md:grid-cols-[minmax(0,1fr)_16rem] md:px-6 md:py-14">
      <article className="grid min-w-0 gap-8">
        <Link href="/knowledge" className="inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground hover:text-primary"><ArrowLeft aria-hidden size={17} />返回知识库</Link>
        <header className="grid gap-4 border-b pb-7">
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground"><span>{page.kind === "core" ? "核心知识" : "辅助资料"}</span><span aria-hidden>/</span><span className="inline-flex items-center gap-1"><SealCheck aria-hidden size={16} className="text-primary" />{page.status === "verified" ? "已核验" : page.status}</span></div>
          <h1 className="max-w-[24ch] text-3xl font-semibold leading-tight tracking-[-0.035em] md:text-5xl">{page.title}</h1>
        </header>

        <div className="grid gap-7">
          {page.sections.map((section) => (
            <section key={section.title} className="grid gap-3">
              <h2 className="text-xl font-semibold tracking-tight md:text-2xl">{section.title}</h2>
              {section.paragraphs.map((paragraph, index) => <p key={index} className="max-w-[76ch] whitespace-pre-wrap text-base leading-8 text-foreground/90">{paragraph}</p>)}
              {section.items.length ? <ul className="grid max-w-[76ch] gap-2 pl-5 text-base leading-7 text-foreground/90">{section.items.map((item, index) => <li key={index} className="list-disc pl-1 marker:text-primary">{item}</li>)}</ul> : null}
            </section>
          ))}
        </div>

        <AssetGrid assets={primaryAssets} title="图示" />
        {sourceAssets.length ? (
          <details className="rounded-xl border bg-surface p-5 open:grid open:gap-5">
            <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold"><Images aria-hidden size={20} className="text-primary" />查看原书来源页（{sourceAssets.length}）</summary>
            <div className="pt-1"><KnowledgeImageViewer assets={sourceAssets.map((asset, index) => ({ url: assetUrl(asset.asset_path), alt: `原书来源页 ${index + 1}`, width: asset.width, height: asset.height, caption: `${asset.book_pages?.length ? `书页 ${asset.book_pages.join(", ")}` : ""}${asset.book_pages?.length && asset.pdf_page ? " / " : ""}${asset.pdf_page ? `PDF 页 ${asset.pdf_page}` : ""}` }))} /></div>
          </details>
        ) : null}
      </article>

      <aside className="grid h-fit gap-5 md:sticky md:top-24">
        <div className="grid gap-2 rounded-xl border bg-surface p-4">
          <h2 className="text-sm font-semibold">条目信息</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs text-muted-foreground"><dt>类型</dt><dd>{page.kind === "core" ? "核心知识" : "辅助资料"}</dd><dt>来源单元</dt><dd>{page.source_unit_ids.length}</dd><dt>相关条目</dt><dd>{related.length}</dd></dl>
        </div>
        {related.length ? <nav className="grid gap-2" aria-label="相关知识"><h2 className="text-sm font-semibold">相关知识</h2>{related.slice(0, 8).map((item) => <Link key={item.id} href={`/knowledge/${item.id}`} className="flex items-start justify-between gap-2 rounded-lg bg-muted p-3 text-sm leading-5 hover:text-primary"><span>{item.title}</span><ArrowRight aria-hidden size={15} className="mt-0.5 shrink-0" /></Link>)}</nav> : null}
      </aside>
    </main>
  );
}
