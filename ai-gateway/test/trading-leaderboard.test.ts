import assert from "node:assert/strict";
import test from "node:test";
import { BinanceLeaderboardService } from "../src/trading/leaderboard-service.ts";

test("the public leaderboard gateway projects an exact non-secret response", async () => {
  const service = new BinanceLeaderboardService({} as never);
  Object.defineProperty(service, "database", {
    value: {
      async request() {
        return [{
          rank_no: "1",
          user_id: "11111111-1111-4111-8111-111111111111",
          public_uid: "33333",
          display_name: "Trader",
          avatar_url: null,
          display_title: "",
          nameplate_style: "classic",
          return_rate: "0.12",
          sample_count: "4",
          current_equity_usdt: "1470.00000000",
          cumulative_profit_usdt: "170.00000000",
          tracking_started_at: "2026-09-08T10:00:00Z",
          last_synced_at: "2026-09-08T12:00:00Z",
          wallet_balance_usdt: "9999",
          unrealized_pnl_usdt: "100",
          net_external_flow_usdt: "300",
          api_key: "must-not-leak",
        }];
      },
    },
  });

  const [entry] = await service.leaderboard();
  assert.ok(entry);
  assert.deepEqual(Object.keys(entry).sort(), [
    "avatar_url",
    "cumulative_profit_usdt",
    "current_equity_usdt",
    "display_name",
    "display_title",
    "last_synced_at",
    "nameplate_style",
    "public_uid",
    "rank_no",
    "return_rate",
    "tracking_started_at",
    "user_id",
  ].sort());
  assert.equal(entry.current_equity_usdt, "1470.00000000");
  assert.equal(entry.cumulative_profit_usdt, "170.00000000");
});
