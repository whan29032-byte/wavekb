import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.ts";
import {
  SupabaseDiscordGameSettlementStore,
  runDiscordGameSettlement,
} from "../src/discord-game-settlement-worker.ts";

test("scheduled settlement invokes only the clock-bound service-role RPC", async () => {
  const calls: Array<{ path: string; options: unknown }> = [];
  const config = loadConfig({
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "server-role-key-longer-than-twenty",
    SUPABASE_PUBLISHABLE_KEY: "publishable-key-longer-than-twenty",
    AI_SECRET_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"),
    AUTH_SITE_URL: "https://wavekb.com",
  });
  const database = {
    async request(path: string, options: unknown) {
      calls.push({ path, options });
      return null;
    },
  };
  const store = new SupabaseDiscordGameSettlementStore(config, database);
  await runDiscordGameSettlement({ store });
  assert.deepEqual(calls, [{
    path: "/rest/v1/rpc/discord_game_settle_markets",
    options: { method: "POST", body: {} },
  }]);
});
