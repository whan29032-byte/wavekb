import { describe, expect, it } from "vitest";
import { pageRange, paginationHref, parsePage } from "./pagination";

describe("pagination input and ranges", () => {
  it.each([[undefined, 1], ["", 1], ["-2", 1], ["0", 1], ["1.5", 1], ["1e2", 1], [["2", "3"], 1], ["99999999999999999999", 1], ["3", 3], [4, 4]])("normalizes %j to %i", (input, expected) => {
    expect(parsePage(input)).toBe(expected);
  });
  it("calculates nonoverlapping inclusive database ranges", () => {
    expect(pageRange(1, 20)).toEqual({ from: 0, to: 19 });
    expect(pageRange(2, 20)).toEqual({ from: 20, to: 39 });
    expect(pageRange(6, 20)).toEqual({ from: 100, to: 119 });
  });
  it("preserves encoded filters and another list's page while replacing its own page", () => {
    expect(paginationHref("/workbench", 3, { type: "review", analysisPage: 2, page: 8, q: "浪 & 级别" })).toBe("/workbench?type=review&analysisPage=2&page=3&q=%E6%B5%AA+%26+%E7%BA%A7%E5%88%AB");
    expect(paginationHref("/workbench", 1, { type: "journal", analysisPage: 4 }, "analysisPage")).toBe("/workbench?type=journal");
  });
});
