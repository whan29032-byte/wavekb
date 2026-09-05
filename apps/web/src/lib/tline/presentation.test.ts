import { expect, it } from "vitest";
import { researchView, researchWindow } from "./presentation";

it("prefers Chinese research text and uses institution directory fallback", () => {
  expect(researchView({ id: "r1", title: { zh: "中文标题", en: "English" }, institution: { slug: "bank" }, analysis: { summary: { en: "Summary" }, keyArguments: { zh: ["论点"] }, risks: { en: ["Risk"] }, keyNumbers: { zh: [{ label: "就业", value: "16.2万" }] } }, sourceUrl: "javascript:alert(1)" }, [{ slug: "bank", name: "机构名" }])).toMatchObject({ title: "中文标题", institution: "机构名", summary: "Summary", arguments: ["论点"], risks: ["Risk"], numbers: [{ label: "就业", value: "16.2万" }], sourceUrl: null });
});

it("does not coerce object fields into UI text or fabricate a missing date", () => {
  expect(researchView({ id: "r", title: {}, institution: {}, publishedAt: "bad-date", analysis: { summary: 123 } }, [])).toMatchObject({ title: "未提供标题", institution: "未提供机构", date: null, summary: "" });
});

it("anchors the default seven-day window to the last successful local sync", () => {
  expect(researchWindow({}, "2026-09-05T11:55:00.000Z", Date.parse("2026-09-05T12:00:24Z"))).toEqual({
    since: "2026-08-29T11:55:00.000Z",
    until: "2026-09-05T11:55:00.000Z",
  });
  expect(researchWindow({}, "2026-09-06T00:00:00.000Z", Date.parse("2026-09-05T12:00:24Z"))).toEqual({
    since: "2026-08-29T12:00:24.000Z",
    until: "2026-09-05T12:00:24.000Z",
  });
});

it("accepts a bounded legacy since once, derives until, and then preserves both", () => {
  const now = Date.parse("2026-09-05T12:00:00Z");
  expect(researchWindow({ since: "2026-08-29T12:00:00.000Z" }, "2026-09-05T11:55:00.000Z", now)).toEqual({
    since: "2026-08-29T12:00:00.000Z",
    until: "2026-09-05T11:55:00.000Z",
  });
  expect(researchWindow({ since: "2026-08-29T12:00:00.000Z", until: "2026-09-05T11:55:00.000Z" }, "2026-09-05T11:55:00.000Z", now)).toEqual({
    since: "2026-08-29T12:00:00.000Z",
    until: "2026-09-05T11:55:00.000Z",
  });
});

it("permits the last-good stale window while rejecting expired and malformed windows", () => {
  const now = Date.parse("2026-09-05T12:00:00Z");
  expect(researchWindow({}, "2026-08-20T09:00:00.000Z", now)).toEqual({ since: "2026-08-13T09:00:00.000Z", until: "2026-08-20T09:00:00.000Z" });
  expect(researchWindow({ since: "2026-08-13T09:00:00.000Z", until: "2026-08-20T09:00:00.000Z" }, "2026-08-20T09:00:00.000Z", now)).toEqual({ since: "2026-08-13T09:00:00.000Z", until: "2026-08-20T09:00:00.000Z" });
  for (const query of [
    { since: "1999-01-01T00:00:00Z", until: "1999-01-08T00:00:00Z" },
    { since: ["a", "b"] },
    { since: "2026-09-01T00:00:00Z", until: "2026-09-09T00:00:01Z" },
    { since: "invalid", until: "2026-09-05T00:00:00Z" },
    { until: "2026-09-05T00:00:00Z" },
  ] as Array<Record<string, string | string[] | undefined>>) expect(() => researchWindow(query, "2026-09-05T11:55:00.000Z", now)).toThrow(/时间窗口/);
});
