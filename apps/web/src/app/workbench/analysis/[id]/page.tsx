import { notFound } from "next/navigation";
import Link from "next/link";
import { WorkbenchAnalysisEditor } from "@/components/workbench-analysis-editor";
import { requireActiveMember } from "@/lib/auth/dal";
import { getWorkbenchAnalysis } from "@/lib/workbench/server-repository";

export default async function AnalysisPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const step = Math.max(0, Math.min(10, Number(query.step) || 0));
  const actor = await requireActiveMember(`/workbench/analysis/${id}?step=${step}`);
  const analysis = id === "new" ? null : await getWorkbenchAnalysis(id, actor.id);
  if (id !== "new" && !analysis) notFound();
  return <main className="mx-auto grid max-w-7xl gap-7 px-4 py-8 md:px-6 md:py-12"><LinkHeader /><WorkbenchAnalysisEditor actorId={actor.id} initialAnalysis={analysis ?? undefined} initialStep={step} /></main>;
}

function LinkHeader() {
  return <Link href="/workbench" className="text-sm font-medium text-muted-foreground hover:text-primary">返回交易工作台</Link>;
}
