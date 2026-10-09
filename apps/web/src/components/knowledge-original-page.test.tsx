import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { knowledgeData } from "@wavekb/knowledge";
import { SOURCE_BOOK_ID } from "@/lib/knowledge/book-catalog";
import { KnowledgeOriginalPage } from "./knowledge-original-page";

afterEach(cleanup);
const page = knowledgeData().library.books.find((book) => book.id === SOURCE_BOOK_ID)!.text_pages[42]!;
const asset = page.source_image!;
const props = { asset, sourceId: "ewp-11-zh-2021", edition: 11, page: page.page };

describe("on-demand original source page", () => {
  it("does not mount an image or Viewer before opening, and unmounts it on close", async () => {
    const { container } = render(<KnowledgeOriginalPage {...props} />);
    const summary = screen.getByText("查看第11版原页（含图表）");
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
    expect(summary.className).toContain("min-h-11");
    fireEvent.click(summary);
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    expect(screen.getByRole("img").getAttribute("src")).toBe(`/${asset.asset_path}`);
    expect(screen.getByText(/第11版原书原页 · PDF 第 43 页 · ewp-11-zh-2021/)).toBeDefined();
    fireEvent.click(summary);
    await waitFor(() => expect(container.querySelector("img")).toBeNull());
  });

  it("opens the exact original page, closes on Escape, and returns focus to its trigger", async () => {
    render(<KnowledgeOriginalPage {...props} />);
    fireEvent.click(screen.getByText("查看第11版原页（含图表）"));
    const trigger = await screen.findByRole("button", { name: "放大查看：第11版原书 PDF 第 43 页" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("第11版原书 PDF 第 43 页");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "关闭图片查看器" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it.each([{ source_id: "ewp-10-zh-2016" }, { edition: 10 }, { pdf_page: 44 }, { figure_type: "book_figure" }])("rejects mismatched source/page/type metadata %j", (change) => {
    const { container } = render(<KnowledgeOriginalPage {...props} asset={{ ...asset, ...change }} />);
    expect(container.innerHTML).toBe("");
  });
});
