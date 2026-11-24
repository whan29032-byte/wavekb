import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ExchangeAccountManager } from "./exchange-account-manager";

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

function response(payload: object, ok = true) {
  return Promise.resolve({ ok, status: ok ? 200 : 400, json: async () => payload });
}

describe("ExchangeAccountManager", () => {
  it("shows the provider-specific credential fields without exposing saved secrets", async () => {
    vi.stubGlobal("fetch", vi.fn(() => response({ connections: [] })));
    render(<ExchangeAccountManager actorId="owner" />);
    await screen.findByText("还没有连接交易账户");
    expect(screen.getByLabelText("API Key")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("交易平台"), { target: { value: "okx" } });
    expect(screen.getByLabelText("API Passphrase")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("交易平台"), { target: { value: "bitget" } });
    expect(screen.getByLabelText("API Passphrase")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("交易平台"), { target: { value: "bybit" } });
    expect(screen.queryByLabelText("API Passphrase")).toBeNull();
    fireEvent.change(screen.getByLabelText("交易平台"), { target: { value: "exness" } });
    expect(screen.getByLabelText("私钥（PEM）")).toBeTruthy();
    expect(screen.getByLabelText("交易账户 ID（每行一个）")).toBeTruthy();
    expect(document.body.textContent).not.toContain("saved-secret-value");
  });

  it("validates Exness, lets the user choose discovered accounts, and connects them together", async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => response({ connections: [] }))
      .mockImplementationOnce(() => response({ validation: { provider: "exness", accounts: [
        { external_account_ref: "ref-a", account_label: "主账户", account_identifier_mask: "••••2001", account_currency: "USD", products: ["cfd"], read_only_status: "verified" },
        { external_account_ref: "ref-b", account_label: "副账户", account_identifier_mask: "••••2002", account_currency: "USD", products: ["cfd"], read_only_status: "verified" },
      ] } }))
      .mockImplementationOnce(() => response({ connections: [
        { id: "c1", provider: "exness", credential_set_id: "s1", account_label: "主账户", account_identifier_mask: "••••2001", account_currency: "USD", products: ["cfd"], read_only_status: "verified", status: "active", public_enabled: false, last_synced_at: null, last_error_code: "" },
        { id: "c2", provider: "exness", credential_set_id: "s1", account_label: "副账户", account_identifier_mask: "••••2002", account_currency: "USD", products: ["cfd"], read_only_status: "verified", status: "active", public_enabled: false, last_synced_at: null, last_error_code: "" },
      ] }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ExchangeAccountManager actorId="owner" />);
    await screen.findByText("还没有连接交易账户");
    fireEvent.change(screen.getByLabelText("交易平台"), { target: { value: "exness" } });
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "exness-key" } });
    fireEvent.change(screen.getByLabelText("私钥（PEM）"), { target: { value: "private-key" } });
    fireEvent.change(screen.getByLabelText("交易账户 ID（每行一个）"), { target: { value: "exness-2001\nexness-2002" } });
    fireEvent.click(screen.getByLabelText(/确认已关闭交易和提现权限/));
    fireEvent.click(screen.getByRole("button", { name: "验证只读权限" }));
    await screen.findByText("选择要连接的账户");
    fireEvent.click(screen.getByLabelText(/主账户/));
    fireEvent.click(screen.getByLabelText(/副账户/));
    fireEvent.click(screen.getByRole("button", { name: "连接 2 个账户" }));
    await screen.findByText("已连接 2 个账户");
    const connectBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    expect(connectBody.selected_account_refs).toEqual(["ref-a", "ref-b"]);
    expect(connectBody.credentials.trading_scope).toBe("read_only");
    expect(screen.queryByDisplayValue("private-key")).toBeNull();
  });

  it("changes ranking visibility and disconnects one account without affecting another", async () => {
    const connections = [
      { id: "c1", provider: "binance", credential_set_id: "s1", account_label: "账户一", account_identifier_mask: "••••1001", account_currency: "USDT", products: ["usdt_perpetual"], read_only_status: "verified", status: "active", public_enabled: false, last_synced_at: null, last_error_code: "" },
      { id: "c2", provider: "okx", credential_set_id: "s2", account_label: "账户二", account_identifier_mask: "••••1002", account_currency: "USDT", products: ["usdt_perpetual"], read_only_status: "verified", status: "active", public_enabled: false, last_synced_at: null, last_error_code: "" },
    ];
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => response({ connections }))
      .mockImplementationOnce(() => response({ connection: { ...connections[0], public_enabled: true } }))
      .mockImplementationOnce(() => response({ connection: { ...connections[1], status: "disabled" } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ExchangeAccountManager actorId="owner" />);
    const first = await screen.findByTestId("exchange-connection-c1");
    const second = screen.getByTestId("exchange-connection-c2");
    fireEvent.click(within(first).getByRole("button", { name: "加入收益榜" }));
    await waitFor(() => expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/exchange/connections/c1/public"));
    fireEvent.click(within(second).getByRole("button", { name: "断开连接" }));
    await waitFor(() => expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/exchange/connections/c2/disconnect"));
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({ public_enabled: true, public_amounts_consent: true }));
  });

  it("reverifies a shared credential group from an existing account", async () => {
    const connection = { id: "c1", provider: "exness", account_label: "主账户", account_identifier_mask: "••••2001", account_currency: "USD", products: ["cfd"], read_only_status: "verified", capability_status: "ready", status: "active", public_enabled: false, last_synced_at: null, last_error_code: "" };
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => response({ connections: [connection] }))
      .mockImplementationOnce(() => response({ validation: { provider: "exness", accounts: [
        { external_account_ref: "ref-a", account_label: "主账户", account_identifier_mask: "••••2001", account_currency: "USD", products: ["cfd"], read_only_status: "verified" },
      ] } }))
      .mockImplementationOnce(() => response({ connections: [connection] }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ExchangeAccountManager actorId="owner" />);
    fireEvent.click(await screen.findByRole("button", { name: "更新 API" }));
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "new-key" } });
    fireEvent.change(screen.getByLabelText("私钥（PEM）"), { target: { value: "new-private" } });
    fireEvent.change(screen.getByLabelText("交易账户 ID（每行一个）"), { target: { value: "2001" } });
    fireEvent.click(screen.getByLabelText(/确认已关闭交易和提现权限/));
    fireEvent.click(screen.getByRole("button", { name: "验证只读权限" }));
    fireEvent.click(await screen.findByRole("button", { name: "更新这组凭证" }));
    await waitFor(() => expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/exchange/connections/c1/reverify"));
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)).credentials.privateKey).toBe("new-private");
  });

  it("starts an owner-scoped manual synchronization from an active account", async () => {
    const connection = { id: "c1", provider: "binance", account_label: "主账户", account_identifier_mask: "••••1001", account_currency: "USDT", products: ["usdt_perpetual"], read_only_status: "verified", capability_status: "ready", status: "active", public_enabled: false, last_synced_at: null, last_error_code: "" };
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => response({ connections: [connection] }))
      .mockImplementationOnce(() => response({ sync: { status: "published", connection_id: "c1", generation: 3 } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ExchangeAccountManager actorId="owner" />);
    fireEvent.click(await screen.findByRole("button", { name: "立即同步" }));
    await screen.findByText("交易记录已同步。");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/exchange/connections/c1/sync");
  });
});
