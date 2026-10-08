import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { getKnowledgePage, knowledgeData } from "@wavekb/knowledge";
import { KnowledgeBodyReference, KnowledgeSourceUnitIndex, publicSourceUnitPages } from "./knowledge-body-reference";

afterEach(cleanup);

describe("verified knowledge body references", () => {
  it("links all 342 canonical related-unit references using registry titles, not technical ids", () => {
    const references = knowledgeData().pages.flatMap((page) => page.sections
      .filter((section) => section.title === "相关知识")
      .flatMap((section) => section.items));
    expect(references).toHaveLength(342);
    render(<ul>{references.map((text, index) => <li key={index}><KnowledgeBodyReference text={text} sectionTitle="相关知识" /></li>)}</ul>);

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(references.length);
    references.forEach((text, index) => {
      const unitId = /^(ewp-[a-z0-9-]+) — /.exec(text)![1];
      const target = getKnowledgePage(`unit-${unitId}`)!;
      expect(links[index].getAttribute("href")).toBe(`/knowledge/${target.id}`);
      expect(links[index].textContent).toBe(target.title);
      expect(links[index].textContent).not.toContain(unitId);
    });
  });

  it("uses the verified target title rather than trusting the source label", () => {
    const page = getKnowledgePage("unit-ewp-method-scale")!;
    render(<KnowledgeBodyReference text="ewp-method-scale — 任意旧标题" sectionTitle="相关知识" />);
    expect(screen.getByRole("link").textContent).toBe(page.title);
    expect(screen.queryByText("任意旧标题")).toBeNull();
  });

  it.each([
    "ewp-unknown-private-unit — 未公开的知识",
    "ewp-method-scale - 算术与半对数刻度检查",
    "ewp-method-scale — ",
  ])("preserves unknown or non-canonical related reference as plain text: %s", (text) => {
    render(<KnowledgeBodyReference text={text} sectionTitle="相关知识" />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(document.body.textContent).toBe(text);
  });

  it("resolves only public inline code references and leaves unknown or hidden code unchanged", () => {
    const target = getKnowledgePage("core-zigzag")!;
    render(<KnowledgeBodyReference text="查看 `core-zigzag`，保留 `core-unknown` 和 `candidate-framework-case-btc-zc`。" sectionTitle="对应的核心知识链接" />);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link").textContent).toBe(target.title);
    expect(screen.getByRole("link").getAttribute("href")).toBe(`/knowledge/${target.id}`);
    expect(document.body.textContent).toContain("`core-unknown`");
    expect(document.body.textContent).toContain("`candidate-framework-case-btc-zc`");
  });

  it("links aggregate summaries and explanations only to exact, declared source-unit titles", () => {
    const source = getKnowledgePage("core-system")!;
    const units = publicSourceUnitPages(source.source_unit_ids);
    const summary = source.sections.find((section) => section.title === "快速答案")!.items[0];
    const explanation = source.sections.find((section) => section.title === "完整解释")!.paragraphs[0];
    const { rerender } = render(<KnowledgeBodyReference text={summary} sectionTitle="快速答案" sourceUnitPages={units} />);
    expect(screen.getByRole("link").textContent).toBe(units[0].title);
    expect(document.body.textContent).toBe(summary);

    rerender(<KnowledgeBodyReference text={explanation} sectionTitle="完整解释" sourceUnitPages={units} />);
    expect(screen.getByRole("link").getAttribute("href")).toBe(`/knowledge/${units[0].id}`);
    expect(document.body.textContent).toBe(explanation);

    rerender(<KnowledgeBodyReference text={summary} sectionTitle="快速答案" sourceUnitPages={[]} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(document.body.textContent).toBe(summary);
  });

  it("never converts original PDF source page numbers into distilled-page links or treats HTML as markup", () => {
    const text = '图源：PDF第43页，原书第32页。<img src=x onerror="alert(1)">';
    render(<KnowledgeBodyReference text={text} sectionTitle="原书来源" />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
    expect(document.body.textContent).toBe(text);
  });

  it("provides a complete, deduplicated directory of actual public source units after expansion", () => {
    const fullBook = getKnowledgePage("core-full-book")!;
    const units = publicSourceUnitPages([...fullBook.source_unit_ids, fullBook.source_unit_ids[0], "ewp-unknown"]);
    expect(units).toHaveLength(117);
    const { container } = render(<KnowledgeSourceUnitIndex pages={units} />);
    expect(container.querySelector("details")?.open).toBe(false);
    fireEvent.click(screen.getByText("查看本页知识目录（117）"));
    expect(container.querySelector("details")?.open).toBe(true);
    const directory = screen.getByRole("navigation", { name: "本页知识目录" });
    const links = within(directory).getAllByRole("link");
    expect(links).toHaveLength(117);
    expect(links.map((link) => link.getAttribute("href"))).toEqual(units.map((page) => `/knowledge/${page.id}`));
    expect(links.map((link) => link.querySelector("span:not([aria-hidden])")?.textContent)).toEqual(units.map((page) => page.title));
  });
});
