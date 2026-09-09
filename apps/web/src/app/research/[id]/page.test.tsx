import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ResearchDetail, { generateMetadata } from "./page";

const local = vi.hoisted(() => ({ read: vi.fn(), notFound: vi.fn(() => { throw new Error("LOCAL_NOT_FOUND"); }) }));
vi.mock("@/lib/tline/server", () => ({
  readResearch: local.read,
  LocalResearchNotFoundError: class LocalResearchNotFoundError extends Error { readonly status = 404; constructor() { super("LOCAL_READER_404"); } },
}));
vi.mock("next/navigation", () => ({ notFound: local.notFound }));

it("maps an absent local detail to the route 404", async () => {
  const { LocalResearchNotFoundError } = await import("@/lib/tline/server");
  local.read.mockRejectedValueOnce(new LocalResearchNotFoundError());
  await expect(ResearchDetail({ params: Promise.resolve({ id: "absent" }) })).rejects.toThrow("LOCAL_NOT_FOUND");
  expect(local.notFound).toHaveBeenCalledOnce();
});

it("renders saved detail without claiming a complete upstream document", async () => {
  local.read.mockResolvedValueOnce({ institutions: [], data: { id: "r1", title: { zh: "本地研报" }, analysis: { summary: { zh: "摘要" } } } });
  render(await ResearchDetail({ params: Promise.resolve({ id: "r1" }) }));
  expect(screen.getByRole("heading", { name: "本地研报" })).toBeTruthy();
  expect(screen.queryByText(/全文/)).toBeNull();
});

it.each([
  ["a/b", "/research/a%2Fb"],
  ["a?b", "/research/a%3Fb"],
  ["a#b", "/research/a%23b"],
])("encodes the research id %s as one canonical path segment", async (id, canonical) => {
  const metadata = await generateMetadata({ params: Promise.resolve({ id }) });

  expect(metadata.alternates).toMatchObject({ canonical });
  expect(metadata.openGraph).toMatchObject({ url: canonical, type: "article" });
});
