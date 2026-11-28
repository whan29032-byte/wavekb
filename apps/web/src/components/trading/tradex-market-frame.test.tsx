// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TradexMarketFrame } from "./tradex-market-frame";

const chartOrigin = "https://charts.example.net";
const epoch = "e8c3dcf3-5f57-442a-8cb7-c48cf6504cdf";
const market = { provider: "binance", product: "usdt_perpetual", symbol: "BTCUSDT", timeframe: "1m" } as const;
const markers = [{ marker: "m1", timestamp: "2026-11-28T08:00:00Z", price: "59200.1", role: "open" }] as const;

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("market frame", () => {
  it("requires the expected frame, origin and current load before sending marker values", () => {
    const select = vi.fn();
    render(<TradexMarketFrame origin={chartOrigin} market={market} markers={markers} onSelectMarker={select} />);
    const iframe = screen.getByTitle("TradeX 实时行情") as HTMLIFrameElement;
    expect(iframe.src).toBe(`${chartOrigin}/wavekb-market.html`);
    expect(iframe.getAttribute("referrerpolicy")).toBe("no-referrer");
    const frame = iframe.contentWindow!;
    const send = vi.spyOn(frame, "postMessage").mockImplementation(() => {});
    fireEvent.load(iframe);
    const session = send.mock.calls[0][0].session;
    const ready = { v: 1, type: "ready", session, epoch };
    function deliver(origin: string, source: Window, data: unknown) {
      fireEvent(window, new MessageEvent("message", { origin, source, data }));
    }
    deliver(chartOrigin, window, ready);
    deliver("https://evil.example", frame, ready);
    deliver(chartOrigin, frame, { ...ready, session: epoch });
    expect(send.mock.calls).toHaveLength(1);
    deliver(chartOrigin, frame, ready);
    expect(send.mock.calls.find(([payload]) => payload.type === "initialize")).toEqual([
      { ...ready, type: "initialize", market }, chartOrigin,
    ]);
    expect(send.mock.calls.at(-1)).toEqual([{ v: 1, type: "set-markers", session, markers }, chartOrigin]);
    const selected = { v: 1, type: "marker-selected", session, marker: "m1" };
    deliver(chartOrigin, frame, selected);
    expect(select).toHaveBeenCalledExactlyOnceWith("m1");
    fireEvent.load(iframe);
    deliver(chartOrigin, frame, selected);
    deliver(chartOrigin, frame, ready);
    expect(select).toHaveBeenCalledTimes(1);
    expect(send.mock.calls.at(-1)?.[0].type).toBe("probe");
  });

  it("will not create a frame on the WaveKB page's own origin", () => {
    render(<TradexMarketFrame origin={window.location.origin} market={market} />);
    expect(screen.queryByTitle("TradeX 实时行情")).toBeNull();
  });
});
