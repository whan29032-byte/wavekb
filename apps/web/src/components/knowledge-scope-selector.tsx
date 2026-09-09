import { getKnowledgeBookCatalog } from "@/lib/knowledge/book-catalog";
import type { KnowledgeScopeValue } from "@/lib/workbench/analysis-client";

const BOOK_IDS = [
  "elliott-wave-principle-tenth-edition",
  "elliott-wave-natural-law",
  "chan-theory-complete",
] as const;

export function KnowledgeScopeSelector({ value, onChange, disabled }: {
  value: KnowledgeScopeValue;
  onChange: (value: KnowledgeScopeValue) => void;
  disabled: boolean;
}) {
  const books = getKnowledgeBookCatalog().filter((book) => BOOK_IDS.includes(book.id as typeof BOOK_IDS[number]));
  const options = [{ value: "all" as const, label: "全部已发布书籍" }, ...books.map((book) => ({ value: book.id as KnowledgeScopeValue, label: book.title }))];

  return <fieldset className="grid gap-2" disabled={disabled}>
    <legend className="text-sm font-semibold">AI 知识范围</legend>
    <p className="text-xs leading-5 text-muted-foreground">选择本次候选分析检索的已发布原书；范围仅在当前编辑会话中保留。</p>
    <div className="grid gap-2">{options.map((option) => <label key={option.value} className="flex items-center gap-3 rounded-lg border bg-background px-3 py-2 text-sm">
      <input type="radio" name="knowledge-scope" value={option.value} checked={value === option.value} disabled={disabled} onChange={() => onChange(option.value)} />
      {option.label}
    </label>)}</div>
  </fieldset>;
}
