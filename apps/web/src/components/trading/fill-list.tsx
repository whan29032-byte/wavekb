"use client";

import type { FillMarker } from "@wavekb/domain/trading-review";
import { useRef, useState, type KeyboardEvent } from "react";

const roleLabels: Record<FillMarker["allocation_role"], string> = {
  open: "开仓",
  add: "加仓",
  reduce: "减仓",
  close: "平仓",
  reverse_open: "反手新开",
};

const sideLabels: Record<FillMarker["side"], string> = { buy: "买入", sell: "卖出" };
const positionLabels: Record<FillMarker["position_side"], string> = {
  both: "双向",
  long: "多头",
  short: "空头",
};

export interface FillListProps {
  fills: readonly FillMarker[];
  selectedMarkerKey: string | null;
  chartedMarkerKeys: ReadonlySet<string>;
  gapMarkerKeys?: ReadonlySet<string>;
  onSelect(markerKey: string): void;
}

export function FillList({ fills, selectedMarkerKey, chartedMarkerKeys, gapMarkerKeys, onSelect }: FillListProps) {
  const [activeMarkerKey, setActiveMarkerKey] = useState<string | null>(fills[0]?.marker_key ?? null);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeKey = selectedMarkerKey !== null && fills.some(({ marker_key }) => marker_key === selectedMarkerKey)
    ? selectedMarkerKey
    : fills.some(({ marker_key }) => marker_key === activeMarkerKey)
      ? activeMarkerKey
      : fills[0]?.marker_key ?? null;

  function moveFocus(nextIndex: number) {
    if (fills.length === 0) return;
    const bounded = (nextIndex + fills.length) % fills.length;
    setActiveMarkerKey(fills[bounded]?.marker_key ?? null);
    buttonRefs.current[bounded]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number, markerKey: string) {
    if (["ArrowDown", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      moveFocus(index + 1);
    } else if (["ArrowUp", "ArrowLeft"].includes(event.key)) {
      event.preventDefault();
      moveFocus(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      moveFocus(0);
    } else if (event.key === "End") {
      event.preventDefault();
      moveFocus(fills.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(markerKey);
    }
  }

  return (
    <ol aria-label="逐笔成交" className="grid gap-2">
      {fills.map((fill, index) => {
        const selected = fill.marker_key === selectedMarkerKey;
        const semanticLabel = `${roleLabels[fill.allocation_role]} · ${sideLabels[fill.side]} · ${positionLabels[fill.position_side]}`;
        return (
          <li key={fill.marker_key}>
            <button
              ref={(element) => { buttonRefs.current[index] = element; }}
              type="button"
              aria-pressed={selected}
              tabIndex={fill.marker_key === activeKey ? 0 : -1}
              onClick={() => onSelect(fill.marker_key)}
              onFocus={() => setActiveMarkerKey(fill.marker_key)}
              onKeyDown={(event) => handleKeyDown(event, index, fill.marker_key)}
              className={`grid min-h-11 w-full gap-2 rounded-control border bg-surface p-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${selected ? "border-primary ring-2 ring-primary/30" : "hover:border-border-strong"}`}
            >
              <span className="flex flex-wrap items-center justify-between gap-2">
                <strong>{semanticLabel}</strong>
                <time dateTime={fill.occurred_at} className="tabular-nums text-xs text-muted-foreground">{fill.occurred_at}</time>
              </span>
              <span className="grid gap-1 tabular-nums sm:grid-cols-3">
                <span>价格 <strong>{fill.price}</strong></span>
                <span>分配数量 <strong>{fill.allocated_quantity}</strong></span>
                <span>成交编号 <strong>{fill.provider_fill_id_mask}</strong></span>
              </span>
              {!chartedMarkerKeys.has(fill.marker_key)
                ? <span className="text-xs text-warning">{gapMarkerKeys?.has(fill.marker_key)
                  ? "该成交位于行情缺口，未附着到 K 线。"
                  : "未在图表显示。"}</span>
                : null}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
