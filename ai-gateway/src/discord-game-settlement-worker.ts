import { fileURLToPath } from "node:url";
import { loadConfig, type GatewayConfig } from "./config.ts";
import { SupabaseRest } from "./storage/supabase-rest.ts";
import { formatWorkerMetric } from "./worker-main.ts";

export interface DiscordGameSettlementStore {
  settle(): Promise<void>;
}

export class SupabaseDiscordGameSettlementStore implements DiscordGameSettlementStore {
  private readonly database: Pick<SupabaseRest, "request">;

  constructor(config: GatewayConfig, database?: Pick<SupabaseRest, "request">) {
    this.database = database ?? new SupabaseRest(config);
  }

  async settle(): Promise<void> {
    await this.database.request("/rest/v1/rpc/discord_game_settle_markets", {
      method: "POST",
      body: {},
    });
  }
}

export async function runDiscordGameSettlement({
  config,
  store,
}: {
  config?: GatewayConfig;
  store?: DiscordGameSettlementStore;
} = {}): Promise<void> {
  if (store) {
    await store.settle();
    return;
  }
  await new SupabaseDiscordGameSettlementStore(config ?? loadConfig(process.env)).settle();
}

const isMain = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (isMain) {
  const started = Date.now();
  await runDiscordGameSettlement();
  process.stdout.write(`${formatWorkerMetric("discord_game_settlement", {
    settled: true,
    duration_ms: Date.now() - started,
  })}\n`);
}
