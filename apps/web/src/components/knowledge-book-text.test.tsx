import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KnowledgeBookText, parseKnowledgeBookText } from "./knowledge-book-text";
import { knowledgeData } from "@wavekb/knowledge";

describe("reviewed book text", () => {
  it("places a source-grounded image immediately after its exact reviewed heading without consuming text", () => {
    const page = knowledgeData().library.books.find((book) => book.id === "elliott-wave-natural-law")!.text_pages.find((page) => page.page === 7)!;
    const figure = page.illustrations![0];
    const { container } = render(<KnowledgeBookText text={page.text} illustrations={page.illustrations} />);
    const placement = container.querySelector(`[data-book-illustration="${figure.id}"]`)!;
    expect(placement.previousElementSibling?.textContent).toBe("锯齿形与倒置锯齿形");
    expect(placement.querySelector("img")?.getAttribute("src")).toBe(`/${figure.asset_path}`);
    expect(placement.querySelector("figcaption")?.textContent).toContain("图源 PDF 32 / 原书第 21 页");
    expect(placement.nextElementSibling?.textContent).toContain("图源：");
    expect(container.querySelectorAll("p")).toHaveLength(parseKnowledgeBookText(page.text).filter((block) => block.kind === "paragraph").length);
  });

  it("keeps separate paragraphs and meaningful theory notation intact", () => {
    const text = "结构 5-3-5、(A)、[i]、α < β、0.618、61.8%\n\n第二段：2—4 通道 → 确认";
    const { container } = render(<KnowledgeBookText text={text} />);
    expect(container.querySelectorAll("p")).toHaveLength(2);
    expect(screen.getByText("结构 5-3-5、(A)、[i]、α < β、0.618、61.8%")).toBeTruthy();
    expect(screen.getByText("第二段：2—4 通道 → 确认")).toBeTruthy();
  });

  it("renders reviewed table cells rather than literal pipe separators", () => {
    render(<KnowledgeBookText text={"## 覆盖清单\n\n| 栏目 | 篇数 |\n| --- | --- |\n| 时政经济 | 561 |\n| 教你炒股票 | 114 |"} />);
    expect(screen.getByRole("heading", { name: "覆盖清单" })).toBeTruthy();
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader")).toHaveLength(2);
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getByRole("cell", { name: "561" })).toBeTruthy();
    expect(table.textContent).not.toContain("---");
    expect(screen.getByRole("region", { name: "本页表格，可横向滚动" }).getAttribute("tabindex")).toBe("0");
    expect(screen.getByText("表格可左右滑动，查看全部列。")).toBeTruthy();
  });

  it("preserves explicit numbered list values and bullet content", () => {
    const { container } = render(<KnowledgeBookText text={"3. 第3浪不能最短\n\n5. 不以比例单独确认\n\n• A/B/C 保留"} />);
    expect([...container.querySelectorAll("ol li")].map((item) => item.getAttribute("value"))).toEqual(["3", "5"]);
    expect(screen.getByText("A/B/C 保留")).toBeTruthy();
  });

  it("does not guess malformed tables or execute source HTML", () => {
    const text = "| 比例 | 值 |\n| 不是分隔行 | 保留 |\n\n<img src=x onerror=alert(1)>\n\na | b";
    const { container } = render(<KnowledgeBookText text={text} />);
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
    expect(screen.getByText("a | b")).toBeTruthy();
  });

  it("does not discard a malformed row after a valid table", () => {
    const blocks = parseKnowledgeBookText("| 项 | 值 |\n| --- | --- |\n| 正常 | 1 |\n| 不能丢的额外列 | 2 | 3 |");
    expect(blocks[0].kind).toBe("table");
    expect(blocks[1]).toEqual({ kind: "paragraph", text: "| 不能丢的额外列 | 2 | 3 |" });
  });
});
