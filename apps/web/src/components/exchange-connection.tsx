import { ExchangeAccountManager } from "./exchange-account-manager";

/**
 * Compatibility export for pages that still use the former single-Binance
 * component name. The account manager now supports all enabled providers and
 * more than one account without changing those page imports.
 */
export function ExchangeConnectionPanel({ actorId }: { actorId: string | null }) {
  return <ExchangeAccountManager actorId={actorId} />;
}
