import { isTradingProvider, type TradingProvider, type TradingProviderAdapter } from "./contracts.ts";

const requiredReadMethods = [
  "validateCredentials",
  "discoverCapabilities",
  "fetchAccountSnapshot",
  "fetchHistory",
  "normalizeHistory",
] as const;

const forbiddenMutationMethods = new Set([
  "placeOrder",
  "createOrder",
  "submitOrder",
  "amendOrder",
  "modifyOrder",
  "cancelOrder",
  "closePosition",
  "withdraw",
  "transfer",
]);

function methodNames(value: object): Set<string> {
  const result = new Set<string>();
  let current: object | null = value;
  while (current && current !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(current)) {
      if (name !== "constructor" && typeof (value as Record<string, unknown>)[name] === "function") result.add(name);
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  return result;
}

export function createTradingProviderRegistry(
  adapters: readonly TradingProviderAdapter[],
  enabledProviders: readonly TradingProvider[],
): ReadonlyMap<TradingProvider, TradingProviderAdapter> {
  const all = new Map<TradingProvider, TradingProviderAdapter>();
  for (const adapter of adapters) {
    if (!isTradingProvider(adapter.provider)) throw new Error("invalid_trading_provider");
    if (all.has(adapter.provider)) throw new Error(`duplicate_trading_provider:${adapter.provider}`);
    const names = methodNames(adapter);
    for (const name of forbiddenMutationMethods) {
      if (names.has(name)) throw new Error(`unsafe_trading_adapter_method:${name}`);
    }
    for (const name of requiredReadMethods) {
      if (!names.has(name)) throw new Error(`invalid_trading_adapter_method:${name}`);
    }
    all.set(adapter.provider, adapter);
  }

  const enabled = new Map<TradingProvider, TradingProviderAdapter>();
  for (const provider of enabledProviders) {
    const adapter = all.get(provider);
    if (!adapter) throw new Error(`missing_trading_provider:${provider}`);
    enabled.set(provider, adapter);
  }
  return enabled;
}
