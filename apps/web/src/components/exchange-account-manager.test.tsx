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
    expect(screen.queryByLabelText(/Gateway Host/)).toBeNull();
    fireEvent.change(screen.getByLabelText("交易平台"), { target: { value: "exness" } });
    expect(screen.getByLabelText(/私钥/)).toBeTruthy();
    expect(screen.getByLabelText("交易账户 ID（每行一个）")).toBeTruthy();
    expect(screen.getByLabelText(/Gateway Host/)).toBeTruthy();
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
    fireEvent.change(screen.getByLabelText(/私钥/), { target: { value: "private-key" } });
    fireEvent.change(screen.getByLabelText("交易账户 ID（每行一个）"), { target: { value: "exness-2001\nexness-2002" } });
    fireEvent.change(screen.getByLabelText(/Gateway Host/), { target: { value: "https://gateway-region.exness.com" } });
    fireEvent.click(screen.getByLabelText(/确认已关闭交易和提现权限/));
    fireEvent.click(screen.getByRole("button", { name: "验证只读权限" }));
    await screen.findByText("选择要连接的账户");
    fireEvent.click(screen.getByLabelText(/主账户/));
    fireEvent.click(screen.getByLabelText(/副账户/));
    fireEvent.click(screen.getByRole("button", { name: "连接 2 个账户" }));
    await screen.findByText("已连接 2 个账户");
    const validateBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(validateBody.credentials.discoveryBaseUrl).toBe("https://gateway-region.exness.com");
    const connectBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    expect(connectBody.selected_account_refs).toEqual(["ref-a", "ref-b"]);
    expect(connectBody.credentials.trading_scope).toBe("read_only");
    expect(screen.queryByDisplayValue("private-key")).toBeNull();
  });

  it("does not add an Exness Gateway Host to other provider credentials", async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => response({ connections: [] }))
      .mockImplementationOnce(() => response({ validation: { provider: "binance", accounts: [] } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ExchangeAccountManager actorId="owner" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.change(document.querySelector("#exchange-api-key")!, { target: { value: "binance-key" } });
    fireEvent.change(document.querySelector("#exchange-secret-key")!, { target: { value: "binance-secret" } });
    fireEvent.click(document.querySelector('input[type="checkbox"]')!);
    fireEvent.submit(document.querySelector("form")!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const body = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(body.credentials.discoveryBaseUrl).toBeUndefined();
  });

  it.each([
    ["exness_invalid_api_key", "Exness API Key 无效或已过期，请重新生成后再试。"],
    ["exness_invalid_signature", "Exness 签名验证失败，请确认 API Key 与私钥来自同一组凭据。"],
    ["exness_permission_denied", "这组 API Key 没有访问该交易账户的只读权限。"],
    ["exness_rate_limited", "Exness 请求过于频繁，请稍后再试。"],
    ["exness_unavailable", "无法连接 Exness Gateway，请检查 Gateway Host 后重试。"],
    ["exness_invalid_private_key", "Exness 私钥格式或内容不正确，请粘贴完整的 128 位私钥或 PKCS#8 PEM。"],
    ["exness_invalid_account_ids", "Exness 交易账户 ID 只能填写数字，不要包含 #。"],
    ["exness_discovery_not_allowed", "请填写 Exness API 管理页 DNS Widget 中显示的 HTTPS Gateway Host。"],
  ])("shows an actionable message for %s", async (code, expected) => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => response({ connections: [] }))
      .mockImplementationOnce(() => response({ error: code }, false));
    vi.stubGlobal("fetch", fetchMock);
    render(<ExchangeAccountManager actorId="owner" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.change(document.querySelector("#exchange-provider")!, { target: { value: "exness" } });
    fireEvent.change(document.querySelector("#exchange-api-key")!, { target: { value: "exness-key" } });
    fireEvent.change(document.querySelector("#exchange-private-key")!, { target: { value: "private-key" } });
    fireEvent.change(document.querySelector("#exchange-account-ids")!, { target: { value: "18000046959" } });
    fireEvent.change(screen.getByLabelText(/Gateway Host/), { target: { value: "https://gateway-region.exness.com" } });
    fireEvent.click(document.querySelector('input[type="checkbox"]')!);
    fireEvent.submit(document.querySelector("form")!);
    expect(await screen.findByText(expected)).toBeTruthy();
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
    fireEvent.change(screen.getByLabelText(/私钥/), { target: { value: "new-private" } });
    fireEvent.change(screen.getByLabelText("交易账户 ID（每行一个）"), { target: { value: "2001" } });
    fireEvent.change(screen.getByLabelText(/Gateway Host/), { target: { value: "https://gateway-region.exness.com" } });
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
      .mockImplementationOnce(() => response({ sync: { status: "published", connection_id: "c1", generation: 3 } }))
      .mockImplementationOnce(() => response({ connections: [{ ...connection, last_synced_at: "2026-11-25T10:30:00.000Z" }] }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ExchangeAccountManager actorId="owner" />);
    fireEvent.click(await screen.findByRole("button", { name: "立即同步" }));
    await screen.findByText("交易记录已同步。");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/exchange/connections/c1/sync");
  });

  it("renders persisted synchronization health and keeps an unhealthy account retryable", async () => {
    const connection = {
      id: "c1",
      provider: "binance",
      account_label: "主账户",
      account_identifier_mask: "••••1001",
      account_currency: "USDT",
      products: ["usdt_perpetual"],
      read_only_status: "verified",
      capability_status: "ready",
      status: "active",
      public_enabled: false,
      last_synced_at: "2026-11-24T10:30:00.000Z",
      last_error_code: "binance_rate_limited",
    };
    vi.stubGlobal("fetch", vi.fn(() => response({ connections: [connection] })));

    render(<ExchangeAccountManager actorId="owner" />);

    const card = await screen.findByTestId("exchange-connection-c1");
    expect(within(card).getByText("同步异常")).toBeTruthy();
    expect(within(card).getByText("当前保留上次完整数据")).toBeTruthy();
    expect(within(card).getByText(/最后成功同步：/)).toBeTruthy();
    expect(within(card).getByText("Binance 请求过于频繁，请稍后再同步。")).toBeTruthy();
    expect((within(card).getByRole("button", { name: "立即同步" }) as HTMLButtonElement).disabled).toBe(false);
    expect((within(card).getByRole("button", { name: "加入收益榜" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("reloads persisted state after a failed manual sync and preserves its actionable error", async () => {
    const activeConnection = {
      id: "c1",
      provider: "binance",
      account_label: "主账户",
      account_identifier_mask: "••••1001",
      account_currency: "USDT",
      products: ["usdt_perpetual"],
      read_only_status: "verified",
      capability_status: "ready",
      status: "active",
      public_enabled: false,
      last_synced_at: "2026-11-24T10:30:00.000Z",
      last_error_code: "",
    };
    const failedConnection = {
      ...activeConnection,
      status: "error",
      last_error_code: "binance_rate_limited",
    };
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => response({ connections: [activeConnection] }))
      .mockImplementationOnce(() => response({ error: "binance_rate_limited" }, false))
      .mockImplementationOnce(() => response({ connections: [failedConnection] }));
    vi.stubGlobal("fetch", fetchMock);

    render(<ExchangeAccountManager actorId="owner" />);
    fireEvent.click(await screen.findByRole("button", { name: "立即同步" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/exchange/connections");
    const card = screen.getByTestId("exchange-connection-c1");
    expect(within(card).getByText("同步异常")).toBeTruthy();
    expect(within(card).getByText("Binance 请求过于频繁，请稍后再同步。")).toBeTruthy();
    expect((await screen.findByRole("alert")).textContent).toContain("Binance 请求过于频繁，请稍后再同步。");
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("keeps the sync failure visible when refreshing persisted state also fails", async () => {
    const connection = {
      id: "c1",
      provider: "binance",
      account_label: "主账户",
      account_identifier_mask: "••••1001",
      account_currency: "USDT",
      products: ["usdt_perpetual"],
      read_only_status: "verified",
      capability_status: "ready",
      status: "active",
      public_enabled: false,
      last_synced_at: null,
      last_error_code: "",
    };
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => response({ connections: [connection] }))
      .mockImplementationOnce(() => response({ error: "binance_rate_limited" }, false))
      .mockRejectedValueOnce(new Error("private refresh failure"));
    vi.stubGlobal("fetch", fetchMock);

    render(<ExchangeAccountManager actorId="owner" />);
    fireEvent.click(await screen.findByRole("button", { name: "立即同步" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Binance 请求过于频繁，请稍后再同步。");
    expect(alert.textContent).not.toContain("private refresh failure");
  });
});
