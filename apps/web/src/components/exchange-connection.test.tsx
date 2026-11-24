import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ExchangeConnectionPanel } from "./exchange-connection";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

it("keeps the legacy export wired to the multi-account manager", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ connections: [] }) }));
  render(<ExchangeConnectionPanel actorId="owner" />);
  expect(await screen.findByRole("heading", { name: "交易账户连接" })).toBeTruthy();
  expect(screen.getByLabelText("交易平台")).toBeTruthy();
  expect(screen.getByText("还没有连接交易账户")).toBeTruthy();
});
