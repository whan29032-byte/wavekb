import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Pagination } from "./pagination";

afterEach(cleanup);
describe("pagination controls", () => {
  it("offers both directions with independent filter-preserving URLs", () => {
    render(<Pagination page={2} hasNext pathname="/workbench" query={{ type: "review", page: 5 }} pageKey="analysisPage" />);
    expect(screen.getByRole("link", { name: "上一页" }).getAttribute("href")).toBe("/workbench?type=review&page=5");
    expect(screen.getByRole("link", { name: "下一页" }).getAttribute("href")).toBe("/workbench?type=review&page=5&analysisPage=3");
  });
  it("does not link before the first page or past the final page", () => {
    render(<Pagination page={1} hasNext={false} pathname="/workbench" />);
    expect(screen.queryByRole("link")).toBeNull();
  });
  it("lets users leave an empty out-of-range page", () => {
    render(<Pagination page={10} hasNext={false} pathname="/workbench" />);
    expect(screen.getByRole("link", { name: "上一页" }).getAttribute("href")).toBe("/workbench?page=9");
    expect(screen.queryByRole("link", { name: "下一页" })).toBeNull();
  });
});
