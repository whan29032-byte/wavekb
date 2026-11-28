import { describe, expect, it } from "vitest";
import { parseTradeXMessage, parseTradeXOrigin } from "./tradex-bridge";

describe("TradeX frame boundary", () => {
  it("only accepts complete canonical HTTPS origins", () => {
    expect(parseTradeXOrigin("https://charts.example.net/")?.origin).toBe("https://charts.example.net");
    for (const value of [undefined, "http://charts.example.net", "https://evil@example.net", "https://charts.example.net/a", "https://charts.example.net/?x=1", "https://charts.example.net/#x", "https://charts.example.net\\evil", "//charts.example.net"]) {
      expect(parseTradeXOrigin(value)).toBeNull();
    }
  });

  it("resolves message types without accepting arbitrary extra payload", () => {
    const ready = { v: 1, type: "ready", session: "0eaa0ff3-869a-4b02-8bc7-4b5318ef1b2b", epoch: "e8c3dcf3-5f57-442a-8cb7-c48cf6504cdf" };
    expect(parseTradeXMessage(ready)).toEqual(ready);
    expect(parseTradeXMessage({ ...ready, note: "not on wire" })).toBeNull();
    expect(parseTradeXMessage({ ...ready, epoch: "unexpected" })).toBeNull();
    expect(parseTradeXMessage({ v: 1, type: "marker-selected", session: ready.session, marker: "m2" })).toEqual({ v: 1, type: "marker-selected", session: ready.session, marker: "m2" });
    expect(parseTradeXMessage({ ...ready, v: 2 })).toBeNull();
  });
});
