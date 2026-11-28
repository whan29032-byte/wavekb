import type { FillMarker } from "@wavekb/domain/trading-review";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FillList } from "./fill-list";

const fills = [
  {
    marker_key: "7:42",
    fill_id: "42",
    occurred_at: "2026-11-01T00:15:00.123Z",
    price: "70000.125000000000000001",
    allocated_quantity: "0.001000000000000001",
    allocation_role: "open",
    sort_order: 0,
    side: "buy",
    position_side: "long",
    liquidity: "maker",
    provider_fill_id_mask: "••••1234",
    annotation: null,
  },
  {
    marker_key: "7:43",
    fill_id: "43",
    occurred_at: "2026-11-01T00:15:01.456Z",
    price: "70001.25",
    allocated_quantity: "0.002",
    allocation_role: "add",
    sort_order: 1,
    side: "buy",
    position_side: "long",
    liquidity: "taker",
    provider_fill_id_mask: "••••5678",
    annotation: null,
  },
  {
    marker_key: "7:44",
    fill_id: "44",
    occurred_at: "2026-11-01T00:16:00.000Z",
    price: "69990",
    allocated_quantity: "0.003",
    allocation_role: "reverse_open",
    sort_order: 2,
    side: "sell",
    position_side: "short",
    liquidity: "unknown",
    provider_fill_id_mask: "••••9012",
    annotation: null,
  },
] satisfies FillMarker[];

afterEach(cleanup);

describe("FillList", () => {
  it("keeps exact fill facts in a non-canvas list and calls out candle gaps", () => {
    render(
      <FillList
        fills={fills}
        selectedMarkerKey="7:42"
        chartedMarkerKeys={new Set(["7:42", "7:43"])}
        gapMarkerKeys={new Set(["7:44"])}
        onSelect={() => undefined}
      />,
    );

    expect(screen.getByRole("list", { name: "逐笔成交" })).toBeTruthy();
    expect(screen.getByText("70000.125000000000000001")).toBeTruthy();
    expect(screen.getByText("0.001000000000000001")).toBeTruthy();
    expect(screen.getByText("2026-11-01T00:15:00.123Z")).toBeTruthy();
    expect(screen.getByText("••••1234")).toBeTruthy();
    expect(screen.getByText("开仓 · 买入 · 多头")).toBeTruthy();
    expect(screen.getByText("反手新开 · 卖出 · 空头")).toBeTruthy();
    expect(screen.getByText("该成交位于行情缺口，未附着到 K 线。" )).toBeTruthy();

    const selected = screen.getByRole("button", { name: /开仓.*70000\.125/ });
    expect(selected.getAttribute("aria-pressed")).toBe("true");
    expect(selected.className).toContain("ring-2");
  });

  it("supports roving focus with arrows, Home and End, then selects with Enter or Space", () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <FillList fills={fills} selectedMarkerKey={null} chartedMarkerKeys={new Set(fills.map((fill) => fill.marker_key))} onSelect={onSelect} />,
    );
    const buttons = screen.getAllByRole("button");

    buttons[0]?.focus();
    fireEvent.keyDown(buttons[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(buttons[1]);
    fireEvent.keyDown(buttons[1]!, { key: "End" });
    expect(document.activeElement).toBe(buttons[2]);
    fireEvent.keyDown(buttons[2]!, { key: "Home" });
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(buttons[0]!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(buttons[2]);
    fireEvent.keyDown(buttons[2]!, { key: "Enter" });
    fireEvent.keyDown(buttons[2]!, { key: " " });
    expect(onSelect).toHaveBeenNthCalledWith(1, "7:44");
    expect(onSelect).toHaveBeenNthCalledWith(2, "7:44");

    rerender(
      <FillList fills={fills} selectedMarkerKey="7:43" chartedMarkerKeys={new Set(fills.map((fill) => fill.marker_key))} onSelect={onSelect} />,
    );
    expect(screen.getByRole("button", { name: /加仓.*70001\.25/ }).getAttribute("tabindex")).toBe("0");
  });
});
