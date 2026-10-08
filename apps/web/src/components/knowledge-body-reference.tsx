import { Fragment } from "react";
import Link from "next/link";
import { getKnowledgePage, type KnowledgePage } from "@wavekb/knowledge";

const referenceClassName = "rounded-sm text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary";

function KnowledgeReferenceLink({ page }: { page: KnowledgePage }) {
  return <Link href={`/knowledge/${page.id}`} prefetch={false} className={referenceClassName}>{page.title}</Link>;
}

export function publicSourceUnitPages(sourceUnitIds: string[]): KnowledgePage[] {
  return [...new Set(sourceUnitIds)].flatMap((unitId) => {
    const page = getKnowledgePage(`unit-${unitId}`);
    return page?.source_unit_ids.includes(unitId) ? [page] : [];
  });
}

function InlineCodeReferences({ text }: { text: string }) {
  const matches = [...text.matchAll(/`((?:core|unit|candidate|full)-[a-z0-9-]+)`/g)];
  if (!matches.length) return text;
  let offset = 0;
  return <>{matches.map((match) => {
    const start = match.index;
    const preceding = text.slice(offset, start);
    offset = start + match[0].length;
    const page = getKnowledgePage(match[1]);
    return <Fragment key={start}>{preceding}{page ? <KnowledgeReferenceLink page={page} /> : match[0]}</Fragment>;
  })}{text.slice(offset)}</>;
}

export function KnowledgeBodyReference({
  text,
  sectionTitle,
  sourceUnitPages = [],
}: {
  text: string;
  sectionTitle: string;
  sourceUnitPages?: KnowledgePage[];
}) {
  if (sectionTitle === "相关知识") {
    const reference = /^(ewp-[a-z0-9-]+) — .+$/.exec(text);
    if (reference) {
      const page = publicSourceUnitPages([reference[1]])[0];
      return page ? <KnowledgeReferenceLink page={page} /> : text;
    }
  }

  const matchingSources = sourceUnitPages.filter((page) => sectionTitle === "快速答案"
    ? text.startsWith(`${page.title}：`)
    : sectionTitle === "完整解释" && page.unit_types.length === 1
      && text.startsWith(`${page.title}（${page.unit_types[0]}）\n`));
  if (matchingSources.length === 1) {
    const page = matchingSources[0];
    return <><KnowledgeReferenceLink page={page} /><InlineCodeReferences text={text.slice(page.title.length)} /></>;
  }

  return <InlineCodeReferences text={text} />;
}

export function KnowledgeSourceUnitIndex({ pages }: { pages: KnowledgePage[] }) {
  if (pages.length < 2) return null;
  return <details className="rounded-xl border bg-surface p-4 open:grid open:gap-4">
    <summary className="cursor-pointer rounded-sm text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">查看本页知识目录（{pages.length}）</summary>
    <nav aria-label="本页知识目录" className="grid gap-1 border-t pt-3">
      {pages.map((page, index) => <Link key={page.id} href={`/knowledge/${page.id}`} prefetch={false} className="flex min-h-11 items-start gap-3 rounded-lg px-2 py-3 text-sm leading-6 hover:bg-muted hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"><span aria-hidden className="min-w-6 shrink-0 text-xs tabular-nums text-muted-foreground">{String(index + 1).padStart(2, "0")}</span><span>{page.title}</span></Link>)}
    </nav>
  </details>;
}
