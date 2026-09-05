import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ResearchArticle, ResearchList } from "./research-list";
import { researchView } from "@/lib/tline/presentation";

afterEach(cleanup);
const item = researchView({ id: "report-1", title: { zh: "测试研报" }, institution: { name: "测试机构" }, publishedAt: "2026-09-05T01:00:00Z", analysis: { summary: { zh: "真实响应形状的摘要" }, keyArguments: { zh: ["第一条论点"] }, risks: { zh: ["风险一"] } }, sourceUrl: "https://example.test/report" }, []);

it("links reports inside WaveKB and displays institution, date and summary", () => {
  render(<ResearchList items={[item]} />);
  expect(screen.getByRole("link", { name: "测试研报" }).getAttribute("href")).toBe("/research/report-1");
  expect(screen.getByText("测试机构")).toBeDefined(); expect(screen.getByText("真实响应形状的摘要")).toBeDefined();
  expect(document.querySelector("time")?.dateTime).toBe("2026-09-05T01:00:00.000Z");
});

it("renders API prose as text and source verification links safely", () => {
  render(<ResearchArticle item={{ ...item, summary: '<img src=x onerror="alert(1)">' }} />);
  expect(document.querySelector("img")).toBeNull();
  expect(screen.getByRole("heading", { name: "核心论点" })).toBeDefined();
  expect(screen.getByText("风险一")).toBeDefined();
  const source = screen.getByRole("link", { name: "核对机构原文" });
  expect(source.getAttribute("target")).toBe("_blank"); expect(source.getAttribute("rel")).toContain("noopener");
});

it("shows an explicit empty state with no invented rows", () => {
  render(<ResearchList items={[]} />);
  expect(screen.getByText(/当前页没有研报/)).toBeDefined();
  expect(screen.queryAllByRole("article")).toHaveLength(0);
});
