import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ResearchRefresh } from "./research-refresh";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
afterEach(() => { cleanup(); router.push.mockReset(); router.refresh.mockReset(); });

it("pushes a bounds-free target so refresh can include later local rows", () => {
  render(<ResearchRefresh href="/research?q=gold&institution=bank" alreadyLatest={false} />);
  fireEvent.click(screen.getByRole("button", { name: "刷新列表" }));
  expect(router.push).toHaveBeenCalledWith("/research?q=gold&institution=bank");
  expect(router.refresh).not.toHaveBeenCalled();
});

it("rerenders the server route when the latest target is already current", () => {
  render(<ResearchRefresh href="/research" alreadyLatest />);
  fireEvent.click(screen.getByRole("button", { name: "刷新列表" }));
  expect(router.refresh).toHaveBeenCalledOnce();
  expect(router.push).not.toHaveBeenCalled();
});
