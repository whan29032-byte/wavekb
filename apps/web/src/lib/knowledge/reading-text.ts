export type ReadingBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; text: string; level: number }
  | { kind: "list"; ordered: boolean; items: Array<{ text: string; value?: number }> }
  | { kind: "table"; headers: string[]; rows: string[][] };

function cells(line: string) {
  const value = line.trim();
  if (!value.startsWith("|") || !value.endsWith("|")) return null;
  return value.slice(1, -1).split("|").map((cell) => cell.trim());
}

function listItem(line: string) {
  const unordered = line.match(/^\s*(?:•|[-*])\s+(.+)$/);
  if (unordered) return { ordered: false, text: unordered[1] };
  const ordered = line.match(/^\s*(\d+)\.\s+(.+)$/);
  return ordered ? { ordered: true, text: ordered[2], value: Number(ordered[1]) } : null;
}

// A small, text-only format for reviewed book extracts. It deliberately does
// not evaluate HTML, URLs, images, or arbitrary Markdown extensions.
export function parseKnowledgeBookText(text: string): ReadingBlock[] {
  const lines = text.replace(/\r\n?/g, "\n").trim().split("\n");
  const blocks: ReadingBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    if (!lines[index].trim()) { index += 1; continue; }
    const heading = lines[index].match(/^(#{2,4})\s+(.+)$/);
    if (heading) {
      blocks.push({ kind: "heading", text: heading[2], level: heading[1].length });
      index += 1;
      continue;
    }
    const headers = cells(lines[index]);
    const separator = cells(lines[index + 1] || "");
    if (headers && headers.length >= 2 && separator?.length === headers.length
      && separator.every((cell) => /^:?-{3,}:?$/.test(cell))) {
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length) {
        const row = cells(lines[index]);
        if (!row || row.length !== headers.length) break;
        rows.push(row);
        index += 1;
      }
      blocks.push({ kind: "table", headers, rows });
      continue;
    }
    const firstItem = listItem(lines[index]);
    if (firstItem) {
      const items: Array<{ text: string; value?: number }> = [];
      while (index < lines.length) {
        const item = listItem(lines[index]);
        if (!item || item.ordered !== firstItem.ordered) break;
        items.push({ text: item.text, ...(item.value === undefined ? {} : { value: item.value }) });
        index += 1;
        let next = index;
        while (next < lines.length && !lines[next].trim()) next += 1;
        if (listItem(lines[next] || "")?.ordered === firstItem.ordered) index = next;
      }
      blocks.push({ kind: "list", ordered: firstItem.ordered, items });
      continue;
    }
    const paragraph = [lines[index++]];
    while (index < lines.length && lines[index].trim()) {
      if (/^#{2,4}\s+/.test(lines[index]) || listItem(lines[index])) break;
      const nextHeaders = cells(lines[index]);
      const nextSeparator = cells(lines[index + 1] || "");
      if (nextHeaders && nextSeparator?.length === nextHeaders.length
        && nextSeparator.every((cell) => /^:?-{3,}:?$/.test(cell))) break;
      paragraph.push(lines[index++]);
    }
    blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
  }
  return blocks;
}

export function readingTextToPlainText(text: string) {
  return parseKnowledgeBookText(text).map((block) => {
    if (block.kind === "table") return [block.headers.join(" / "), ...block.rows.map((row) => row.join(" / "))].join("\n");
    if (block.kind === "list") return block.items.map((item) => item.value === undefined ? item.text : `${item.value}. ${item.text}`).join("\n");
    return block.text;
  }).join("\n\n");
}
