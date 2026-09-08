import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ExchangeConnectionPanel } from "./exchange-connection";

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

const connection = {
  id: "11111111-1111-4111-8111-111111111111",
  label: "币安 U 本位合约",
  exchange: "binance" as const,
  market: "usdm_futures" as const,
  public_enabled: true,
  public_amounts_consented: true,
  status: "active" as const,
  secret_mask: "••••ABCD",
  started_at: "2026-09-08T10:00:00.000Z",
  last_synced_at: "2026-09-08T12:00:00.000Z",
  last_error_code: "",
  consecutive_failures: 0,
};

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

it("refreshes the visible ranking after a successful manual snapshot sync", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ connection }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ connection }) });
  vi.stubGlobal("fetch", fetchMock);
  render(<ExchangeConnectionPanel actorId="owner" />);
  await screen.findByText("连接正常");
  fireEvent.click(screen.getByRole("button", { name: "立即同步" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("同步完成"));
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
});

it("refreshes the visible ranking as soon as a public API connection is created", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ connection: null }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ connection }) });
  vi.stubGlobal("fetch", fetchMock);
  render(<ExchangeConnectionPanel actorId="owner" />);
  await screen.findByRole("button", { name: "验证并开始跟踪" });
  expect(screen.getByText(/当前账户权益、累计盈利/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "a".repeat(20) } });
  fireEvent.change(screen.getByLabelText("Secret Key"), { target: { value: "b".repeat(20) } });
  fireEvent.click(screen.getByText(/我确认这是一组专用观察 API/));
  const publicCheckbox = screen.getByRole("checkbox", { name: /当前账户权益、累计盈利/ }) as HTMLInputElement;
  expect(publicCheckbox.checked).toBe(false);
  fireEvent.click(publicCheckbox);
  fireEvent.submit(screen.getByRole("button", { name: "验证并开始跟踪" }).closest("form")!);
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("加入实时排行榜"));
  const submitted = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
  expect(submitted.public_enabled).toBe(true);
  expect(submitted.public_amounts_consent).toBe(true);
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
});

it("lets an existing private connection explicitly consent without re-entering API keys", async () => {
  const privateConnection = { ...connection, public_enabled: false, public_amounts_consented: false };
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ connection: privateConnection }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ connection }) });
  vi.stubGlobal("fetch", fetchMock);
  render(<ExchangeConnectionPanel actorId="owner" />);
  fireEvent.click(await screen.findByRole("button", { name: "同意公开金额并加入排行" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("加入实时排行榜"));
  expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/exchange/connection/public");
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
});
