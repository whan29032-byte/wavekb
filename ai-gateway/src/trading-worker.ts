import { loadConfig } from "./config.ts";
import { BinanceLeaderboardService } from "./trading/leaderboard-service.ts";

const config = loadConfig(process.env);
const service = new BinanceLeaderboardService(config);
const result = await service.syncDue(100);
process.stdout.write(`${JSON.stringify(result)}\n`);
