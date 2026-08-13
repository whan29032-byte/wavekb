import type { Metadata } from "next";
import { PRIVATE_ENTRY_KINDS, type PrivateEntryKind } from "@wavekb/domain";
import { PrivateEntryEditor } from "@/components/private-entry-editor";
import { requireActiveMember } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "新建私人记录" };

export default async function NewPrivateEntryPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { kind: rawKind } = await searchParams;
  const kind = PRIVATE_ENTRY_KINDS.has(rawKind as PrivateEntryKind) ? rawKind as PrivateEntryKind : "review";
  const actor = await requireActiveMember(`/workbench/entries/new${rawKind ? `?kind=${kind}` : ""}`);
  return <main className="mx-auto grid max-w-5xl gap-7 px-4 py-10 md:px-6 md:py-14"><header className="grid gap-2"><h1 className="text-3xl font-semibold tracking-[-0.035em] md:text-4xl">新建私人记录</h1><p className="max-w-[65ch] text-sm leading-6 text-muted-foreground">先保存当时看到的证据和执行过程。记录默认不会出现在公开主页。</p></header><PrivateEntryEditor actorId={actor.id} initialKind={kind} /></main>;
}
