import Link from "next/link";
import { notFound } from "next/navigation";
import { ResearchArticle } from "@/components/research-list";
import { readResearch } from "@/lib/tline/server";
import { researchView } from "@/lib/tline/presentation";
import { TlineError } from "@/lib/tline/client";

export const metadata = { title: "研报详情" };
export const dynamic = "force-dynamic";
export default async function ResearchDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id || id === "." || id === ".." || id.length > 200) notFound();
  const result = await readResearch(id).catch((error: unknown) => { if (error instanceof TlineError && error.status === 404) notFound(); throw error; });
  return <main className="mx-auto max-w-3xl px-4 py-8 md:px-6 md:py-12"><Link prefetch={false} href="/research" className="mb-7 inline-flex min-h-11 items-center text-sm text-primary hover:underline">← 返回机构研报</Link><ResearchArticle item={researchView(result.data, result.institutions)} /></main>;
}
