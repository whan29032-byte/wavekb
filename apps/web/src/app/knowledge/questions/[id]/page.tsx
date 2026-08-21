import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { notFound } from "next/navigation";
import { getKnowledgePage, knowledgeData } from "@wavekb/knowledge";

type PageProps = { params: Promise<{ id: string }> };

const stageTitles = {
  rule_exclusion: "1. 规则排除",
  guideline_ranking: "2. 指南排序",
  evidence_confirmation: "3. 证据确认",
  invalidation_management: "4. 失效管理",
} as const;

export const dynamicParams = false;

export function generateStaticParams() {
  return knowledgeData().questions.map((question) => ({ id: question.id }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const id = (await params).id;
  const question = knowledgeData().questions.find((item) => item.id === id);
  return question ? { title: question.question, description: "按规则、指南、证据与失效顺序回答的知识路线。" } : {};
}

export default async function KnowledgeQuestionPage({ params }: PageProps) {
  const id = (await params).id;
  const question = knowledgeData().questions.find((item) => item.id === id);
  if (!question) notFound();

  return (
    <main className="mx-auto grid max-w-4xl gap-8 px-4 py-10 md:px-6 md:py-14">
      <Link href="/knowledge#question-routes" className="inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground hover:text-primary"><ArrowLeft aria-hidden size={17} />返回问题路线</Link>
      <header className="grid gap-3 border-b pb-7">
        <span className="text-sm font-medium text-primary">Reasoning Route</span>
        <h1 className="text-3xl font-semibold leading-tight tracking-[-0.035em] md:text-5xl">{question.question}</h1>
        <p className="max-w-[68ch] text-sm leading-6 text-muted-foreground">四个阶段顺序固定；后一阶段不能推翻前一阶段发现的硬规则冲突。</p>
      </header>

      <ol className="grid gap-5">
        {question.reasoning_route.map((stage) => (
          <li key={stage.stage} className="grid gap-4 rounded-xl border bg-surface p-5 md:p-6">
            <div className="grid gap-2"><h2 className="text-xl font-semibold">{stageTitles[stage.stage]}</h2><p className="text-sm leading-6 text-muted-foreground">{stage.instruction}</p></div>
            <div className="grid gap-2 sm:grid-cols-2">
              {stage.unit_ids.map((unitId) => {
                const page = getKnowledgePage(`unit-${unitId}`);
                return page ? <Link key={unitId} href={`/knowledge/${page.id}`} className="flex items-start justify-between gap-3 rounded-lg bg-muted p-3 text-sm leading-5 hover:text-primary"><span>{page.title}</span><ArrowRight aria-hidden size={15} className="mt-0.5 shrink-0" /></Link> : null;
              })}
            </div>
          </li>
        ))}
      </ol>

      <section className="grid gap-3 rounded-xl border border-primary/25 bg-primary/5 p-5">
        <h2 className="font-semibold">停止条件</h2>
        <ul className="grid gap-2 pl-5 text-sm leading-6">{question.stop_conditions.map((condition) => <li key={condition} className="list-disc marker:text-primary">{condition}</li>)}</ul>
      </section>
    </main>
  );
}
