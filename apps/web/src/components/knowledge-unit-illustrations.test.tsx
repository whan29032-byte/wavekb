import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { getKnowledgePage } from "@wavekb/knowledge";
import { coreBookExplanations } from "@/lib/knowledge/core-book-illustrations";
import { KnowledgeUnitIllustrations } from "./knowledge-unit-illustrations";

afterEach(cleanup);

describe("Unit-local original-page illustrations", () => {
  it("renders an explicitly sourced, lazy original page with its exact location and a focusable jump target", () => {
    const unit = getKnowledgePage("unit-ewp-rule-zigzag")!;
    const [{ figures }] = coreBookExplanations([`${unit.title}（RULE）\n解释`], [unit]);
    const { container } = render(<KnowledgeUnitIllustrations figures={figures} unitTitle={unit.title} />);
    expect(screen.getByRole("group", { name: `${unit.title}的第10版补充原页摘录` })).toBeDefined();
    expect(container.querySelectorAll("img")).toHaveLength(figures.length);
    figures.forEach((figure) => {
      const target = document.getElementById(figure.anchorId)!;
      expect(target.getAttribute("tabindex")).toBe("-1");
      expect(target.dataset.sourceId).toBe("ewp-10-zh-2016");
      expect(target.dataset.edition).toBe("10");
      expect(target.dataset.authority).toBe("primary");
      expect(target.dataset.figureType).toBe("original_source_excerpt");
      const image = target.querySelector("img")!;
      expect(image.getAttribute("src")).toBe(`/${figure.asset.asset_path}`);
      expect(image.getAttribute("loading")).toBe("lazy");
      expect(target.querySelector("figcaption")?.textContent).toContain(`PDF 第 ${figure.asset.pdf_page} 页`);
    });
    fireEvent.click(screen.getAllByRole("button", { name: /放大查看/ })[0]);
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toContain(unit.title);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("gives later shared-page references a real existing image target instead of repeating the image", () => {
    const first = getKnowledgePage("unit-ewp-guide-zigzag")!;
    const later = getKnowledgePage("unit-ewp-rule-zigzag")!;
    const plan = coreBookExplanations([`${first.title}（GUIDELINE）\n说明`, `${later.title}（RULE）\n说明`], [first, later]);
    const { container } = render(<>{plan.map((item) => <KnowledgeUnitIllustrations key={item.unit!.id} figures={item.figures} unitTitle={item.unit!.title} />)}</>);
    expect(container.querySelectorAll("img")).toHaveLength(first.primary_figures.length);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(later.primary_figures.length);
    links.forEach((link, index) => {
      const target = document.getElementById(link.getAttribute("href")!.slice(1))!;
      expect(target.dataset.coreBookFigure).toBe(plan[1].figures[index].asset.asset_path);
      expect(target.querySelector("img")).not.toBeNull();
      expect(link.className).toContain("min-h-11");
    });
  });
});
