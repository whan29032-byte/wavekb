import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { notFound } from "next/navigation";
import { getKnowledgePage, knowledgeData, type KnowledgeTheme } from "@wavekb/knowledge";

type PageProps = { params: Promise<{ id: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return knowledgeData().themes.map((theme) => ({ id: theme.id }));
}

function unitsInTheme(theme: KnowledgeTheme): string[] {
  return [...theme.unit_ids, ...theme.children.flatMap(unitsInTheme)];
}

function themeById(id: string) {
  return knowledgeData().themes.find((theme) => theme.id === id) ?? null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const theme = themeById((await params).id);
  return theme ? { title: theme.title, description: `按主题阅读 ${unitsInTheme(theme).length} 个波浪理论知识条目。` } : {};
}

export default async function KnowledgeThemePage({ params }: PageProps) {
  const theme = themeById((await params).id);
  if (!theme) notFound();
  const unitIds = unitsInTheme(theme);
  const pages = unitIds.map((unitId) => getKnowledgePage(`unit-${unitId}`)).filter((page) => page !== null);

  return (
    <main className="mx-auto grid max-w-5xl gap-8 px-4 py-10 md:px-6 md:py-14">
      <Link href="/knowledge#theme-routes" className="inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground hover:text-primary"><ArrowLeft aria-hidden size={17} />返回八大主题</Link>
      <header className="grid gap-3 border-b pb-7">
        <span className="text-sm font-medium text-primary">主题阅读路径</span>
        <h1 className="max-w-[22ch] text-3xl font-semibold leading-tight tracking-[-0.035em] md:text-5xl">{theme.title}</h1>
        <p className="max-w-[68ch] text-sm leading-6 text-muted-foreground">本主题共 {pages.length} 个知识条目。先浏览完整目录，再按顺序进入正文，不会直接跳过主题结构。</p>
      </header>

      {theme.children.length ? <nav className="flex flex-wrap gap-x-5 gap-y-2 border-b pb-5" aria-label="主题内分组">{theme.children.map((child) => <a key={child.id} href={`#${child.id}`} className="text-sm font-medium text-muted-foreground hover:text-primary">{child.title} · {unitsInTheme(child).length}</a>)}</nav> : null}

      <div className="grid gap-9">
        {(theme.children.length ? theme.children : [theme]).map((group) => {
          const groupPages = unitsInTheme(group).map((unitId) => getKnowledgePage(`unit-${unitId}`)).filter((page) => page !== null);
          return groupPages.length ? <section key={group.id} id={group.id} className="grid scroll-mt-24 gap-4" aria-labelledby={`${group.id}-title`}><header className="flex items-end justify-between gap-4"><h2 id={`${group.id}-title`} className="text-xl font-semibold">{group === theme ? "主题目录" : group.title}</h2><span className="text-xs text-muted-foreground">{groupPages.length} 条</span></header><ol className="border-y">{groupPages.map((page, index) => <li key={page.id} className={index ? "border-t" : undefined}><Link href={`/knowledge/${page.id}`} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-start gap-3 px-1 py-4 hover:text-primary"><span className="pt-0.5 text-xs tabular-nums text-muted-foreground">{String(index + 1).padStart(2, "0")}</span><span><strong className="block text-sm leading-6">{page.title}</strong><span className="mt-1 block text-xs leading-5 text-muted-foreground">{page.unit_types.join("、") || "知识条目"} · {page.source_authorities.map((authority) => authority === "primary" ? "第10版" : "补充来源").join(" / ")}</span></span><ArrowRight aria-hidden size={16} className="mt-1 shrink-0" /></Link></li>)}</ol></section> : null;
        })}
      </div>
    </main>
  );
}
