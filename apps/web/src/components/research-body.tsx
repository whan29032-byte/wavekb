import type { ReactNode } from "react";

function inlineMarkup(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={index} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>
      : part,
  );
}

type Block = { kind: "h2" | "h3" | "quote" | "hr" | "paragraph"; text: string } | { kind: "ol" | "ul"; items: string[] };

function blocksFor(body: string): Block[] {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    const text = paragraph.join(" ").trim();
    if (text) blocks.push({ kind: "paragraph", text });
    paragraph = [];
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) { flush(); continue; }
    if (/^#{1,2}\s+/.test(line)) {
      flush();
      const level = line.startsWith("## ") ? "h3" : "h2";
      blocks.push({ kind: level, text: line.replace(/^#{1,2}\s+/, "") });
      continue;
    }
    if (/^【[^】]+】$/.test(line)) { flush(); blocks.push({ kind: "h2", text: line.slice(1, -1) }); continue; }
    if (/^>\s+/.test(line)) { flush(); blocks.push({ kind: "quote", text: line.replace(/^>\s+/, "") }); continue; }
    if (/^(-{3,}|\*{3,})$/.test(line)) { flush(); blocks.push({ kind: "hr", text: "" }); continue; }
    const ordered = line.match(/^\d+[.)、]\s*(.+)$/);
    const unordered = line.match(/^[-*]\s+(.+)$/);
    if (ordered || unordered) {
      flush();
      const kind = ordered ? "ol" : "ul";
      const items: string[] = [];
      while (index < lines.length) {
        const candidate = lines[index].trim();
        const match = kind === "ol" ? candidate.match(/^\d+[.)、]\s*(.+)$/) : candidate.match(/^[-*]\s+(.+)$/);
        if (!match) { index -= 1; break; }
        items.push(match[1]);
        index += 1;
      }
      blocks.push({ kind, items });
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

export function ResearchBody({ body, compact = false }: { body: string; compact?: boolean }) {
  return (
    <div className={compact ? "grid gap-3 text-sm leading-7 text-foreground/85" : "research-prose"}>
      {blocksFor(body).map((block, index) => {
        if (block.kind === "h2") return <h2 key={index}>{inlineMarkup(block.text)}</h2>;
        if (block.kind === "h3") return <h3 key={index}>{inlineMarkup(block.text)}</h3>;
        if (block.kind === "quote") return <blockquote key={index}>{inlineMarkup(block.text)}</blockquote>;
        if (block.kind === "hr") return <hr key={index} />;
        if (block.kind === "ol") return <ol key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{inlineMarkup(item)}</li>)}</ol>;
        if (block.kind === "ul") return <ul key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{inlineMarkup(item)}</li>)}</ul>;
        if (block.kind === "paragraph") return <p key={index}>{inlineMarkup(block.text)}</p>;
        return null;
      })}
    </div>
  );
}
