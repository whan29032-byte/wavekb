"use client";

import { useState } from "react";
import type { KnowledgeAsset } from "@wavekb/knowledge";
import { KnowledgeImageViewer } from "./knowledge-image-viewer";

export function KnowledgeOriginalPage({ asset, sourceId, edition, page }: { asset: KnowledgeAsset; sourceId: string; edition: number; page: number }) {
  const [expanded, setExpanded] = useState(false);
  if (asset.source_id !== sourceId || asset.edition !== edition || asset.pdf_page !== page || asset.figure_type !== "source_page_scan") return null;
  const base = (process.env.NEXT_PUBLIC_KNOWLEDGE_ASSET_BASE_URL || "").replace(/\/$/, "");
  return <details className="mt-5 rounded-lg border" data-original-source-page={page} data-source-id={sourceId} data-edition={edition} onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary className="flex min-h-11 cursor-pointer items-center rounded-lg px-4 py-3 text-sm font-semibold text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">查看第{edition}版原页（含图表）<span className="ml-2 text-xs font-normal text-muted-foreground">PDF 第 {page} 页</span></summary>
    {expanded ? <div className="border-t p-3"><KnowledgeImageViewer assets={[{ url: `${base}/${asset.asset_path.replace(/^\//, "")}`, alt: `第${edition}版原书 PDF 第 ${page} 页`, width: asset.width, height: asset.height, caption: `第${edition}版原书原页 · PDF 第 ${page} 页 · ${sourceId}` }]} /></div> : null}
  </details>;
}
