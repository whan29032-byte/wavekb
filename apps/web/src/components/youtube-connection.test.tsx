import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { YoutubeConnectionPanel } from "./youtube-connection";
import type { YoutubeConnection } from "@/lib/youtube/contracts";

const connection: YoutubeConnection = { id: "11111111-1111-4111-8111-111111111111", channelId: "UCabcdefghijklmnopqrstuv", channelTitle: "结构研究频道", syncEnabled: false, importHistory: true, historyStatus: "complete", historyImported: 42, status: "connected", lastSyncedAt: "2026-10-08T09:00:00Z", lastErrorCode: null };
const state = "a".repeat(43);
const authorizationUrl = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&scope=${encodeURIComponent("https://www.googleapis.com/auth/youtube.readonly")}&state=${state}`;
const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); window.history.replaceState({}, "", "/member/profile"); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
const response = (body: object, status = 200) => new Response(JSON.stringify(body), { status });

describe("YouTube connection consent and truthful status", () => {
  it("keeps Google binding disabled without configuration and does not contact Google", async () => {
    fetchMock.mockResolvedValue(response({ configured: false, connection: null }));
    render(<YoutubeConnectionPanel actorId="owner" />);
    expect(await screen.findByText("Google 授权尚未配置")).toBeDefined();
    const button = screen.getByRole("button", { name: "通过 Google 只读授权绑定" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true); fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/youtube/connection");
    expect(screen.queryByText("已通过 Google 授权")).toBeNull();
  });
  it("defaults history on and ongoing posting consent off, then passes explicit choices without claiming connected", async () => {
    fetchMock.mockResolvedValue(response({ authorizationUrl })); const navigate = vi.fn();
    render(<YoutubeConnectionPanel actorId="owner" initialStatus={{ configured: true, connection: null }} onAuthorizeNavigate={navigate} />);
    const checks = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(checks[0].checked).toBe(true); expect(checks[1].checked).toBe(false);
    fireEvent.click(checks[0]); fireEvent.click(checks[1]);
    fireEvent.click(screen.getByRole("button", { name: "通过 Google 只读授权绑定" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(authorizationUrl));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ importHistory: false, autoSync: true });
    expect(screen.queryByText("已通过 Google 授权")).toBeNull();
  });
  it("displays actual channel history progress and never presents pending as complete", () => {
    render(<YoutubeConnectionPanel actorId="owner" initialStatus={{ configured: true, connection: { ...connection, historyStatus: "running", historyImported: 12, lastSyncedAt: null } }} />);
    expect(screen.getByText("已通过 Google 授权")).toBeDefined();
    expect(screen.getByText(/正在导入历史视频/)).toBeDefined(); expect(screen.getByText("12")).toBeDefined();
    expect(screen.getByText("尚未完成首次同步")).toBeDefined();
    expect((screen.getByRole("button", { name: "补导历史视频" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("resumes only after an explicit action and uses backend status", async () => {
    fetchMock.mockResolvedValue(response({ connection: { ...connection, syncEnabled: true } }));
    render(<YoutubeConnectionPanel actorId="owner" initialStatus={{ configured: true, connection }} />);
    fireEvent.click(screen.getByRole("button", { name: "恢复新视频同步" }));
    await screen.findByRole("button", { name: "暂停新视频同步" });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/youtube/settings"); expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ syncEnabled: true });
  });
  it("does not disconnect when destructive confirmation is rejected", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<YoutubeConnectionPanel actorId="owner" initialStatus={{ configured: true, connection }} />);
    fireEvent.click(screen.getByRole("button", { name: "解绑并移除同步帖子" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/移除.*同步生成的帖子.*手工发布.*不会被删除/)); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("confirms removing only sync-generated posts and does not pretend success on a failed request", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true); fetchMock.mockResolvedValue(response({ error: "youtube_request_failed" }, 503));
    render(<YoutubeConnectionPanel actorId="owner" initialStatus={{ configured: true, connection }} />);
    fireEvent.click(screen.getByRole("button", { name: "解绑并移除同步帖子" }));
    await screen.findByRole("alert"); expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ confirmRemoveSyncedPosts: true });
    expect(screen.getByText("结构研究频道")).toBeDefined(); expect(screen.queryByText(/已解绑，/)).toBeNull();
  });
  it("keeps existing connections visible and removable when new binding is disabled", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fetchMock.mockResolvedValueOnce(response({ disconnected: true, removedPosts: 42, remoteRevocationPending: false }));
    fetchMock.mockResolvedValueOnce(response({ configured: false, connection: null }));
    render(<YoutubeConnectionPanel actorId="owner" initialStatus={{ configured: false, connection }} />);
    expect(screen.getByText("结构研究频道")).toBeDefined();
    expect((screen.getByRole("button", { name: "恢复新视频同步" }) as HTMLButtonElement).disabled).toBe(true);
    const remove = screen.getByRole("button", { name: "解绑并移除同步帖子" }) as HTMLButtonElement;
    expect(remove.disabled).toBe(false); fireEvent.click(remove);
    await screen.findByText(/已解绑，移除了 42/);
    expect(screen.queryByText("结构研究频道")).toBeNull();
    expect((screen.getByRole("button", { name: "通过 Google 只读授权绑定" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("does not claim Google revocation completed when only site data has been removed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fetchMock.mockResolvedValueOnce(response({ disconnected: true, removedPosts: 42, remoteRevocationPending: true }));
    fetchMock.mockResolvedValueOnce(response({ configured: true, connection: { ...connection, channelId: "", channelTitle: "", status: "revocation_pending", syncEnabled: false, lastErrorCode: "youtube_revocation_pending" } }));
    render(<YoutubeConnectionPanel actorId="owner" initialStatus={{ configured: true, connection }} />);
    fireEvent.click(screen.getByRole("button", { name: "解绑并移除同步帖子" }));
    await screen.findByText("Google 授权撤销处理中");
    expect(screen.getByText(/站内已解除，移除了 42/)).toBeDefined();
    expect(screen.queryByText(/已解绑，/)).toBeNull();
    expect(screen.queryByRole("button", { name: "恢复新视频同步" })).toBeNull();
    expect(screen.queryByRole("button", { name: "通过 Google 只读授权绑定" })).toBeNull();
    expect(screen.getByRole("link", { name: "在 Google 安全页检查授权" }).getAttribute("href")).toBe("https://myaccount.google.com/permissions");
    expect(screen.getByRole("button", { name: "重试撤销 Google 授权" })).toBeDefined();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getByText("YouTube 连接")).toBeDefined();
    expect(screen.queryByRole("link", { name: "查看频道" })).toBeNull();
  });
  it("shows a neutral channel title when its cached metadata has expired", () => {
    render(<YoutubeConnectionPanel actorId="owner" initialStatus={{ configured: true, connection: { ...connection, channelTitle: "" } }} />);
    expect(screen.getByText("YouTube 连接")).toBeDefined();
    expect(screen.getByRole("link", { name: "查看频道" }).getAttribute("href")).toBe(`https://www.youtube.com/channel/${connection.channelId}`);
  });
  it("shows a manual Google revocation step instead of re-binding after the retry deadline", () => {
    render(<YoutubeConnectionPanel actorId="owner" initialStatus={{ configured: true, connection: { ...connection, status: "reconnect_required", lastErrorCode: "youtube_manual_revocation_required" } }} />);
    expect(screen.getByRole("alert").textContent).toContain("Google 安全页");
    expect(screen.getByRole("link", { name: "在 Google 安全页检查授权" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "重新通过 Google 授权" })).toBeNull();
  });
  it("shows explicit history and ongoing posting consent again for reconnection", () => {
    render(<YoutubeConnectionPanel actorId="owner" initialStatus={{ configured: true, connection: { ...connection, status: "reconnect_required", lastErrorCode: "youtube_reconnect_required" } }} />);
    const checks = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(checks[0].checked).toBe(true); expect(checks[1].checked).toBe(false);
    expect(screen.getByRole("button", { name: "重新通过 Google 授权" })).toBeDefined();
  });
  it("imports history only on an explicit request and keeps progress from its response", async () => {
    fetchMock.mockResolvedValue(response({ connection: { ...connection, historyStatus: "pending", historyImported: 42 } }));
    render(<YoutubeConnectionPanel actorId="owner" initialStatus={{ configured: true, connection }} />);
    fireEvent.click(screen.getByRole("button", { name: "补导历史视频" }));
    await screen.findByText(/历史视频导入已排队/); expect(fetchMock.mock.calls[0][0]).toBe("/api/youtube/import-history");
    expect(screen.queryByText(/历史导入完成/)).toBeNull();
  });
  it("does not let a connected query parameter fabricate a binding", async () => {
    window.history.replaceState({}, "", "/member/profile?youtube=connected");
    fetchMock.mockResolvedValue(response({ configured: true, connection: null }));
    render(<YoutubeConnectionPanel actorId="owner" />);
    await screen.findByRole("button", { name: "通过 Google 只读授权绑定" }); expect(screen.queryByText("已通过 Google 授权")).toBeNull();
  });
  it.each([
    ["youtube_channel_selection_required", "多个频道"],
    ["youtube_refresh_token_missing", "后台续期授权"],
    ["youtube_state_invalid", "授权会话已失效"],
    ["secret-oauth-code-and-token", "操作尚未完成"],
  ])("shows only a safe actionable OAuth failure for %s", async (code, expected) => {
    window.history.replaceState({}, "", `/member/profile?youtube=error&youtube_error=${code}`);
    render(<YoutubeConnectionPanel actorId="owner" initialStatus={{ configured: true, connection: null }} />);
    expect((await screen.findByRole("alert")).textContent).toContain(expected);
    expect(screen.queryByText("secret-oauth-code-and-token")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("makes clear that pausing new videos does not withdraw separate history import consent", async () => {
    fetchMock.mockResolvedValue(response({ connection: { ...connection, historyStatus: "running", syncEnabled: false } }));
    render(<YoutubeConnectionPanel actorId="owner" initialStatus={{ configured: true, connection: { ...connection, historyStatus: "running", syncEnabled: true } }} />);
    fireEvent.click(screen.getByRole("button", { name: "暂停新视频同步" }));
    await screen.findByText(/已暂停新视频同步；已请求的历史导入仍继续/);
    expect(screen.getByText(/正在导入历史视频/)).toBeDefined();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ syncEnabled: false });
  });
  it("resets cached owner data when the signed-in account changes", async () => {
    fetchMock.mockResolvedValue(response({ configured: true, connection: null }));
    const view = render(<YoutubeConnectionPanel actorId="first" initialStatus={{ configured: true, connection }} />);
    expect(screen.getByText("结构研究频道")).toBeDefined();
    view.rerender(<YoutubeConnectionPanel actorId="second" />);
    expect(screen.queryByText("结构研究频道")).toBeNull();
    await screen.findByRole("button", { name: "通过 Google 只读授权绑定" });
  });
  it("preview fixtures never trigger requests, polls or OAuth", async () => {
    vi.useFakeTimers(); render(<YoutubeConnectionPanel actorId="owner" initialStatus={{ configured: true, connection }} preview />);
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(fetchMock).not.toHaveBeenCalled(); expect((screen.getByRole("button", { name: "恢复新视频同步" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("note").textContent).toContain("不代表真实 OAuth");
  });
});
