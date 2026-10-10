import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WaveChartInput } from "./wave-chart-input";

afterEach(cleanup);
const input = {
  schema_version: "wavekb-chart-input-v1",
  bars: [
    { time: 1728000000, open: 100, high: 104, low: 99, close: 102 },
    { time: 1728003600, open: 102, high: 106, low: 101, close: 105 },
  ],
};
const paste = (value: string) => fireEvent.change(screen.getByLabelText("行情 JSON"), { target: { value } });
const apply = () => fireEvent.click(screen.getByRole("button", { name: "检查并应用行情" }));
const chooseFile = (file: { name: string; size: number; text: () => Promise<string> }) => fireEvent.change(screen.getByLabelText("导入 JSON 行情文件"), { target: { files: [file] } });

describe("optional wave chart input", () => {
  it("starts empty and never fills sample market data", () => {
    const onChange = vi.fn(); render(<WaveChartInput onChange={onChange} />);
    expect((screen.getByLabelText("行情 JSON") as HTMLTextAreaElement).value).toBe("");
    expect(screen.queryByText(/当前绘图输入/)).toBeNull();
    expect(screen.getByText(/未提供时不会补造行情/)).toBeDefined();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("validates pasted data before changing the persisted input", () => {
    const onChange = vi.fn(); render(<WaveChartInput onChange={onChange} />);
    paste(JSON.stringify(input)); expect(onChange).not.toHaveBeenCalled(); apply();
    expect(onChange).toHaveBeenCalledExactlyOnceWith(input);
    expect((screen.getByLabelText("行情 JSON") as HTMLTextAreaElement).value).toBe("");
    expect(screen.getByText(/行情已应用到本步骤/)).toBeDefined();
  });

  it.each(["4h", "240"])("converts an original Hermes TV export (%s) to bounded OHLC only", (interval) => {
    const onChange = vi.fn(); render(<WaveChartInput onChange={onChange} instrument="BINANCE:BTCUSDT" timeframe="4小时" />);
    paste(JSON.stringify({ symbol: "BINANCE:BTCUSDT", interval, bars: input.bars.map((bar) => [bar.time, bar.open, bar.high, bar.low, bar.close]) }));
    apply();
    expect(onChange).toHaveBeenCalledExactlyOnceWith(input);
    expect(onChange.mock.calls[0][0]).not.toHaveProperty("symbol");
    expect(onChange.mock.calls[0][0]).not.toHaveProperty("interval");
    expect(screen.getByText(/当前分析：BINANCE:BTCUSDT · 4小时/)).toBeDefined();
    expect(screen.getByText(/导入文件不会自动证明它们匹配/)).toBeDefined();
  });

  it.each(["COMEX:GC1!", "CME_MINI:ES1!", "BTC/USDT"])("accepts supported futures and pair symbols in TV exports: %s", (symbol) => {
    const onChange = vi.fn(); render(<WaveChartInput onChange={onChange} instrument={symbol} timeframe="4小时" />);
    paste(JSON.stringify({ symbol, interval: "4h", bars: input.bars.map((bar) => [bar.time, bar.open, bar.high, bar.low, bar.close]) }));
    apply();
    expect(onChange).toHaveBeenCalledExactlyOnceWith(input);
    expect(onChange.mock.calls[0][0]).not.toHaveProperty("symbol");
  });

  it.each(["https://private.invalid", "file:/private", "/Users/private", "home/private", "FOO/secret.ts", "C:/Users/private", "BTC//USDT"])("does not confuse URI, path, or file markers with allowed TV pair symbols: %s", (symbol) => {
    const onChange = vi.fn(); render(<WaveChartInput onChange={onChange} />);
    paste(JSON.stringify({ symbol, interval: "4h", bars: input.bars.map((bar) => [bar.time, bar.open, bar.high, bar.low, bar.close]) }));
    apply();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("行情数据格式无效");
    expect(screen.getByRole("alert").textContent).not.toContain(symbol);
  });

  it.each([
    { symbol: "BTCUSDT", interval: "4h", bars: [[1728000000, 100, 104, 99, 102]], source_path: "/Users/private/key.env" },
    { symbol: "/Users/private/key.env", interval: "4h", bars: [[1728000000, 100, 104, 99, 102]] },
    { symbol: "BTCUSDT", interval: "https://private", bars: [[1728000000, 100, 104, 99, 102]] },
    { symbol: "BTCUSDT", interval: "4h", bars: [[1728000000, 100, 104, 99, 102, "private metadata"]] },
  ])("rejects extra or unsafe TV metadata without saving or echoing it", (source) => {
    const onChange = vi.fn(); render(<WaveChartInput onChange={onChange} />);
    paste(JSON.stringify(source)); apply();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("行情数据格式无效");
    expect(screen.getByRole("alert").textContent).not.toContain("/Users/");
    expect(screen.getByRole("alert").textContent).not.toContain("private");
  });

  it("clears old success feedback after editing or rejecting another import", async () => {
    render(<WaveChartInput onChange={vi.fn()} />);
    paste(JSON.stringify(input)); apply(); expect(screen.getByText(/行情已应用到本步骤/)).toBeDefined();
    paste("{}"); expect(screen.queryByText(/行情已应用到本步骤/)).toBeNull();
    chooseFile({ name: "bad.json", size: 2, text: async () => "{}" });
    await screen.findByRole("alert");
    expect(screen.queryByText(/行情已应用到本步骤/)).toBeNull();
    expect(screen.queryByText(/行情文件已导入本步骤/)).toBeNull();
  });

  it.each([
    '{"private_source":"/Users/private/book.pdf"}',
    JSON.stringify({ ...input, bars: [...input.bars].reverse() }),
    JSON.stringify({ ...input, bars: [{ ...input.bars[0], high: 98 }] }),
    JSON.stringify({ ...input, bars: Array.from({ length: 129 }, (_, i) => ({ ...input.bars[0], time: 1728000000 + i })) }),
  ])("rejects the entire invalid input without echoing it in an error: %s", (value) => {
    const onChange = vi.fn(); render(<WaveChartInput onChange={onChange} />);
    paste(value); apply();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("行情数据格式无效");
    expect(screen.getByRole("alert").textContent).not.toContain("/Users/");
    expect(screen.getByRole("alert").textContent).not.toContain("private_source");
  });

  it("rejects over-limit paste rather than truncating or applying it", () => {
    const onChange = vi.fn(); render(<WaveChartInput onChange={onChange} />);
    paste(JSON.stringify(input)); const before = (screen.getByLabelText("行情 JSON") as HTMLTextAreaElement).value;
    paste("汉".repeat(30_000));
    expect(screen.getByRole("alert").textContent).toContain("超过 64 KiB");
    expect((screen.getByLabelText("行情 JSON") as HTMLTextAreaElement).value).toBe(before);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("imports a validated JSON file and never displays its private filename", async () => {
    const onChange = vi.fn(); render(<WaveChartInput onChange={onChange} />);
    chooseFile({ name: "private-account-name.json", size: 256, text: async () => JSON.stringify(input) });
    await screen.findByText(/行情文件已导入本步骤/);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(input);
    expect(screen.queryByText("private-account-name.json")).toBeNull();
  });

  it("rejects an oversized file before reading it", () => {
    const onChange = vi.fn(); const read = vi.fn(); render(<WaveChartInput onChange={onChange} />);
    chooseFile({ name: "large.json", size: 65_537, text: read });
    expect(screen.getByRole("alert").textContent).toContain("超过 64 KiB");
    expect(read).not.toHaveBeenCalled(); expect(onChange).not.toHaveBeenCalled();
  });

  it("rechecks actual imported UTF-8 bytes even if file size metadata is smaller", async () => {
    const onChange = vi.fn(); render(<WaveChartInput onChange={onChange} />);
    chooseFile({ name: "oversized.json", size: 1, text: async () => "汉".repeat(30_000) });
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain("超过 64 KiB");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("invalidates a pending import when the user edits or clears the input", async () => {
    let finish!: (value: string) => void;
    const onChange = vi.fn(); render(<WaveChartInput value={input} onChange={onChange} />);
    chooseFile({ name: "old.json", size: 256, text: () => new Promise((resolve) => { finish = resolve; }) });
    paste("{}");
    fireEvent.click(screen.getByRole("button", { name: "清除本步骤绘图输入" }));
    finish(JSON.stringify(input));
    await waitFor(() => expect(screen.queryByText("正在读取行情文件…")).toBeNull());
    expect(onChange).toHaveBeenCalledExactlyOnceWith(null);
    expect(screen.queryByText(/行情文件已导入本步骤/)).toBeNull();
  });

  it("does not apply stale file reads after a draft change or disable", async () => {
    let finish!: (value: string) => void;
    const onChange = vi.fn(); const { rerender } = render(<WaveChartInput onChange={onChange} />);
    chooseFile({ name: "old.json", size: 256, text: () => new Promise((resolve) => { finish = resolve; }) });
    rerender(<WaveChartInput value={input} onChange={onChange} disabled />);
    finish(JSON.stringify(input));
    await waitFor(() => expect(screen.queryByText("正在读取行情文件…")).toBeNull());
    expect(onChange).not.toHaveBeenCalled();
    expect((screen.getByLabelText("行情 JSON") as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByLabelText("导入 JSON 行情文件") as HTMLInputElement).disabled).toBe(true);
  });

  it("invalidates a file read if its target instrument or timeframe changes", async () => {
    let finish!: (value: string) => void;
    const onChange = vi.fn(); const { rerender } = render(<WaveChartInput onChange={onChange} instrument="BTCUSDT" timeframe="4小时" />);
    chooseFile({ name: "old.json", size: 256, text: () => new Promise((resolve) => { finish = resolve; }) });
    rerender(<WaveChartInput onChange={onChange} instrument="SOLUSDT" timeframe="1小时" />);
    finish(JSON.stringify(input));
    await waitFor(() => expect(screen.queryByText("正在读取行情文件…")).toBeNull());
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByText(/行情文件已导入本步骤/)).toBeNull();
  });

  it("does not retain an old applied-success message after the chart becomes inactive", () => {
    const { rerender } = render(<WaveChartInput onChange={vi.fn()} instrument="BTCUSDT" timeframe="4小时" />);
    paste(JSON.stringify(input)); apply(); expect(screen.getByText(/行情已应用到本步骤/)).toBeDefined();
    rerender(<WaveChartInput value={input} onChange={vi.fn()} instrument="SOLUSDT" timeframe="4小时" inactive />);
    expect(screen.queryByText(/行情已应用到本步骤/)).toBeNull();
    expect(screen.getByText(/此行情属于其他或未确认标的／周期，已停用/)).toBeDefined();
    expect(screen.getByRole("button", { name: "清除本步骤绘图输入" })).toBeDefined();
  });

  it("only the latest file import may apply its result", async () => {
    let finishOld!: (value: string) => void;
    const onChange = vi.fn(); render(<WaveChartInput onChange={onChange} />);
    chooseFile({ name: "old.json", size: 256, text: () => new Promise((resolve) => { finishOld = resolve; }) });
    chooseFile({ name: "new.json", size: 256, text: async () => JSON.stringify(input) });
    await screen.findByText(/行情文件已导入本步骤/);
    finishOld(JSON.stringify({ ...input, bars: [input.bars[0]] }));
    await waitFor(() => expect(screen.queryByText("正在读取行情文件…")).toBeNull());
    expect(onChange).toHaveBeenCalledExactlyOnceWith(input);
  });

  it("does not apply a file after unmounting", async () => {
    let finish!: (value: string) => void;
    const onChange = vi.fn(); const { unmount } = render(<WaveChartInput onChange={onChange} />);
    chooseFile({ name: "old.json", size: 256, text: () => new Promise((resolve) => { finish = resolve; }) });
    unmount(); finish(JSON.stringify(input)); await Promise.resolve(); await Promise.resolve();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows a fixed invalid persisted-input message and allows explicit removal", () => {
    const onChange = vi.fn(); render(<WaveChartInput value={{ local_file: "/Users/private/book.pdf" }} onChange={onChange} />);
    expect(screen.getByRole("alert").textContent).toContain("已有绘图输入格式无效");
    expect(screen.queryByText("/Users/private/book.pdf")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "清除本步骤绘图输入" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(null);
  });
});
