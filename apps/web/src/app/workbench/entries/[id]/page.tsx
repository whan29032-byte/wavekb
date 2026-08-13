import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrivateEntryEditor } from "@/components/private-entry-editor";
import { requireCurrentUser } from "@/lib/auth/dal";
import { getPrivateEntry } from "@/lib/workbench/server-repository";

export const metadata: Metadata = { title: "编辑私人记录" };

export default async function PrivateEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireCurrentUser(`/workbench/entries/${id}`);
  const entry = await getPrivateEntry(id, actor.id);
  if (!entry) notFound();
  return <main className="mx-auto grid max-w-5xl gap-7 px-4 py-10 md:px-6 md:py-14"><header className="grid gap-2"><h1 className="text-3xl font-semibold tracking-[-0.035em] md:text-4xl">编辑私人记录</h1><p className="max-w-[65ch] text-sm leading-6 text-muted-foreground">修改正文、核验结果或私密图片。旧版 TradingView 数据会原样保留。</p></header><PrivateEntryEditor actorId={actor.id} entry={entry} /></main>;
}
