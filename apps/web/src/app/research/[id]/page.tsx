import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ResearchArticle } from "@/components/research-list";
import { LocalResearchNotFoundError, readResearch } from "@/lib/tline/server";
import { researchView } from "@/lib/tline/presentation";
import { publicMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return publicMetadata({ title: "研报详情", description: "阅读 WaveKB 收录的公开机构研报与研究摘要。", path: `/research/${encodeURIComponent(id)}`, type: "article" });
}
export const dynamic = "force-dynamic";
export default async function ResearchDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id || id === "." || id === ".." || id.length > 200) notFound();
  const result = await readResearch(id).catch((error: unknown) => { if (error instanceof LocalResearchNotFoundError) notFound(); throw error; });
  return <main className="mx-auto max-w-3xl px-4 py-8 md:px-6 md:py-12"><Link prefetch={false} href="/research" className="mb-7 inline-flex min-h-11 items-center text-sm text-primary hover:underline">← 返回机构研报</Link><ResearchArticle item={researchView(result.data, result.institutions)} /></main>;
}
