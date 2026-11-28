"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { parseTradeXMessage, parseTradeXOrigin, type TradeXMarket, type TradeXMarker } from "@/lib/trading/tradex-bridge";

const noSubscription = () => () => undefined;
const noMarkers: readonly TradeXMarker[] = [];
type Handshake = { session: string; epoch?: string };

export function TradexMarketFrame({ origin, market, markers = noMarkers, onSelectMarker, lockSymbol = false }: {
  origin: string;
  market: TradeXMarket;
  markers?: readonly TradeXMarker[];
  onSelectMarker?: (marker: string) => void;
  lockSymbol?: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const handshake = useRef<Handshake | null>(null);
  const [ready, setReady] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const parentOrigin = useSyncExternalStore(noSubscription, () => window.location.origin, () => "");
  const childOrigin = parseTradeXOrigin(origin)?.origin;
  const isolated = Boolean(parentOrigin && childOrigin && childOrigin !== parentOrigin);

  useEffect(() => {
    if (!isolated || !childOrigin) return;
    function receive(event: MessageEvent) {
      const target = frame.current?.contentWindow;
      const current = handshake.current;
      if (!target || !current || event.source !== target || event.origin !== childOrigin) return;
      const message = parseTradeXMessage(event.data);
      if (!message || message.session !== current.session) return;
      if (message.type === "ready") {
        if (current.epoch) return;
        current.epoch = message.epoch;
        target.postMessage({ v: 1, type: "initialize", session: current.session, epoch: message.epoch, market, ...(lockSymbol ? { lockSymbol: true } : {}) }, childOrigin);
        setReady(current.session);
      } else if (current.epoch && markers.some(({ marker }) => marker === message.marker)) {
        onSelectMarker?.(message.marker);
      }
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [childOrigin, isolated, lockSymbol, market, markers, onSelectMarker]);

  useEffect(() => {
    if (!isolated || ready) return;
    const timer = window.setTimeout(() => setFailed(true), 12_000);
    return () => window.clearTimeout(timer);
  }, [isolated, ready, reload]);

  useEffect(() => {
    if (!childOrigin || !ready || ready !== handshake.current?.session) return;
    frame.current?.contentWindow?.postMessage({ v: 1, type: "set-markers", session: ready, markers }, childOrigin);
  }, [childOrigin, markers, ready]);

  function startHandshake() {
    if (!childOrigin) return;
    const session = crypto.randomUUID();
    handshake.current = { session };
    setReady(null);
    frame.current?.contentWindow?.postMessage({ v: 1, type: "probe", session }, childOrigin);
  }

  if (!isolated) return <p className="text-sm text-muted-foreground" role="status">{parentOrigin ? "行情服务未正确配置。" : "正在打开行情图…"}</p>;
  return <div className="grid min-w-0 gap-2">
    {!ready ? <p className="text-sm text-muted-foreground" role="status">{failed ? "行情图未连接，请重试。" : "正在打开行情图…"}</p> : null}
    {failed && !ready ? <button type="button" onClick={() => { handshake.current = null; setFailed(false); setReload((value) => value + 1); }} className="min-h-11 w-fit rounded-control border bg-surface px-4 text-sm font-medium">重试行情图</button> : null}
    <iframe key={`${childOrigin}:${market.symbol}:${market.timeframe}:${reload}`} ref={frame} title="TradeX 实时行情"
      src={`${childOrigin}/wavekb-market.html`} sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer"
      onLoad={startHandshake} className="h-[min(70dvh,48rem)] min-h-[26rem] w-full rounded-card border bg-surface" />
  </div>;
}
