import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrivateEntry } from "@wavekb/domain";
import { PrivateEntryEditor } from "./private-entry-editor";
import { installBrowserStorage } from "@/test/browser-storage";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
beforeEach(() => { installBrowserStorage(); document.documentElement.dataset.wavekbMode = "light"; });
afterEach(cleanup);
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const key = "wavekb:next:private-entry:owner:record";
const record: PrivateEntry = {
  id: "record", owner_id: "owner", kind: "review", title: "服务器标题", body: "服务器正文", instrument: "BTCUSDT", market: "加密", timeframe: "4小时",
  tags: [], knowledge_ids: [], workbench_analysis_id: null, review_data: { editor_mode: "professional" },
  created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z", deleted_at: null, private_entry_images: [],
};

describe("private record local recovery", () => {
  it("restores every editable review field and chart configuration for an existing record", async () => {
    const mounted = render(<PrivateEntryEditor actorId="owner" entry={record} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    change("标题", "未提交标题"); change("正文", "未提交正文"); change("最终结果", "loss"); change("数浪结果", "alternate");
    change("规则遵守", "no"); change("执行纪律", "2"); change("本次经验与下次改进", "等待确认"); change("关联知识 ID", "unit-impulse");
    change("图表链接或品种代码", "BINANCE:BTCUSDT"); change("图表周期", "240"); change("图表主题", "light");
    fireEvent.click(screen.getByRole("button", { name: "刷新图表" }));
    await waitFor(() => expect(localStorage.getItem(key)).toContain("未提交标题"));
    mounted.unmount(); render(<PrivateEntryEditor actorId="owner" entry={record} />);
    await waitFor(() => expect((screen.getByLabelText("标题") as HTMLInputElement).value).toBe("未提交标题"));
    for (const [label, value] of [["正文", "未提交正文"], ["最终结果", "loss"], ["数浪结果", "alternate"], ["规则遵守", "no"], ["执行纪律", "2"], ["本次经验与下次改进", "等待确认"], ["关联知识 ID", "unit-impulse"], ["图表链接或品种代码", "BINANCE:BTCUSDT"], ["图表周期", "240"], ["图表主题", "light"]]) {
      expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe(value);
    }
    expect(screen.getByText(/已恢复.*本地草稿/)).toBeDefined();
  });

  it("preserves mode and fields even if a new record has no title or body", async () => {
    const mounted = render(<PrivateEntryEditor actorId="owner" />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent.click(screen.getByRole("tab", { name: "专业复盘" })); change("最终结果", "win");
    change("记录类型", "journal");
    await waitFor(() => expect(localStorage.getItem("wavekb:next:private-entry:owner:review")).toContain("win"));
    mounted.unmount(); render(<PrivateEntryEditor actorId="owner" />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "专业复盘" }).getAttribute("aria-selected")).toBe("true"));
    expect((screen.getByLabelText("记录类型") as HTMLSelectElement).value).toBe("journal");
    change("记录类型", "review");
    expect((screen.getByLabelText("最终结果") as HTMLSelectElement).value).toBe("win");
  });

  it("keeps a conflicting draft without silently replacing a newer server record", async () => {
    localStorage.setItem(key, JSON.stringify({ title: "旧设备编辑", body: "本地正文", baseUpdatedAt: "2026-07-01T00:00:00Z", savedAt: "2026-09-01T00:00:00Z" }));
    render(<PrivateEntryEditor actorId="owner" entry={record} />);
    await screen.findByText(/服务器记录已更新/);
    expect((screen.getByLabelText("标题") as HTMLInputElement).value).toBe("服务器标题");
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(localStorage.getItem(key)).toContain("旧设备编辑");
    fireEvent.click(screen.getByRole("button", { name: "恢复本地草稿" }));
    expect((screen.getByLabelText("标题") as HTMLInputElement).value).toBe("旧设备编辑");
  });

  it("does not restore another owner's local edits", async () => {
    localStorage.setItem(key, JSON.stringify({ title: "私人未提交内容", savedAt: "2026-09-01" }));
    render(<PrivateEntryEditor actorId="other" />);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect((screen.getByLabelText("标题") as HTMLInputElement).value).toBe("");
  });

  it("does not resurrect an abandoned edit after all values are reverted", async () => {
    const mounted = render(<PrivateEntryEditor actorId="owner" entry={record} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    change("标题", "临时修改");
    await waitFor(() => expect(localStorage.getItem(key)).toContain("临时修改"));
    change("标题", "服务器标题");
    mounted.unmount(); render(<PrivateEntryEditor actorId="owner" entry={record} />);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect((screen.getByLabelText("标题") as HTMLInputElement).value).toBe("服务器标题");
  });

  it("prevents editing unresolved conflicts and keeps the server version when chosen", async () => {
    localStorage.setItem(key, JSON.stringify({ title: "旧设备编辑", baseUpdatedAt: "old" }));
    render(<PrivateEntryEditor actorId="owner" entry={record} />);
    await screen.findByRole("button", { name: "保留服务器内容" });
    expect((screen.getByLabelText("标题") as HTMLInputElement).matches(":disabled")).toBe(true);
    expect((screen.getByRole("button", { name: "保存私人记录" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "保留服务器内容" }));
    expect(localStorage.getItem(key)).toBeNull();
    expect((screen.getByLabelText("标题") as HTMLInputElement).value).toBe("服务器标题");
    expect((screen.getByLabelText("标题") as HTMLInputElement).matches(":disabled")).toBe(false);
  });

  it("shows storage failures without crashing or claiming local protection", async () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("quota exceeded"); });
    render(<PrivateEntryEditor actorId="owner" />);
    await new Promise((resolve) => setTimeout(resolve, 20)); change("标题", "需要保护");
    expect(await screen.findByText(/本地草稿未能保存/)).toBeDefined();
  });

  it("recovers saved image removal choices without caching expiring signed URLs", async () => {
    const withImage: PrivateEntry = { ...record, private_entry_images: [{ id: "image", entry_id: "record", owner_id: "owner", storage_path: "owner/record/image.png", sort_order: 0, created_at: "2026-08-01", signed_url: "https://example.test/signed-secret" }] };
    const mounted = render(<PrivateEntryEditor actorId="owner" entry={withImage} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent.click(screen.getByRole("button", { name: "移除已保存图片 1" }));
    await waitFor(() => expect(localStorage.getItem(key)).toContain('"keptImageIds":[]'));
    expect(localStorage.getItem(key)).not.toContain("signed-secret");
    mounted.unmount(); render(<PrivateEntryEditor actorId="owner" entry={withImage} />);
    await screen.findByText(/已恢复.*本地草稿/);
    expect(screen.queryByAltText("已保存图片 1")).toBeNull();
  });

  it("does not expose the previously mounted account's record after an account switch", () => {
    const mounted = render(<PrivateEntryEditor actorId="owner" entry={record} />);
    mounted.rerender(<PrivateEntryEditor actorId="other" entry={record} />);
    expect(screen.queryByDisplayValue("服务器正文")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("无法读取");
  });
});

describe("analysis review and chart context", () => {
  it("shows saved analysis context read-only and migrates historical lessons", async () => {
    render(<PrivateEntryEditor actorId="owner" entry={{ ...record, review_data: { editor_mode: "professional", lessons: "历史经验", analysis_snapshot: { instrument: "TEST:SNAPSHOT", primary_timeframe: "4小时", step_data: { "8": { stop_loss: "95" } } } } }} />);
    expect((screen.getByLabelText("本次经验与下次改进") as HTMLTextAreaElement).value).toBe("历史经验");
    expect(screen.getByRole("region", { name: "原始分析快照" }).textContent).toContain("TEST:SNAPSHOT");
    expect(screen.getByRole("region", { name: "原始分析快照" }).textContent).toContain("95");
  });

  it("follows site appearance and offers a chart fallback even when embedding fails", async () => {
    const tradingview = { version: 1, provider: "tradingview", chart_url: "https://www.tradingview.com/chart/test/", symbol: "BINANCE:BTCUSDT", interval: "240", theme: "auto", imported_at: "2026-01-01", layout: null };
    render(<PrivateEntryEditor actorId="owner" entry={{ ...record, review_data: { editor_mode: "professional", tradingview } }} />);
    const frame = screen.getByTitle("BINANCE:BTCUSDT 图表");
    await waitFor(() => expect(frame.getAttribute("src")).toContain("theme=light"));
    // Flush the MutationObserver-driven render and its new iframe listener
    // before emitting an error for that source; src alone precedes effects.
    await act(async () => { document.documentElement.dataset.wavekbMode = "dark"; });
    await waitFor(() => expect(frame.getAttribute("src")).toContain("theme=dark"));
    fireEvent.error(frame);
    expect(screen.getByText(/图表加载失败/)).toBeDefined();
    expect(screen.getByRole("link", { name: "在 TradingView 查看此图表" }).getAttribute("href")).toBe("https://www.tradingview.com/chart/test/");
  });

  it("does not substitute an unrelated stock when a saved layout has no symbol", () => {
    render(<PrivateEntryEditor actorId="owner" entry={{ ...record, review_data: { editor_mode: "professional", tradingview: { version: 1, provider: "tradingview", chart_url: "https://www.tradingview.com/chart/layout/", symbol: "", interval: "D", theme: "auto", layout: { content: { drawings: [{ name: "wave count" }] } } } } }} />);
    expect(screen.queryByTitle("TradingView 图表")).toBeNull();
    expect(screen.getByText(/未提供品种代码/)).toBeDefined();
    expect(screen.getByRole("link", { name: "在 TradingView 查看此图表" }).getAttribute("href")).toBe("https://www.tradingview.com/chart/layout/");
  });
});
