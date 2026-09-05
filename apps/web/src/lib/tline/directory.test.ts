import { expect, it } from "vitest";
import { directoryQuery, researchDirectory } from "./directory";

const rows = Array.from({ length: 65 }, (_, index) => ({
  id: String(index), title: { zh: `研报 ${index}`, en: `Report ${index}` },
  institution: { slug: index === 64 ? "bank-b" : "bank-a", name: index === 64 ? "机构乙" : "机构甲" },
  analysis: { summary: { zh: index === 64 ? "黄金风险分析" : "市场分析" } },
  assets: index === 64 ? [{ ticker: "XAUUSD", name: "黄金" }] : [],
}));

it("splits the complete result into 30-item pages without dropping boundary records", () => {
  const first = researchDirectory(rows, [], { q: "", institution: "", page: 1 });
  const second = researchDirectory(rows, [], { q: "", institution: "", page: 2 });
  const last = researchDirectory(rows, [], { q: "", institution: "", page: 3 });
  expect(first.items.map((item) => item.id)).toEqual(Array.from({ length: 30 }, (_, i) => String(i)));
  expect(second.items[0].id).toBe("30"); expect(second.items).toHaveLength(30);
  expect(last.items.map((item) => item.id)).toEqual(["60", "61", "62", "63", "64"]);
  expect(last.total).toBe(65); expect(last.pages).toBe(3);
});

it.each(["黄金", "xauusd", "机构乙", "REPORT 64"])("searches beyond the first page for %s", (q) => {
  const result = researchDirectory(rows, [], { q, institution: "", page: 1 });
  expect(result.items.map((item) => item.id)).toEqual(["64"]);
});

it("combines institution and text filters, deduplicates IDs, and recovers an empty or out-of-range page", () => {
  expect(researchDirectory([...rows, rows[64]], [], { q: "黄金", institution: "bank-b", page: 1 }).total).toBe(1);
  expect(researchDirectory(rows, [], { q: "黄金", institution: "bank-a", page: 1 })).toMatchObject({ total: 0, page: 1, pages: 1, items: [] });
  expect(researchDirectory(rows, [], { q: "黄金", institution: "bank-b", page: 3 })).toMatchObject({ total: 1, page: 1 });
});

it("normalizes bounded search input and rejects malformed query arrays and page numbers", () => {
  expect(directoryQuery({ q: "  黄金  ", page: "2" })).toEqual({ q: "黄金", institution: "", page: 2 });
  for (const query of [{ q: ["x"] }, { q: "x".repeat(201) }, { page: "-1" }, { page: "1.2" }, { page: "1e2" }, { page: "999999999999" }, { institution: ["bank"] }]) {
    expect(() => directoryQuery(query)).toThrow();
  }
});
