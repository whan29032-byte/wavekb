import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const read = (path) => fs.readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Binance leaderboard keeps secrets server-only and publishes only approved live account totals", async () => {
  const [migration, realtimeMigration, amountsMigration, gateway, page] = await Promise.all([
    read("supabase/migrations/202609080001_binance_trading_leaderboard.sql"),
    read("supabase/migrations/202609080002_realtime_trading_leaderboard.sql"),
    read("supabase/migrations/202609080003_public_trading_amounts.sql"),
    read("ai-gateway/src/trading/leaderboard-service.ts"),
    read("apps/web/src/app/leaderboard/page.tsx"),
  ]);
  assert.match(migration, /exchange_connection_secrets/);
  assert.match(migration, /only the gateway service role/i);
  assert.doesNotMatch(migration, /create policy[^;]+exchange_connection_secrets/is);
  assert.match(realtimeMigration, /greatest\(1 \+ snapshot\.period_return/);
  assert.doesNotMatch(realtimeMigration, /connection\.started_at <= now\(\) - interval '24 hours'/);
  assert.doesNotMatch(realtimeMigration, /when '7d'|when '30d'|when '90d'/);
  assert.match(realtimeMigration, /coalesce\([\s\S]*exp\(sum/);
  assert.match(realtimeMigration, /count\(snapshot\.id\)/);
  assert.match(realtimeMigration, /create table if not exists public\.trading_return_summaries/);
  assert.match(realtimeMigration, /create trigger trading_equity_snapshots_summarize/);
  assert.match(realtimeMigration, /lock table public\.trading_equity_snapshots in share row exclusive mode/);
  const leaderboardReturn = realtimeMigration.slice(realtimeMigration.indexOf("create or replace function public.list_trading_leaderboard"));
  assert.doesNotMatch(leaderboardReturn, /equity_usdt|wallet_balance_usdt|unrealized_pnl_usdt/);
  assert.doesNotMatch(leaderboardReturn, /trading_equity_snapshots/);
  assert.match(leaderboardReturn, /connection\.status in \('active', 'error'\)/);
  assert.match(amountsMigration, /current_equity_usdt/);
  assert.match(amountsMigration, /cumulative_profit_usdt/);
  assert.match(amountsMigration, /public_amounts_consented_at/);
  assert.match(amountsMigration, /connection\.public_amounts_consented_at is not null/);
  assert.match(amountsMigration, /create_binance_exchange_connection_v2/);
  assert.match(amountsMigration, /set_exchange_connection_public_amounts/);
  assert.match(amountsMigration, /record_exchange_sync_failure/);
  assert.match(amountsMigration, /drop function public\.list_trading_leaderboard\(text, integer\)/);
  assert.match(amountsMigration, /lock table public\.trading_equity_snapshots in share row exclusive mode/);
  const publicAmountsRpc = amountsMigration.slice(amountsMigration.indexOf("create function public.list_trading_leaderboard"));
  assert.doesNotMatch(publicAmountsRpc, /wallet_balance_usdt|unrealized_pnl_usdt|net_external_flow_usdt|initial_equity_usdt/);
  assert.doesNotMatch(publicAmountsRpc, /join public\.trading_equity_snapshots/);
  assert.match(publicAmountsRpc, /order by ranked\.return_rate desc/);
  assert.match(gateway, /encryptSecret\(JSON\.stringify\(\{ apiKey, secretKey \}\)/);
  assert.match(gateway, /secret_mask/);
  assert.match(gateway, /exchange_sync_gap_too_large/);
  assert.match(gateway, /create_binance_exchange_connection_v2/);
  assert.match(gateway, /set_exchange_connection_public_amounts/);
  assert.match(gateway, /record_exchange_sync_failure/);
  assert.match(page, /current_equity_usdt/);
  assert.match(page, /cumulative_profit_usdt/);
  assert.doesNotMatch(page, /wallet_balance_usdt|unrealized_pnl_usdt|net_external_flow_usdt/);
});

test("administrators can disable a leaderboard connection without receiving exchange secrets", async () => {
  const [migration, gateway, adminPage] = await Promise.all([
    read("supabase/migrations/202609080001_binance_trading_leaderboard.sql"),
    read("ai-gateway/src/trading/leaderboard-service.ts"),
    read("apps/web/src/app/admin/trading/page.tsx"),
  ]);
  assert.match(migration, /admin_disable_exchange_connection/);
  assert.match(migration, /disable_exchange/);
  assert.match(migration, /insert into public\.user_moderation_audit/);
  assert.match(gateway, /adminDisable/);
  assert.doesNotMatch(adminPage, /ciphertext|auth_tag|secret_key/i);
});

test("exchange browser route is authenticated, origin checked and narrowly allowlisted", async () => {
  const route = await read("apps/web/src/app/api/exchange/[...path]/route.ts");
  assert.match(route, /gatewayRequestOrigin/);
  assert.match(route, /client\.auth\.getUser\(\)/);
  assert.match(route, /connection\/disconnect/);
  assert.match(route, /connection\/public/);
  assert.doesNotMatch(route, /service.role|SERVICE_ROLE/i);
  assert.match(route, /16 \* 1024/);
});
