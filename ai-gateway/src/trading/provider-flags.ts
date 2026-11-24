import type { TradingProvider } from "@wavekb/domain/trading-review";
import type { GatewayConfig } from "../config.ts";

const allProviders: readonly TradingProvider[] = ["binance", "okx", "bybit", "bitget", "exness"];

const providerFlags: Record<TradingProvider, keyof GatewayConfig> = {
  binance: "TRADING_PROVIDER_BINANCE_ENABLED",
  okx: "TRADING_PROVIDER_OKX_ENABLED",
  bybit: "TRADING_PROVIDER_BYBIT_ENABLED",
  bitget: "TRADING_PROVIDER_BITGET_ENABLED",
  exness: "TRADING_PROVIDER_EXNESS_ENABLED",
};

/** Provider flags are independent so sync can be proven before the UI cutover. */
export function configuredTradingProviders(config: GatewayConfig): TradingProvider[] {
  return allProviders.filter((provider) => config[providerFlags[provider]] === true);
}

/** User credential routes additionally require the reversible workbench master flag. */
export function enabledConnectionProviders(config: GatewayConfig): TradingProvider[] {
  return config.TRADING_WORKBENCH_V2_ENABLED ? configuredTradingProviders(config) : [];
}
