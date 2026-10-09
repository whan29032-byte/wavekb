import { BookReadingLink } from "./book-reading-link";
import { KnowledgeImageViewer } from "./knowledge-image-viewer";
import { coreBookFigureCaption, type CoreBookFigure } from "@/lib/knowledge/core-book-illustrations";

function assetUrl(assetPath: string) {
  const base = (process.env.NEXT_PUBLIC_KNOWLEDGE_ASSET_BASE_URL || "").replace(/\/$/, "");
  return `${base}/${assetPath.replace(/^\//, "")}`;
}

export function KnowledgeUnitIllustrations({ figures, unitTitle }: { figures: CoreBookFigure[]; unitTitle: string }) {
  if (!figures.length) return null;
  return <div role="group" className="grid min-w-0 gap-4" aria-label={`${unitTitle}的第10版补充原页摘录`}>
    {figures.map(({ asset, anchorId, firstOccurrence, firstUnitTitle }) => firstOccurrence
      ? <div key={asset.asset_path} id={anchorId} tabIndex={-1} data-core-book-figure={asset.asset_path} data-source-id={asset.source_id} data-edition={asset.edition} data-authority={asset.authority} data-figure-type={asset.figure_type} className="min-w-0 max-w-2xl scroll-mt-24 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
        <KnowledgeImageViewer assets={[{ url: assetUrl(asset.asset_path), alt: `${unitTitle} · 第10版原页摘录（补充资料）${asset.pdf_page ? ` · PDF 第 ${asset.pdf_page} 页` : ""}`, width: asset.width, height: asset.height, caption: coreBookFigureCaption(asset) }]} />
      </div>
      : <BookReadingLink key={asset.asset_path} href={`#${anchorId}`} data-core-book-figure-reference={asset.asset_path} className="inline-flex min-h-11 w-fit max-w-full items-center rounded-lg border px-3 py-2 text-sm leading-6 text-primary underline decoration-primary/40 underline-offset-4 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">查看对应原页{asset.pdf_page ? `（PDF 第 ${asset.pdf_page} 页）` : ""} · 已在“{firstUnitTitle}”展示</BookReadingLink>)}
  </div>;
}
