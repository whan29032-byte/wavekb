import { parseKnowledgeBookText } from "@/lib/knowledge/reading-text";
export { parseKnowledgeBookText } from "@/lib/knowledge/reading-text";

export function KnowledgeBookText({ text }: { text: string }) {
  return (
    <div className="grid min-w-0 gap-4 text-[1.04rem] leading-8 text-foreground/90">
      {parseKnowledgeBookText(text).map((block, index) => {
        if (block.kind === "heading") return block.level === 2
          ? <h4 key={index} className="mt-3 text-xl font-semibold text-foreground">{block.text}</h4>
          : <h5 key={index} className="mt-2 text-lg font-semibold text-foreground">{block.text}</h5>;
        if (block.kind === "list") {
          const items = block.items.map((item, itemIndex) => <li key={itemIndex} value={item.value} className="pl-1">{item.text}</li>);
          return block.ordered
            ? <ol key={index} className="grid gap-2 pl-6 [list-style:decimal] marker:text-primary">{items}</ol>
            : <ul key={index} className="grid gap-2 pl-6 [list-style:disc] marker:text-primary">{items}</ul>;
        }
        if (block.kind === "table") return (
          <div key={index} className="min-w-0">
            <div className="max-w-full overflow-x-auto rounded-lg border" tabIndex={0} role="region" aria-label="本页表格，可横向滚动">
              <table className="w-full min-w-[30rem] border-collapse text-left text-sm leading-6">
                <caption className="sr-only">本页资料整理表格</caption>
                <thead className="bg-muted"><tr>{block.headers.map((header, column) => <th key={column} scope="col" className="border-b px-4 py-3 font-semibold text-foreground">{header}</th>)}</tr></thead>
                <tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, column) => <td key={column} className="border-b px-4 py-3 align-top last:border-r-0">{cell}</td>)}</tr>)}</tbody>
              </table>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground sm:hidden">表格可左右滑动，查看全部列。</p>
          </div>
        );
        return <p key={index} className="whitespace-pre-line">{block.text}</p>;
      })}
    </div>
  );
}
