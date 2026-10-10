import { parseWalletQuote, walletRouteId, walletTransferHash, walletUuid, type WalletChain, type WalletQuote, type WalletRouteId } from "./wallet-types";

export type WalletCheckoutAttempt = { kind: "checkout"; ownerId: string; requestId: string; routeId: WalletRouteId; expectedQuote: WalletQuote };
export type WalletTransferAttempt = { kind: "transfer"; ownerId: string; orderId: string; chain: WalletChain; txHash: string };
export type WalletAttempt = WalletCheckoutAttempt | WalletTransferAttempt;
export const walletAttemptKey = (ownerId: string) => `wavekb:membership-wallet:${ownerId}`;

export function readWalletAttempt(ownerId: string): WalletAttempt | null {
  const raw = window.localStorage.getItem(walletAttemptKey(ownerId)); if (!raw) return null;
  let item: WalletAttempt; try { item = JSON.parse(raw) as WalletAttempt; } catch { throw new Error("membership_wallet_checkpoint_invalid"); }
  if (!item || !walletUuid(item.ownerId) || item.ownerId !== ownerId) throw new Error("membership_wallet_checkpoint_invalid");
  if (item.kind === "checkout" && walletUuid(item.requestId) && walletRouteId(item.routeId)) return { kind: "checkout", ownerId, requestId: item.requestId, routeId: item.routeId, expectedQuote: parseWalletQuote(item.expectedQuote) };
  if (item.kind === "transfer" && walletUuid(item.orderId) && ["tron", "ethereum", "base"].includes(item.chain)) return { kind: "transfer", ownerId, orderId: item.orderId, chain: item.chain, txHash: walletTransferHash(item.chain, item.txHash) };
  throw new Error("membership_wallet_checkpoint_invalid");
}
export function writeWalletAttempt(item: WalletAttempt) {
  const previous = readWalletAttempt(item.ownerId); if (previous && JSON.stringify(previous) !== JSON.stringify(item)) throw new Error("membership_wallet_checkpoint_changed");
  try { window.localStorage.setItem(walletAttemptKey(item.ownerId), JSON.stringify(item)); } catch { throw new Error("membership_wallet_storage_unavailable"); }
  if (JSON.stringify(readWalletAttempt(item.ownerId)) !== JSON.stringify(item)) throw new Error("membership_wallet_checkpoint_changed");
}
export function clearWalletAttempt(item: WalletAttempt) {
  if (JSON.stringify(readWalletAttempt(item.ownerId)) !== JSON.stringify(item)) throw new Error("membership_wallet_checkpoint_changed"); window.localStorage.removeItem(walletAttemptKey(item.ownerId));
}
