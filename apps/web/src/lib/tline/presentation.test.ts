import { expect, it } from "vitest";
import { researchView, researchWindow } from "./presentation";

it("prefers Chinese research text and uses institution directory fallback", () => {
  expect(researchView({ id: "r1", title: { zh: "中文标题", en: "English" }, institution: { slug: "bank" }, analysis: { summary: { en: "Summary" }, keyArguments: { zh: ["论点"] }, risks: { en: ["Risk"] }, keyNumbers: { zh: [{ label: "就业", value: "16.2万" }] } }, sourceUrl: "javascript:alert(1)" }, [{ slug: "bank", name: "机构名" }])).toMatchObject({ title: "中文标题", institution: "机构名", summary: "Summary", arguments: ["论点"], risks: ["Risk"], numbers: [{ label: "就业", value: "16.2万" }], sourceUrl: null });
});

it("does not coerce object fields into UI text or fabricate a missing date", () => {
  expect(researchView({ id: "r", title: {}, institution: {}, publishedAt: "bad-date", analysis: { summary: 123 } }, [])).toMatchObject({ title: "未提供标题", institution: "未提供机构", date: null, summary: "" });
});

it("holds the original since across pages and bounds user-supplied windows", () => {
  const now = Date.parse("2026-09-05T12:00:24Z");
  expect(researchWindow({}, now)).toEqual({ since: "2026-08-29T12:00:00.000Z", cursor: undefined });
  expect(researchWindow({ since: "2026-08-29T12:00:00.000Z", cursor: "opaque+cursor" }, now)).toEqual({ since: "2026-08-29T12:00:00.000Z", cursor: "opaque+cursor" });
  expect(() => researchWindow({ cursor: "opaque" }, now)).toThrow();
  expect(() => researchWindow({ since: "1999-01-01T00:00:00Z" }, now)).toThrow();
  expect(() => researchWindow({ since: ["a", "b"] }, now)).toThrow();
});
